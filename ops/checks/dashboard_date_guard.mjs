#!/usr/bin/env node
/**
 * W6 ticket 16：看板 366 天上限「网络面板」浏览器探针。
 *
 * 为什么是浏览器而不是单测：票 16 的验收要求「网络面板与测试证明失败请求未发出」——
 * 即聚合请求级别的证据。本探针在隔离站点（临时 SQLite，绝不触碰 3700/3600）上用
 * Playwright 驱动真实页面，page.on("request"/"response") 充当网络面板：
 * 记录每条 /admin/reports/* 请求的 from_ms/to_ms 跨度与响应码，逐条断言。
 *
 * 覆盖：
 *   1. calendar.beyond-cap-disabled：日历直接禁用超界日期（最早可选日 = 今天−365 天，
 *      由契约上限 366 推导；其前一天 disabled，今天 enabled）。
 *   2. custom-range.publishes-and-200：合法自定义窗（最早日→今天）发布后聚合请求发出且 200。
 *   3. midnight.boundary-366：「零点」产出恰好 366 天窗（上限边界）→ 后端放行 200。
 *   4. invalid-draft.no-request-and-red：草稿非法（结束≤开始）只标红字段 + 行内文案，
 *      聚合请求计数零增长；不插入推挤布局的提示块。
 *   5. preset-7d.regression：预设「近 7 天」回归——range=7d 请求照常发出且 200。
 *   6. logs.latency-422-visible：route 拦截 /admin/reports/latency 返回 422，日志页出现
 *      可见错误态（不再静默），通知中心同因落一条（票 07 语义），日志表格本身正常。
 *   7. network.aggregate：全程网络面板——凡带 from_ms/to_ms 的聚合请求跨度 ≤ 366 天，
 *      除第 6 条刻意注入的 422 外全程零 422。
 *
 * 运行：
 *   node ops/checks/dashboard_date_guard.mjs                 # 自动在 3778 起隔离站点
 *   node ops/checks/dashboard_date_guard.mjs --base-url http://127.0.0.1:3778
 *   node ops/checks/dashboard_date_guard.mjs --channel msedge --headed
 *
 * 自动起站点时需要：web/dist 已构建（cd web && npx vite build）；api/.venv 可用；
 * 3778 未被占用。临时 SQLite 与临时 ag-config，退出时结束子进程。
 *
 * 退出码：0 全部 PASS；1 有 FAIL；2 环境未就绪（未执行，不算通过）。
 * 证据：ops/checks/.logs/dashboard-date-guard/<时间戳>/（report.md/json + 截图）。
 */
import fs from "node:fs";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { launchBrowser, loadPlaywright, parseCred, parseFlags, stamp } from "./lib/cli.mjs";
import { settle } from "./lib/session.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..", "..");
const WEB_ROOT = path.join(ROOT, "web");
const API_ROOT = path.join(ROOT, "api");

const flags = parseFlags(process.argv.slice(2));
const BASE_URL_FLAG = (flags.get("base-url") || process.env.W6_BASE_URL || "").replace(/\/$/, "");
const PORT = Number(flags.get("port") || process.env.W6_GUARD_PORT || 3778);
const HEADED = flags.has("headed");
const CHANNEL = flags.get("channel") || process.env.PLAYWRIGHT_CHANNEL || "";
const ADMIN_CRED = parseCred(flags.get("admin") || process.env.W6_ADMIN, { user: "admin", pass: "admin12345" });
const OUT = path.resolve(
  flags.get("out") || path.join(ROOT, "ops", "checks", ".logs", "dashboard-date-guard", stamp()),
);
fs.mkdirSync(OUT, { recursive: true });

/** 独立事实源：契约上限 366 天（票 16 验收口径），与后端 deps.py/contract.ts 对齐。 */
const DAY_MS = 24 * 3_600_000;
const CAP_MS = 366 * DAY_MS;
const CAP_DAYS = 366;

const results = [];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function pad2(n) {
  return String(n).padStart(2, "0");
}

/** 本地 yyyy-mm-dd（浏览器与脚本共用机器时区）。 */
function isoOf(date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function baseUrl() {
  return BASE_URL_FLAG || `http://127.0.0.1:${PORT}`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

class GuardError extends Error {}

const failures = [];
async function test(id, name, fn) {
  const started = Date.now();
  try {
    await fn();
    results.push({ id, name, status: "PASS", ms: Date.now() - started });
    console.log(`PASS  ${id}  ${name}`);
  } catch (error) {
    const message = String((error && error.message) || error).split("\n")[0];
    results.push({ id, name, status: "FAIL", ms: Date.now() - started, error: message });
    failures.push({ id, name, message });
    console.log(`FAIL  ${id}  ${name}\n      ${message}`);
  }
}

/* ------------------------- 隔离站点（照 responsive_matrix 口径） ------------------------- */

let serverProc = null;
let serverLog = "";

function pythonExecutable() {
  const candidates = [
    process.env.W6_PYTHON || "",
    process.platform === "win32"
      ? path.join(API_ROOT, ".venv", "Scripts", "python.exe")
      : path.join(API_ROOT, ".venv", "bin", "python"),
    "python",
  ].filter(Boolean);
  return candidates.find((candidate) => candidate === "python" || fs.existsSync(candidate)) || "python";
}

async function waitForHealth(base, timeoutMs = 40_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError = "";
  while (Date.now() < deadline) {
    try {
      const response = await fetch(base + "/admin/health", { signal: AbortSignal.timeout(1500) });
      if (response.ok) return;
      lastError = "HTTP " + response.status;
    } catch (error) {
      lastError = String((error && error.message) || error);
    }
    await sleep(400);
  }
  throw new GuardError("隔离站点未在 " + timeoutMs + "ms 内就绪：" + lastError);
}

async function startIsolatedServer() {
  if (PORT === 3700 || PORT === 3600) {
    throw new GuardError("拒绝在 3700/3600 上运行探针（必须使用隔离端口，如 3778）");
  }
  const base = baseUrl();
  try {
    const probe = await fetch(base + "/admin/health", { signal: AbortSignal.timeout(1200) });
    if (probe.ok) throw new GuardError("端口 " + PORT + " 已有服务在运行；请换 --port 或传 --base-url 明确复用");
  } catch (error) {
    if (error instanceof GuardError) throw error;
  }
  const distIndex = path.join(WEB_ROOT, "dist", "index.html");
  if (!fs.existsSync(distIndex)) {
    throw new GuardError("web/dist 不存在：先 cd web && npx vite build，或用 --base-url 指向已构建站点");
  }

  const serverDir = path.join(OUT, "server");
  fs.mkdirSync(path.join(serverDir, "ag-config"), { recursive: true });
  serverLog = path.join(serverDir, "server.log");
  const databaseFile = path.join(serverDir, "guard.db").replace(/\\/g, "/");
  const env = {
    ...process.env,
    PYTHONPATH: path.join(API_ROOT, "src"),
    SLIPSTREAM_DATABASE_URL: "sqlite:///" + databaseFile,
    SLIPSTREAM_AG_CONFIG_DIR: path.join(serverDir, "ag-config"),
    SLIPSTREAM_AG_DB_PATH: path.join(serverDir, "ag-config", "ag-data.db"),
    SLIPSTREAM_WEB_DIST_DIR: path.join(WEB_ROOT, "dist"),
    SLIPSTREAM_JOBS_ENABLED: "0",
    SLIPSTREAM_ADMIN_USERNAME: ADMIN_CRED.user,
    SLIPSTREAM_ADMIN_PASSWORD: ADMIN_CRED.pass,
    SLIPSTREAM_SECRET_KEY: "dashboard-date-guard-only",
    SLIPSTREAM_COOKIE_SECURE: "0",
    SLIPSTREAM_AG_BINARY: "",
    SLIPSTREAM_AG_LLM_PORT: "0",
  };
  const logFd = fs.openSync(serverLog, "a");
  serverProc = spawn(
    pythonExecutable(),
    ["-m", "uvicorn", "l06_api.app:create_app", "--factory", "--host", "127.0.0.1", "--port", String(PORT)],
    { cwd: API_ROOT, env, stdio: ["ignore", logFd, logFd], windowsHide: true },
  );
  try {
    await waitForHealth(base);
  } catch (error) {
    throw new GuardError(error.message + "\n" + tailServerLog());
  }
  return base;
}

function tailServerLog(lines = 12) {
  if (!serverLog || !fs.existsSync(serverLog)) return "";
  return fs.readFileSync(serverLog, "utf8").split(/\r?\n/).slice(-lines).join("\n");
}

function stopIsolatedServer() {
  if (!serverProc) return;
  const pid = serverProc.pid;
  serverProc = null;
  if (!pid) return;
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/pid", String(pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
  } else {
    try {
      process.kill(-pid, "SIGTERM");
    } catch {
      try {
        process.kill(pid, "SIGTERM");
      } catch {
        // 已退出
      }
    }
  }
}

/* ----------------------------- 网络面板与页面助手 ----------------------------- */

/** 网络面板：/admin/reports/* 的每条请求与响应。 */
const reportRequests = [];
const reportResponses = [];

function attachNetworkPanel(page) {
  page.on("request", (request) => {
    const url = request.url();
    if (!url.includes("/admin/reports/")) return;
    const parsed = new URL(url);
    const from = parsed.searchParams.get("from_ms");
    const to = parsed.searchParams.get("to_ms");
    reportRequests.push({
      url,
      path: parsed.pathname,
      from_ms: from === null ? null : Number(from),
      to_ms: to === null ? null : Number(to),
    });
  });
  page.on("response", (response) => {
    const url = response.url();
    if (!url.includes("/admin/reports/")) return;
    reportResponses.push({ url, path: new URL(url).pathname, status: response.status() });
  });
}

/** 轮询直到条件成立或超时（网络面板断言都用计数快照，不用盲等）；谓词可异步。 */
async function waitFor(predicate, timeoutMs = 8000, pollMs = 200) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return true;
    await sleep(pollMs);
  }
  return false;
}

function spanOf(entry) {
  return entry.to_ms !== null && entry.from_ms !== null ? entry.to_ms - entry.from_ms : null;
}

async function shot(page, name) {
  const file = path.join(OUT, name + ".png");
  await page.screenshot({ path: file, fullPage: false }).catch(() => {});
  return path.relative(ROOT, file).replaceAll("\\", "/");
}

/* ----------------------------------- 主流程 ----------------------------------- */

async function main() {
  const base = await startIsolatedServer();
  console.log("隔离站点：" + base + "（证据目录 " + path.relative(ROOT, OUT).replaceAll("\\", "/") + "）");

  const playwright = await loadPlaywright();
  if (!playwright) {
    console.error("未找到 playwright/playwright-core（web 依赖声明）");
    process.exitCode = 2;
    return;
  }
  const { browser } = await launchBrowser(playwright, { channel: CHANNEL, headed: HEADED });

  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, locale: "zh-CN" });
  attachNetworkPanel(page);
  page.setDefaultTimeout(10_000);

  try {
    await login(page, base);

    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const earliest = new Date(today);
    earliest.setDate(earliest.getDate() - (CAP_DAYS - 1)); // 366 天上限 → 今天 −365 天
    const isoEarliest = isoOf(earliest);
    const isoDayBefore = isoOf(new Date(earliest.getTime() - DAY_MS));
    const isoToday = isoOf(today);

    // 网络面板阶段标记：logs 注入 422 之前的所有响应都必须 != 422。
    const dashResponseMark = reportResponses.length;
    const dashRequestMark = reportRequests.length;

    await test("dashboard.load", "看板加载无错误边界（空库聚合返回 200）", async () => {
      await page.goto(base + "/dashboard", { waitUntil: "domcontentloaded" });
      await settle(page);
      const body = await page.locator("main").innerText();
      assert(!body.includes("页面渲染失败"), "命中错误边界");
      assert(body.includes("看板"), "未进入看板页");
    });

    const TRIGGER = 'button[aria-label^="时间区间："]';
    // react-day-picker v10：data-day 在 role=gridcell 的 Day 元素上，可点按钮在其内部。
    const dayCell = (iso) => page.locator(`[data-day="${iso}"]`);
    const dayButton = (iso) => dayCell(iso).locator("button").first();

    await test("calendar.beyond-cap-disabled", "日历禁用超界日期：最早可选日 = 今天−(上限−1) 天", async () => {
      await page.locator(TRIGGER).click();
      const popover = page.locator('[role="dialog"]');
      await popover.waitFor({ state: "visible", timeout: 5000 });
      // 导航到最早月（导航被 startMonth 夹住，循环自然收敛）。
      for (let i = 0; i < 15; i += 1) {
        if ((await dayCell(isoEarliest).count()) > 0) break;
        await page.locator("button.rdp-button_previous").click().catch(() => {});
        await page.waitForTimeout(120);
      }
      const earliestBtn = dayCell(isoEarliest);
      assert((await earliestBtn.count()) === 1, "最早可选日按钮未出现在日历（导航未到达最早月）");
      assert((await earliestBtn.getAttribute("data-disabled")) === null, "最早可选日被误禁用");
      const beforeBtn = dayCell(isoDayBefore);
      assert((await beforeBtn.count()) >= 1, "最早可选日的前一天未渲染（外部日应可见）");
      assert((await beforeBtn.getAttribute("data-disabled")) === "true", "上限外的日期未被禁用（下界缺口）");
      // 上界：今天可选（导航回当月由选择流程覆盖，这里直接用文字断言留证据）。
      await shot(page, "01-calendar-earliest-month");
    });

    await test("custom-range.publishes-and-200", "合法自定义窗发布：聚合请求发出且 200、跨度 ≤ 上限", async () => {
      const requestMark = reportRequests.length;
      await dayButton(isoEarliest).click();
      for (let i = 0; i < 15; i += 1) {
        if ((await dayCell(isoToday).count()) > 0) break;
        await page.locator("button.rdp-button_next").click().catch(() => {});
        await page.waitForTimeout(120);
      }
      await dayButton(isoToday).click();
      const fired = await waitFor(
        () =>
          reportRequests
            .slice(requestMark)
            .some((entry) => entry.path.endsWith("/timeseries") && entry.from_ms !== null),
      );
      assert(fired, "选择起止日后未见带 from_ms/to_ms 的 timeseries 请求（发布被拦截或未触发）");
      await settle(page, { timeoutMs: 5000, quietMs: 200 });
      const custom = reportRequests
        .slice(requestMark)
        .filter((entry) => entry.path.endsWith("/timeseries") && entry.from_ms !== null);
      assert(custom.length >= 1, "无自定义窗请求");
      const span = spanOf(custom[0]);
      assert(span !== null && span <= CAP_MS, `自定义窗跨度 ${span} 超过上限 ${CAP_MS}`);
      const timeseriesResponse = reportResponses.find(
        (entry) => entry.path.endsWith("/timeseries") && entry.status !== undefined,
      );
      assert(timeseriesResponse && timeseriesResponse.status === 200, "timeseries 非 200：" + (timeseriesResponse || {}).status);
      await shot(page, "02-custom-range-published");
    });

    await test("midnight.boundary-366", "「零点」恰好 366 天（上限边界）→ 请求 200", async () => {
      const requestMark = reportRequests.length;
      await page.getByRole("button", { name: "零点", exact: true }).click();
      const fired = await waitFor(() =>
        reportRequests
          .slice(requestMark)
          .some((entry) => entry.path.endsWith("/timeseries") && spanOf(entry) === CAP_MS),
      );
      assert(fired, "未发出跨度恰好 366 天的请求（边界被误拦）");
      await settle(page, { timeoutMs: 5000, quietMs: 200 });
      const boundaryResponse = reportResponses.find((entry) => entry.path.endsWith("/timeseries"));
      assert(boundaryResponse && boundaryResponse.status === 200, "边界 366 天窗应放行 200，实际 " + (boundaryResponse || {}).status);
    });

    await test("invalid-draft.no-request-and-red", "草稿非法：字段标红 + 行内文案，聚合请求零增长", async () => {
      const requestMark = reportRequests.length;
      const startInput = page.locator('input[aria-label="开始时刻"]');
      const endInput = page.locator('input[aria-label="结束时刻"]');
      const invalidText = page.locator("text=结束时刻需晚于开始时刻");
      try {
        // 先回预设（草稿清空、弹层关闭），再重开得到干净草稿：日历未选、时刻 00:00/23:59。
        await page.getByRole("radio", { name: "近 24 小时", exact: true }).click();
        await page.waitForTimeout(300);
        const popover = page.locator('[role="dialog"]');
        await page.locator(TRIGGER).click();
        await popover.waitFor({ state: "visible", timeout: 5000 });
        // 空选上首击即成单日区间 [today..today]，00:00→23:59 合法发布，请求照发（再击一次反而清空选择）。
        await dayButton(isoToday).click();
        const fired = await waitFor(
          () => reportRequests.slice(requestMark).some((entry) => entry.path.endsWith("/timeseries") && entry.from_ms !== null),
          5000,
        );
        assert(fired, "单日窗合法草稿未发出请求");
        // 弄脏草稿：开始改 23:59 → 结束（23:59）≤ 开始 → 只标红 + 行内文案，不发请求。
        const requestMark2 = reportRequests.length;
        await startInput.fill("23:59");
        await page.waitForTimeout(400);
        assert((await invalidText.count()) >= 1, "行内错误文案未出现");
        assert((await startInput.getAttribute("aria-invalid")) === "true", "开始时刻字段未标 aria-invalid");
        assert((await endInput.getAttribute("aria-invalid")) === "true", "结束时刻字段未标 aria-invalid");
        const main = await page.locator("main").innerText();
        assert(!main.includes("指标加载失败"), "校验错误不应触发页面级错误卡片");
        const grew = await waitFor(() => reportRequests.length > requestMark2, 1200, 200);
        assert(!grew, "非法草稿期间发出了新的聚合请求（前置校验未拦截）");
        await shot(page, "03-invalid-draft-red-field");
        // 修好草稿：开始回 00:00 → 草稿恢复合法（发布值与之前相同，不重发请求；红字消失即证明拦截解除）。
        await startInput.fill("00:00");
        const cleared = await waitFor(async () => (await invalidText.count()) === 0, 5000, 200);
        assert(cleared, "草稿修复后行内错误未消失");
      } finally {
        await page.keyboard.press("Escape").catch(() => {});
        await page.waitForTimeout(200);
      }
    });

    await test("preset-7d.regression", "预设「近 7 天」回归：状态切换生效，range=7d 查询 200", async () => {
      const popover = page.locator('[role="dialog"]');
      await page.locator(TRIGGER).click();
      await popover.waitFor({ state: "visible", timeout: 5000 });
      await page.getByRole("radio", { name: "近 7 天", exact: true }).click();
      // 切回 15s 内已缓存过的 range=7d 不会重发请求（QueryClient staleTime 15s）——
      // 回归证据是状态切换生效 + 初载时的 range=7d 聚合请求返回 200。
      const switched = await waitFor(async () =>
        String(await page.locator(TRIGGER).getAttribute("aria-label")).includes("近 7 天"),
      );
      assert(switched, "预设 7d 未生效（触发按钮文案未切换）");
      await settle(page, { timeoutMs: 5000, quietMs: 200 });
      const presetRequest = reportRequests.find(
        (entry) => entry.path.endsWith("/timeseries") && entry.url.includes("range=7d") && entry.from_ms === null,
      );
      assert(!!presetRequest, "全程未见 range=7d 预设请求（初载回归缺失）");
      const presetResponse = reportResponses.find(
        (entry) => entry.path.endsWith("/timeseries") && entry.url.includes("range=7d"),
      );
      assert(presetResponse && presetResponse.status === 200, "预设 7d timeseries 应 200，实际 " + (presetResponse || {}).status);
    });

    await test("network.aggregate", "看板全程网络面板：无超界跨度、无 4xx/5xx", async () => {
      const phase = reportResponses.slice(dashResponseMark);
      const overCap = reportRequests
        .slice(dashRequestMark)
        .filter((entry) => spanOf(entry) !== null && spanOf(entry) > CAP_MS);
      assert(overCap.length === 0, `发现 ${overCap.length} 条超上限跨度的聚合请求`);
      const bad = phase.filter((entry) => entry.status >= 400);
      assert(bad.length === 0, "看板阶段出现 4xx/5xx：" + JSON.stringify(bad.map((entry) => ({ path: entry.path, status: entry.status }))));
    });

    const logsResponseMark = reportResponses.length;

    await test("logs.latency-422-visible", "日志页 latency 422：可见错误态 + 通知中心落条（票 07）", async () => {
      await page.route("**/admin/reports/latency*", (route) =>
        route.fulfill({
          status: 422,
          contentType: "application/json",
          body: JSON.stringify({
            code: "VALIDATION_ERROR",
            message: "from_ms/to_ms span must not exceed 366 days",
            details: { max_span_ms: CAP_MS, max_span_days: CAP_DAYS },
            request_id: "probe-injected",
          }),
        }),
      );
      await page.goto(base + "/logs", { waitUntil: "domcontentloaded" });
      await settle(page);
      const errorRow = page.locator("text=延迟分位加载失败");
      assert((await errorRow.count()) >= 1, "latency 422 后未见「延迟分位加载失败」可见错误态");
      const main = await page.locator("main").innerText();
      assert(!main.includes("日志加载失败"), "日志表格不应受 latency 422 影响");
      const notifications = await page.evaluate(() =>
        JSON.parse(localStorage.getItem("slipstream.notifications.v1") || "[]"),
      );
      const hit = notifications.find(
        (item) => item.kind === "error" && item.title === "查询失败" && String(item.description || "").includes("span must not exceed 366 days"),
      );
      assert(!!hit, "通知中心未落「查询失败」条目（票 07 查询失败语义）");
      await shot(page, "04-logs-latency-422-visible");
      await page.unroute("**/admin/reports/latency*");
    });

    await test("network.dashboard-phase-clean", "看板阶段聚合响应零 4xx/5xx（422 只来自 logs 刻意注入）", async () => {
      const dashboardPhase = reportResponses.slice(dashResponseMark, logsResponseMark);
      const bad = dashboardPhase.filter((entry) => entry.status >= 400);
      assert(bad.length === 0, "看板阶段出现 4xx/5xx：" + JSON.stringify(bad.map((entry) => ({ path: entry.path, status: entry.status }))));
      const overCapAll = reportRequests.filter((entry) => spanOf(entry) !== null && spanOf(entry) > CAP_MS);
      assert(overCapAll.length === 0, `全程发现 ${overCapAll.length} 条超上限跨度的聚合请求`);
    });
  } finally {
    await browser.close().catch(() => {});
    stopIsolatedServer();
  }

  report();
}

async function login(page, base) {
  await page.goto(base + "/login", { waitUntil: "domcontentloaded", timeout: 30_000 });
  await page.waitForTimeout(300);
  await page.fill("#login-username", ADMIN_CRED.user);
  await page.fill("#login-password", ADMIN_CRED.pass);
  await page.click('button[type="submit"]');
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    if (!new URL(page.url()).pathname.startsWith("/login")) return;
    const error = await page.locator("p.text-danger-text").first().innerText().catch(() => "");
    if (error) throw new GuardError("登录失败：" + error);
    await page.waitForTimeout(200);
  }
  throw new GuardError("登录超时（检查隔离站点与账号）");
}

function report() {
  const passed = results.filter((entry) => entry.status === "PASS").length;
  const summary = `${passed}/${results.length} checks passed`;
  console.log("\n" + summary);
  const md = [
    "# W6 票 16 看板日期防护·网络面板探针",
    "",
    `- 时间：${new Date().toISOString()}`,
    `- 站点：${baseUrl()}`,
    `- 结果：${summary}`,
    "",
    "| id | 检查 | 结果 | 耗时 |",
    "|---|---|---|---|",
    ...results.map((entry) => `| ${entry.id} | ${entry.name} | ${entry.status} | ${entry.ms}ms |`),
  ].join("\n");
  fs.writeFileSync(path.join(OUT, "report.md"), md + "\n");
  fs.writeFileSync(path.join(OUT, "report.json"), JSON.stringify({ results, capMs: CAP_MS }, null, 2) + "\n");
  if (failures.length > 0) {
    console.error("\n未通过：");
    for (const failure of failures) console.error(`- ${failure.id}：${failure.message}`);
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error("探针环境失败：" + (error && error.message ? error.message : error));
  if (serverLog && fs.existsSync(serverLog)) console.error(tailServerLog());
  stopIsolatedServer();
  process.exitCode = error instanceof GuardError ? 2 : 1;
});
