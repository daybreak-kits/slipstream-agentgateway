#!/usr/bin/env node
/**
 * W7 ticket 05 验收：公开模型成员表格（spec User Stories 17–24、Implementation
 * Decisions「交互与界面-成员编辑」、Conflict Review C6、Testing Decisions 必测矩阵）。
 *
 * 覆盖：
 *   1. 左侧已选成员是表格：输入前置（优先级/权重/表达式在成员信息之前），中文标签，
 *      字段按当前路由策略出现——failover 只有优先级，weighted 加权重，conditional
 *      加表达式（US 17/18/19）；
 *   2. 候选成员始终保留在原位：点击加入后原地灰显、+ 变 ×，再点灰态候选取消选择，
 *      不消失、不重排；左侧已选只能通过行内 × 移除，点击行内输入不会误删（US 21/22/23）；
 *   3. 每行有显式展开控件（chevron）：展开/收起只改变当前行高度、后续行自然下移，
 *      不横向跳动（US 20）；
 *   4. 左右两栏的列头行等高、表头在同一水平线（US 24）；
 *   5. 375 下退化为卡片堆叠且不横向溢出（spec 响应式约定）；
 *   6. 保存后成员顺序和字段与表格显示一致（去重/兜底校验语义保留）。
 *
 * 运行：
 *   node ops/checks/acceptance/w7_member_table.mjs              # 自起隔离站点：API 3894 + web 3895
 *   node ops/checks/acceptance/w7_member_table.mjs --base-url http://127.0.0.1:3895   # 复用已起站点
 *   node ops/checks/acceptance/w7_member_table.mjs --headed
 *
 * 前提：web/dist 已构建（cd web && npx vite build）。脚本自管 seed/服务进程，结束后全部清理；
 * 使用临时 SQLite 与临时 ag-config，绝不触碰 3700/3600 与主仓库工作树。
 *
 * 退出码：0 全部 PASS；1 有 FAIL；2 环境/依赖未就绪。
 * 证据：ops/checks/.logs/acceptance/w7-member-table-<时间戳>/（report.md + *.png，.logs/ 不入库）。
 */
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { launchBrowser, loadPlaywright, parseCred, parseFlags, stamp, waitLoginOutcome } from "../lib/cli.mjs";
import { openSession, settle } from "../lib/session.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..", "..", "..");
const WEB_ROOT = path.join(ROOT, "web");
const API_ROOT = path.join(ROOT, "api");

const flags = parseFlags(process.argv.slice(2));
const API_PORT = Number(flags.get("api-port") || process.env.W7_MEMBER_API_PORT || 3894);
const WEB_PORT = Number(flags.get("web-port") || process.env.W7_MEMBER_WEB_PORT || 3895);
const HEADED = flags.has("headed");
const CHANNEL = flags.get("channel") || process.env.PLAYWRIGHT_CHANNEL || "";
const REUSE = Boolean(flags.get("base-url"));
const BASE_URL = (flags.get("base-url") || "").replace(/\/$/, "");
const ADMIN_CRED = parseCred(flags.get("admin") || process.env.W6_ADMIN, { user: "admin", pass: "admin12345" });
const OUT = path.resolve(flags.get("out") || path.join(ROOT, "ops", "checks", ".logs", "acceptance", "w7-member-table-" + stamp()));
fs.mkdirSync(OUT, { recursive: true });

/* DOM 契约（实现必须提供的稳定选择器）：左侧表格 + 行展开 + 右栏候选原位。 */
const LEFT_TABLE = '[data-slot="member-table"]';
const TABLE_HEAD = '[data-slot="member-table-head"]';
const ROW = '[data-slot="member-row"]';
const EXPAND = '[data-slot="member-row-expand"]';
const DETAIL = '[data-slot="member-row-detail"]';
const REMOVE = '[data-slot="member-row-remove"]';
const COL_HEAD = '[data-slot="member-column-head"]';
const CAND_HEAD = '[data-slot="member-candidate-head"]';
const CHIP = '[data-slot="member-candidate-chip"]';

const results = [];
let currentEvidence = [];
let browser = null;
let apiProc = null;
let webServer = null;
let serverLog = "";

class CheckError extends Error {}

function assert(condition, message) {
  if (!condition) throw new CheckError(message);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function rel(target) {
  return path.relative(ROOT, target).replace(/\\/g, "/");
}

/** 列表响应既可能是裸数组也可能是 {items} 信封（与前端 unwrapList 同口径）。 */
function listItems(body) {
  if (Array.isArray(body)) return body;
  return body && Array.isArray(body.items) ? body.items : [];
}

async function test(id, name, fn) {
  currentEvidence = [];
  const started = Date.now();
  try {
    const detail = await fn();
    results.push({ id, name, status: "pass", detail: detail || "", evidence: currentEvidence.slice(), ms: Date.now() - started });
    console.log("PASS " + id + " (" + (Date.now() - started) + "ms)" + (detail ? " — " + detail : ""));
    return true;
  } catch (error) {
    const message = String((error && error.message) || error);
    results.push({ id, name, status: "fail", detail: message, evidence: currentEvidence.slice(), ms: Date.now() - started });
    console.log("FAIL " + id + " — " + message);
    return false;
  }
}

/* ------------------------------------------------------------------ *
 * 1. 隔离站点：API 3894 + web 3895（静态托管 + /admin、/api 反代）
 * ------------------------------------------------------------------ */

function pythonExecutable() {
  const candidates = [
    process.env.W6_PYTHON || "",
    process.platform === "win32" ? path.join(API_ROOT, ".venv", "Scripts", "python.exe") : path.join(API_ROOT, ".venv", "bin", "python"),
    "python",
  ].filter(Boolean);
  return candidates.find((candidate) => candidate === "python" || fs.existsSync(candidate)) || "python";
}

function tailServerLog(lines = 14) {
  if (!serverLog || !fs.existsSync(serverLog)) return "";
  return fs.readFileSync(serverLog, "utf8").split(/\r?\n/).slice(-lines).join("\n");
}

async function waitForHealth(base, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError = "";
  while (Date.now() < deadline) {
    try {
      const response = await fetch(base + "/admin/health", { signal: AbortSignal.timeout(1500) });
      if (response.ok) return true;
      lastError = "HTTP " + response.status;
    } catch (error) {
      lastError = String((error && error.message) || error);
    }
    await sleep(400);
  }
  throw new CheckError("隔离站点未在 " + timeoutMs + "ms 内就绪：" + lastError + "\n" + tailServerLog());
}

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
};

/** web 站点：静态托管 web/dist，并把 /admin、/api 反代到隔离 API（保持 cookie 同源）。 */
function startWebServer(port, apiPort) {
  const dist = path.join(WEB_ROOT, "dist");
  const server = http.createServer((req, res) => {
    const url = new URL(req.url || "/", "http://127.0.0.1:" + port);
    if (url.pathname.startsWith("/admin") || url.pathname.startsWith("/api")) {
      const headers = { ...req.headers, host: "127.0.0.1:" + apiPort };
      const proxyReq = http.request(
        { hostname: "127.0.0.1", port: apiPort, path: req.url, method: req.method, headers },
        (proxyRes) => {
          res.writeHead(proxyRes.statusCode || 502, proxyRes.headers);
          proxyRes.pipe(res);
        },
      );
      proxyReq.on("error", () => {
        res.writeHead(502, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: { message: "isolated api unreachable" } }));
      });
      req.pipe(proxyReq);
      return;
    }
    let filePath = path.join(dist, decodeURIComponent(url.pathname));
    if (!filePath.startsWith(dist)) {
      res.writeHead(403);
      res.end();
      return;
    }
    if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) filePath = path.join(dist, "index.html");
    if (!fs.existsSync(filePath)) {
      res.writeHead(404);
      res.end("not found");
      return;
    }
    res.writeHead(200, { "content-type": MIME[path.extname(filePath)] || "application/octet-stream" });
    fs.createReadStream(filePath).pipe(res);
  });
  return new Promise((resolve, reject) => {
    server.on("error", reject);
    server.listen(port, "127.0.0.1", () => resolve(server));
  });
}

async function startIsolatedSite() {
  if (API_PORT === 3700 || API_PORT === 3600 || WEB_PORT === 3700 || WEB_PORT === 3600) {
    throw new CheckError("拒绝在 3700/3600 上运行（必须使用隔离端口 3894/3895）");
  }
  const distIndex = path.join(WEB_ROOT, "dist", "index.html");
  if (!fs.existsSync(distIndex)) {
    throw new CheckError("web/dist 不存在：先 cd web && npx vite build");
  }
  const serverDir = path.join(OUT, "server");
  fs.mkdirSync(path.join(serverDir, "ag-config"), { recursive: true });
  serverLog = path.join(serverDir, "server.log");
  const databaseFile = path.join(serverDir, "w7-member-table.db").replace(/\\/g, "/");
  const env = {
    ...process.env,
    PYTHONPATH: path.join(API_ROOT, "src"),
    PYTHONUTF8: "1",
    PYTHONIOENCODING: "utf-8",
    SLIPSTREAM_DATABASE_URL: "sqlite:///" + databaseFile,
    SLIPSTREAM_AG_CONFIG_DIR: path.join(serverDir, "ag-config"),
    SLIPSTREAM_AG_DB_PATH: path.join(serverDir, "ag-config", "ag-data.db"),
    SLIPSTREAM_WEB_DIST_DIR: path.join(WEB_ROOT, "dist"),
    SLIPSTREAM_JOBS_ENABLED: "0",
    SLIPSTREAM_ADMIN_USERNAME: ADMIN_CRED.user,
    SLIPSTREAM_ADMIN_PASSWORD: ADMIN_CRED.pass,
    SLIPSTREAM_SECRET_KEY: "w7-member-table-acceptance-only",
    SLIPSTREAM_COOKIE_SECURE: "0",
    SLIPSTREAM_AG_BINARY: "",
    SLIPSTREAM_AG_LLM_PORT: "0",
  };

  const seed = spawnSync(pythonExecutable(), ["scripts/seed_demo.py"], {
    cwd: API_ROOT,
    env,
    encoding: "utf8",
    timeout: 240000,
  });
  if (seed.status !== 0) {
    throw new CheckError("seed_demo.py 失败：" + String(seed.stderr || seed.stdout || "").slice(-800));
  }

  const logFd = fs.openSync(serverLog, "a");
  apiProc = spawn(
    pythonExecutable(),
    ["-m", "uvicorn", "l06_api.app:create_app", "--factory", "--host", "127.0.0.1", "--port", String(API_PORT)],
    { cwd: API_ROOT, env, stdio: ["ignore", logFd, logFd], windowsHide: true },
  );
  apiProc.on("exit", (code) => {
    if (code !== null && code !== 0 && apiProc) console.error("隔离 API 提前退出，code=" + code + "\n" + tailServerLog());
  });
  await waitForHealth("http://127.0.0.1:" + API_PORT);
  webServer = await startWebServer(WEB_PORT, API_PORT);
  return "http://127.0.0.1:" + WEB_PORT;
}

function stopIsolatedSite() {
  if (webServer) {
    try {
      webServer.close();
    } catch {
      // 已关闭
    }
    webServer = null;
  }
  const pid = apiProc ? apiProc.pid : null;
  apiProc = null;
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

/* ------------------------------------------------------------------ *
 * 2. 页面与读取助手
 * ------------------------------------------------------------------ */

async function shot(page, name) {
  const file = path.join(OUT, name + ".png");
  try {
    await page.screenshot({ path: file, fullPage: false });
    currentEvidence.push(rel(file));
    return rel(file);
  } catch {
    return "";
  }
}

/** 服务端 targets 按 (priority, id) 排序——与前端展示排序（priority 升序、同层保序）独立对照。 */
function sortedTargets(model) {
  return [...(model.targets ?? [])].sort(
    (left, right) => left.priority - right.priority || String(left.id).localeCompare(String(right.id)),
  );
}

function targetLabel(target) {
  const channel = (target.upstream_name ?? "").trim();
  return channel === "" ? target.upstream_model_name : channel + "/" + target.upstream_model_name;
}

/** 打开一个公开模型的整页编辑器并等稳定。 */
async function openModel(session, modelId) {
  const page = session.page;
  await page.goto(session.base + "/models/public/" + modelId, { waitUntil: "domcontentloaded", timeout: 30000 });
  await settle(page, { quietMs: 400 });
  await session.assertSane("公开模型编辑");
}

/** 读左侧表格：表头文本、每行（成员 id/标签/几何/行内输入）与文档横向状态。 */
async function readTable(page) {
  return page.evaluate(
    ({ tableSel, headSel, rowSel, labelSel }) => {
      const table = document.querySelector(tableSel);
      const head = document.querySelector(headSel);
      const heads = head
        ? [...head.querySelectorAll('[role="columnheader"], th')].map((el) => (el.textContent || "").trim())
        : [];
      const rows = [...document.querySelectorAll(rowSel)].map((row) => {
        const rect = row.getBoundingClientRect();
        const inputOf = (label) => row.querySelector('input[aria-label="' + label + '"]');
        const valueOf = (label) => {
          const el = inputOf(label);
          return el ? el.value : null;
        };
        const label = row.querySelector(labelSel);
        return {
          upstreamModelId: row.getAttribute("data-upstream-model-id"),
          label: label ? (label.textContent || "").trim() : "",
          y: rect.y,
          x: rect.x,
          height: rect.height,
          width: rect.width,
          priority: valueOf("priority"),
          weight: valueOf("weight"),
          when: valueOf("when"),
          inputs: [...row.querySelectorAll("input")].map((el) => el.getAttribute("aria-label")),
        };
      });
      const tableRect = table ? table.getBoundingClientRect() : null;
      return {
        hasTable: Boolean(table),
        hasHead: Boolean(head),
        heads,
        rows,
        tableWidth: tableRect ? tableRect.width : 0,
        tableX: tableRect ? tableRect.x : 0,
        docWidth: document.documentElement.scrollWidth,
        viewWidth: window.innerWidth,
      };
    },
    { tableSel: LEFT_TABLE, headSel: TABLE_HEAD, rowSel: ROW, labelSel: '[data-slot="member-row-label"]' },
  );
}

/** 读右栏候选：id、选中态、aria 标签——顺序即 DOM 顺序（断言「不重排」用）。 */
async function readCandidates(page) {
  return page.evaluate((chipSel) => {
    return [...document.querySelectorAll(chipSel)].map((chip) => ({
      id: chip.getAttribute("data-upstream-model-id"),
      selected: chip.getAttribute("data-selected") === "true",
      label: chip.getAttribute("aria-label") || "",
      pressed: chip.getAttribute("aria-pressed"),
    }));
  }, CHIP);
}

function rowLocator(page, upstreamModelId) {
  return page.locator(ROW + '[data-upstream-model-id="' + upstreamModelId + '"]');
}

async function fillField(page, upstreamModelId, label, value) {
  await rowLocator(page, upstreamModelId).locator('input[aria-label="' + label + '"]').fill(value);
  await page.waitForTimeout(200);
}

/** 点击页头「保存」并等待单 PATCH 返回 200（ticket 12 契约：一次保存一个 PATCH）。 */
async function savePage(page) {
  const saveBtn = page.locator('[data-slot="header-save"] button', { hasText: "保存" }).first();
  assert(await saveBtn.isEnabled(), "保存按钮应可用（校验未通过时是禁用的）");
  const [response] = await Promise.all([
    page.waitForResponse(
      (res) => res.request().method() === "PATCH" && res.url().includes("/admin/public-models/"),
      { timeout: 15000 },
    ),
    saveBtn.click(),
  ]);
  assert(response.status() === 200, "PATCH /admin/public-models 应 200，实际 " + response.status() + " " + (await response.text()).slice(0, 200));
  await page.waitForTimeout(500);
  return response;
}

/** 有脏态时点页头「恢复全部」回到基线（避免 beforeunload 守卫拦住后续导航）。 */
async function resetIfDirty(page) {
  const reset = page.getByRole("button", { name: "恢复全部" });
  if ((await reset.count()) > 0 && (await reset.first().isVisible())) {
    await reset.first().click();
    await page.waitForTimeout(300);
  }
  assert((await page.locator('[data-slot="dirty-count"]').count()) === 0, "恢复后不应残留未保存计数");
}

/* ------------------------------------------------------------------ *
 * 3. 验收项
 * ------------------------------------------------------------------ */

async function runChecks(session) {
  const page = session.page;

  const models = await session.apiGet("/admin/public-models");
  assert(models.status === 200, "读取公开模型失败：" + models.status);
  const publicModels = listItems(models.body);
  const byName = (name) => {
    const found = publicModels.find((item) => item.name === name);
    assert(found, "种子里没有公开模型 " + name);
    return found;
  };
  const failoverModel = byName("glm-5.3");
  const weightedModel = byName("qwen-max");

  await test("fields.failover", "failover 表格只有「优先级」输入，中文表头，成员行与服务端 targets 一致（US 17/18/19）", async () => {
    await openModel(session, failoverModel.id);
    const table = await readTable(page);
    assert(table.hasTable && table.hasHead, "左侧必须是表格结构（member-table + member-table-head）");
    assert(table.heads.some((text) => text.includes("优先级")), "表头必须有中文「优先级」，实际：" + JSON.stringify(table.heads));
    assert(!table.heads.some((text) => text.includes("权重") || text.includes("表达式")), "failover 表头不得出现「权重/表达式」：" + JSON.stringify(table.heads));
    const expected = sortedTargets(failoverModel);
    assert(table.rows.length === expected.length, "行数应等于成员数 " + expected.length + "，实际 " + table.rows.length);
    for (const row of table.rows) {
      assert(
        JSON.stringify(row.inputs) === JSON.stringify(["priority"]),
        "failover 每行只能有 priority 输入，实际：" + JSON.stringify(row.inputs) + "（" + row.label + "）",
      );
      const target = expected.find((item) => item.upstream_model_id === row.upstreamModelId);
      assert(target, "行 " + row.upstreamModelId + " 不在服务端 targets 里");
      assert(row.label === targetLabel(target), "成员名应为「上游渠道/模型」，实际 " + row.label + " 期望 " + targetLabel(target));
    }
    await shot(page, "member-fields-failover");
    return table.rows.length + " 行 × 优先级输入；表头 " + JSON.stringify(table.heads);
  });

  await test("fields.weighted", "weighted 表格出现「权重」输入并回显服务端 weight（US 19）", async () => {
    await openModel(session, weightedModel.id);
    const table = await readTable(page);
    assert(table.heads.some((text) => text.includes("优先级")), "表头必须有「优先级」");
    assert(table.heads.some((text) => text.includes("权重")), "weighted 表头必须有中文「权重」，实际：" + JSON.stringify(table.heads));
    assert(!table.heads.some((text) => text.includes("表达式")), "weighted 表头不得出现「表达式」：" + JSON.stringify(table.heads));
    const expected = sortedTargets(weightedModel);
    for (const row of table.rows) {
      assert(
        JSON.stringify(row.inputs) === JSON.stringify(["priority", "weight"]),
        "weighted 每行应有 priority+weight 输入，实际：" + JSON.stringify(row.inputs),
      );
      const target = expected.find((item) => item.upstream_model_id === row.upstreamModelId);
      assert(target, "行 " + row.upstreamModelId + " 不在服务端 targets 里");
      assert(
        row.weight === String(target.weight),
        "权重输入应回显服务端值 " + target.weight + "，实际 " + row.weight + "（" + row.label + "）",
      );
    }
    await shot(page, "member-fields-weighted");
    return table.rows.length + " 行 × priority+weight";
  });

  await test("candidate.toggle", "候选保留原位：加入后灰显 + 变 ×，再点取消；不消失不重排；行内输入不误删（US 21/22/23）", async () => {
    await openModel(session, weightedModel.id);
    const upstreamModels = await session.apiGet("/admin/upstream-models?page_size=200");
    assert(upstreamModels.status === 200, "读取上游模型失败：" + upstreamModels.status);
    const allModels = listItems(upstreamModels.body);

    const joinedIds = sortedTargets(weightedModel).map((item) => item.upstream_model_id);
    let candidates = await readCandidates(page);
    assert(candidates.length === allModels.length, "候选应全量渲染（含已选灰态）：期望 " + allModels.length + " 实际 " + candidates.length);
    for (const id of joinedIds) {
      const chip = candidates.find((item) => item.id === id);
      assert(chip && chip.selected, "已选成员 " + id + " 的候选 chip 必须存在且灰显（data-selected）");
      assert(chip.label.startsWith("取消选择"), "已选候选的 aria-label 应是「取消选择成员 …」，实际：" + chip.label);
    }

    const beforeOrder = candidates.map((item) => item.id).join(",");
    const unselectedId = candidates.find((item) => !item.selected).id;

    // 点灰态候选 → 取消选择：左栏少一行，chip 原地变回「加入」。
    await page.locator(CHIP + '[data-upstream-model-id="' + joinedIds[0] + '"]').click();
    await page.waitForTimeout(300);
    let table = await readTable(page);
    assert(table.rows.length === joinedIds.length - 1, "点灰态候选后左栏应少一行，实际 " + table.rows.length);
    candidates = await readCandidates(page);
    assert(candidates.map((item) => item.id).join(",") === beforeOrder, "取消选择不得重排候选：" + candidates.map((item) => item.id).join(","));
    const toggledOff = candidates.find((item) => item.id === joinedIds[0]);
    assert(!toggledOff.selected && toggledOff.label.startsWith("加入成员"), "取消后候选应回到「加入成员 …」：" + toggledOff.label);

    // 再点一次 → 加回；随后点一个未选中候选再加一个成员，最后都撤销，回到基线。
    await page.locator(CHIP + '[data-upstream-model-id="' + joinedIds[0] + '"]').click();
    await page.waitForTimeout(300);
    table = await readTable(page);
    assert(table.rows.length === joinedIds.length, "再点候选后左栏应恢复行数，实际 " + table.rows.length);
    await page.locator(CHIP + '[data-upstream-model-id="' + unselectedId + '"]').click();
    await page.waitForTimeout(300);
    table = await readTable(page);
    assert(table.rows.length === joinedIds.length + 1, "点未选中候选后左栏应加一行，实际 " + table.rows.length);
    candidates = await readCandidates(page);
    assert(candidates.map((item) => item.id).join(",") === beforeOrder, "加入成员不得重排候选（原位灰显）");
    const added = candidates.find((item) => item.id === unselectedId);
    assert(added.selected && added.label.startsWith("取消选择"), "加入后候选应原地灰显为「取消选择成员 …」：" + added.label);
    await shot(page, "member-candidates");

    // 点行内输入不得误删成员（US 23：左栏只能通过 × 移除）。
    await rowLocator(page, joinedIds[0]).locator('input[aria-label="priority"]').click();
    await page.waitForTimeout(200);
    table = await readTable(page);
    assert(table.rows.length === joinedIds.length + 1, "点击行内输入不得移除成员，实际 " + table.rows.length + " 行");

    // 左栏行内 × 移除。
    await rowLocator(page, unselectedId).locator(REMOVE).click();
    await page.waitForTimeout(300);
    table = await readTable(page);
    assert(table.rows.length === joinedIds.length, "行内 × 应移除成员，实际 " + table.rows.length + " 行");
    assert(!table.rows.some((row) => row.upstreamModelId === unselectedId), "被移除成员不应再出现在左栏");

    // 收尾：取消选择未恢复干净（toggled chip 回来时 priority 是 max+1，顺序可能与基线不同），恢复全部兜底。
    await resetIfDirty(page);
    return "候选 " + candidates.length + " 个原位不重排；加入/取消/移除往返一致";
  });

  await test("expand.row", "chevron 展开/收起只改变当前行高度，后续行下移且无横向跳动（US 20）", async () => {
    await openModel(session, weightedModel.id);
    let table = await readTable(page);
    assert(table.rows.length >= 2, "至少两行才能观察「后续行下移」");
    const firstId = table.rows[0].upstreamModelId;
    const secondId = table.rows[1].upstreamModelId;
    const beforeFirst = table.rows[0];
    const beforeSecond = table.rows[1];
    const tableWidthBefore = table.tableWidth;
    const removeBox = await rowLocator(page, firstId).locator(REMOVE).boundingBox();

    await rowLocator(page, firstId).locator(EXPAND).click();
    await page.waitForTimeout(300);
    table = await readTable(page);
    assert(table.hasDetail, "展开后必须出现展开区（member-row-detail）");
    const expandedFirst = table.rows.find((row) => row.upstreamModelId === firstId);
    const expandedSecond = table.rows.find((row) => row.upstreamModelId === secondId);
    assert(expandedFirst.height > beforeFirst.height + 10, "展开后行高必须增大：" + beforeFirst.height + " → " + expandedFirst.height);
    assert(expandedSecond.y > beforeSecond.y + 5, "后续行必须自然下移：" + beforeSecond.y + " → " + expandedSecond.y);
    assert(Math.abs(expandedSecond.x - beforeSecond.x) < 0.5, "后续行不得横向跳动：" + beforeSecond.x + " → " + expandedSecond.x);
    const removeAfter = await rowLocator(page, firstId).locator(REMOVE).boundingBox();
    assert(Math.abs(removeAfter.x - removeBox.x) < 0.5, "展开不得造成行内横向跳动：移除按钮 x " + removeBox.x + " → " + removeAfter.x);
    assert(Math.abs(table.tableWidth - tableWidthBefore) < 0.5, "展开不得改变表格宽度：" + tableWidthBefore + " → " + table.tableWidth);
    const detailText = await page.locator(DETAIL).first().innerText();
    assert(detailText.trim().length > 0, "展开区必须有内容");
    await shot(page, "member-expand");

    const expandBtn = rowLocator(page, firstId).locator(EXPAND);
    assert((await expandBtn.getAttribute("aria-expanded")) === "true", "展开态 chevron 必须 aria-expanded=true");
    await expandBtn.click();
    await page.waitForTimeout(300);
    table = await readTable(page);
    assert(!table.hasDetail, "收起后展开区必须消失");
    const collapsedFirst = table.rows.find((row) => row.upstreamModelId === firstId);
    const collapsedSecond = table.rows.find((row) => row.upstreamModelId === secondId);
    assert(Math.abs(collapsedFirst.height - beforeFirst.height) < 1, "收起后行高应复原：" + collapsedFirst.height + " vs " + beforeFirst.height);
    assert(Math.abs(collapsedSecond.y - beforeSecond.y) < 1, "收起后后续行应回到原位：" + collapsedSecond.y + " vs " + beforeSecond.y);
    return "行高 " + beforeFirst.height.toFixed(0) + " → " + expandedFirst.height.toFixed(0) + " → " + collapsedFirst.height.toFixed(0);
  });

  await test("head.align", "左右列头行等高、表头在同一水平线（US 24）", async () => {
    await openModel(session, weightedModel.id);
    const boxes = await page.evaluate(
      ({ colHeadSel, tableHeadSel, candHeadSel }) => {
        const boxOf = (el) => {
          if (!el) return null;
          const rect = el.getBoundingClientRect();
          return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
        };
        return {
          left: boxOf(document.querySelector(colHeadSel + '[data-column="left"]')),
          right: boxOf(document.querySelector(colHeadSel + '[data-column="right"]')),
          tableHead: boxOf(document.querySelector(tableHeadSel)),
          candHead: boxOf(document.querySelector(candHeadSel)),
        };
      },
      { colHeadSel: COL_HEAD, tableHeadSel: TABLE_HEAD, candHeadSel: CAND_HEAD },
    );
    assert(boxes.left && boxes.right, "左右两栏都必须有列头（member-column-head）");
    assert(boxes.tableHead && boxes.candHead, "左表头（member-table-head）与右候选表头（member-candidate-head）都必须存在");
    assert(
      Math.abs(boxes.left.y - boxes.right.y) < 1 && Math.abs(boxes.left.height - boxes.right.height) < 1,
      "左右列头必须等高且同一水平线：左 y=" + boxes.left.y + " h=" + boxes.left.height + "，右 y=" + boxes.right.y + " h=" + boxes.right.height,
    );
    assert(
      Math.abs(boxes.tableHead.y - boxes.candHead.y) < 1,
      "左表头与右候选表头必须在同一水平线：y " + boxes.tableHead.y + " vs " + boxes.candHead.y,
    );
    await shot(page, "member-head-align");
    return "列头 y=" + boxes.left.y.toFixed(1) + "/" + boxes.right.y.toFixed(1) + "，表头 y=" + boxes.tableHead.y.toFixed(1) + "/" + boxes.candHead.y.toFixed(1);
  });

  await test("save.weighted", "改优先级重排 + 改权重，保存后成员顺序与字段和表格显示一致（必测矩阵）", async () => {
    await openModel(session, weightedModel.id);
    const targets = sortedTargets(weightedModel);
    assert(targets.length === 2, "夹具 qwen-max 应有 2 个成员，实际 " + targets.length);
    const [first, second] = targets;

    // 交换优先级：first → 2，second → 1；表格应实时重排为 second 在前。
    await fillField(page, first.upstream_model_id, "priority", "2");
    await fillField(page, second.upstream_model_id, "priority", "1");
    // 权重改为 30 / 70。
    await fillField(page, second.upstream_model_id, "weight", "30");
    await fillField(page, first.upstream_model_id, "weight", "70");

    let table = await readTable(page);
    assert(table.rows[0].upstreamModelId === second.upstream_model_id, "priority 改小后表格应实时重排，首行应是 " + second.upstream_model_id);
    assert(table.rows[0].weight === "30" && table.rows[1].weight === "70", "表格行内权重应为 30/70，实际 " + table.rows.map((row) => row.weight).join("/"));
    await shot(page, "member-save-weighted-draft");

    await savePage(page);

    // 独立事实源：重新拉 API，断言落库顺序/字段与表格一致。
    const after = await session.apiGet("/admin/public-models");
    assert(after.status === 200, "保存后读取公开模型失败：" + after.status);
    const saved = listItems(after.body).find((item) => item.id === weightedModel.id);
    const savedTargets = sortedTargets(saved);
    assert(savedTargets.length === 2, "保存后仍应有 2 个成员");
    assert(savedTargets[0].upstream_model_id === second.upstream_model_id && savedTargets[0].priority === 1, "落库第一成员应是 " + second.upstream_model_id + " priority=1，实际 " + JSON.stringify(savedTargets[0]));
    assert(savedTargets[1].upstream_model_id === first.upstream_model_id && savedTargets[1].priority === 2, "落库第二成员应是 " + first.upstream_model_id + " priority=2");
    assert(savedTargets[0].weight === 30 && savedTargets[1].weight === 70, "落库权重应是 30/70，实际 " + savedTargets.map((item) => item.weight).join("/"));

    // 页面显示与落库一致（保存成功后表单规范化回填）。
    table = await readTable(page);
    assert(table.rows[0].upstreamModelId === second.upstream_model_id && table.rows[0].weight === "30", "保存后表格首行应与落库一致");
    assert(table.rows[1].upstreamModelId === first.upstream_model_id && table.rows[1].weight === "70", "保存后表格次行应与落库一致");
    assert((await page.locator('[data-slot="dirty-count"]').count()) === 0, "保存成功后不应残留脏计数");
    await shot(page, "member-save-weighted");
    return "落库顺序 [" + savedTargets.map((item) => item.priority).join(",") + "] 权重 [" + savedTargets.map((item) => item.weight).join(",") + "]";
  });

  await test("mobile.cards", "375 下退化为卡片堆叠：无横向溢出、表头隐藏、候选 toggle 仍可用", async () => {
    const previous = page.viewportSize();
    await page.setViewportSize({ width: 375, height: 800 });
    await page.goto(session.base + "/models/public/" + weightedModel.id, { waitUntil: "domcontentloaded", timeout: 30000 });
    await settle(page, { quietMs: 400 });
    await session.assertSane("公开模型编辑(375)");
    const table = await readTable(page);
    assert(table.docWidth <= table.viewWidth + 1, "375 下不得出现文档级横向溢出：" + table.docWidth + " > " + table.viewWidth);
    const headVisible = await page.locator(TABLE_HEAD).isVisible().catch(() => false);
    assert(!headVisible, "375 下表格表头应隐藏（卡片堆叠代替表格）");
    assert(table.rows.length >= 2, "375 下成员应渲染为卡片行");
    for (const row of table.rows) {
      assert(row.width <= table.viewWidth + 1, "卡片不得超出视口宽度：" + row.width);
    }
    for (let i = 1; i < table.rows.length; i += 1) {
      assert(table.rows[i].y >= table.rows[i - 1].y + table.rows[i - 1].height - 1, "卡片必须纵向堆叠，第 " + (i + 1) + " 张与上一张重叠");
    }
    const priority = rowLocator(page, table.rows[0].upstreamModelId).locator('input[aria-label="priority"]');
    assert(await priority.isVisible(), "375 下优先级输入必须可见可编辑");

    // 375 下候选 toggle 仍可用：加入 → 候选原位灰显；再点取消。
    const candidates = await readCandidates(page);
    const unselectedId = candidates.find((item) => !item.selected).id;
    await page.locator(CHIP + '[data-upstream-model-id="' + unselectedId + '"]').click();
    await page.waitForTimeout(300);
    let after = await readTable(page);
    assert(after.rows.length === table.rows.length + 1, "375 下点候选应加一行");
    await page.locator(CHIP + '[data-upstream-model-id="' + unselectedId + '"]').click();
    await page.waitForTimeout(300);
    after = await readTable(page);
    assert(after.rows.length === table.rows.length, "375 下再点灰态候选应取消选择");
    await resetIfDirty(page);
    await shot(page, "member-mobile-375");
    await page.setViewportSize(previous);
    await page.waitForTimeout(200);
    return "375 卡片 " + table.rows.length + " 张，scrollWidth " + table.docWidth + " ≤ " + table.viewWidth;
  });

  await test("save.conditional", "切 conditional 后出现「表达式」，末位留空兜底，保存后 when 与顺序落库一致（US 19 + 兜底校验）", async () => {
    await openModel(session, failoverModel.id);
    await page.locator('[data-slot="strategy-card"]', { hasText: "conditional" }).first().click();
    await page.waitForTimeout(300);
    let table = await readTable(page);
    assert(table.heads.some((text) => text.includes("表达式")), "conditional 表头必须有中文「表达式」，实际：" + JSON.stringify(table.heads));
    assert(!table.heads.some((text) => text.includes("权重")), "conditional 表头不得出现「权重」：" + JSON.stringify(table.heads));
    const targets = sortedTargets(failoverModel);
    for (const row of table.rows) {
      assert(
        JSON.stringify(row.inputs) === JSON.stringify(["priority", "when"]),
        "conditional 每行应有 priority+when 输入，实际：" + JSON.stringify(row.inputs),
      );
    }

    // 前面的成员填表达式，末位留空 = 兜底（validateMembers 的兜底校验语义）。
    await fillField(page, targets[0].upstream_model_id, "when", 'request.tier == "pro"');
    await fillField(page, targets[1].upstream_model_id, "when", 'request.tier == "std"');
    table = await readTable(page);
    assert(table.rows.some((row) => row.upstreamModelId === targets[targets.length - 1].upstreamModelId && row.when === ""), "末位成员应保持表达式为空（兜底）");

    await savePage(page);
    const after = await session.apiGet("/admin/public-models");
    const saved = listItems(after.body).find((item) => item.id === failoverModel.id);
    assert(saved.routing_mode === "conditional", "保存后 routing_mode 应是 conditional，实际 " + saved.routing_mode);
    const savedTargets = sortedTargets(saved);
    assert(savedTargets[0].when === 'request.tier == "pro"', "首位 when 落库不符：" + savedTargets[0].when);
    assert(savedTargets[1].when === 'request.tier == "std"', "第二位 when 落库不符：" + savedTargets[1].when);
    assert(savedTargets[savedTargets.length - 1].when === "", "末位 when 应保持为空（兜底）");
    table = await readTable(page);
    assert(table.rows[0].when === 'request.tier == "pro"', "保存后表格 when 应与落库一致");
    await shot(page, "member-save-conditional");
    return "when 落库 " + savedTargets.map((item) => JSON.stringify(item.when)).join(" / ");
  });
}

/* ------------------------------------------------------------------ *
 * 4. 主流程
 * ------------------------------------------------------------------ */

async function main() {
  if (!REUSE && (API_PORT === 3700 || WEB_PORT === 3700)) {
    console.error("拒绝在 3700 上运行（隔离端口应为 3894/3895）");
    process.exitCode = 2;
    return;
  }
  const playwright = await loadPlaywright();
  if (!playwright) {
    console.error("未找到 playwright / playwright-core（先在 web 目录 npm install）");
    process.exitCode = 2;
    return;
  }

  let base = BASE_URL;
  if (!base) {
    try {
      base = await startIsolatedSite();
      console.log("隔离站点已起：" + base + "（API " + API_PORT + "）");
    } catch (error) {
      console.error(String((error && error.message) || error));
      process.exitCode = 2;
      return;
    }
  } else {
    console.log("复用已起站点：" + base);
  }

  const launched = await launchBrowser(playwright, { channel: CHANNEL, headed: HEADED });
  browser = launched.browser;

  try {
    const session = await openSession(browser, { base, apiBase: base, role: "admin" });
    // beforeunload 守卫：脏态泄漏时接受对话框放行导航，避免卡死后续用例。
    session.page.on("dialog", (dialog) => dialog.accept().catch(() => {}));
    const outcome = await session.login(ADMIN_CRED);
    assert(outcome.ok, "登录失败：" + outcome.message);
    await runChecks(session);
    await session.close();
  } catch (error) {
    console.error(String((error && error.message) || error));
    results.push({ id: "run", name: "验收脚本执行", status: "fail", detail: String((error && error.message) || error), evidence: [] });
  } finally {
    if (browser) await browser.close().catch(() => {});
    stopIsolatedSite();
  }

  const failed = results.filter((row) => row.status === "fail");
  const report = [
    "# W7 ticket 05 · 公开模型成员表格浏览器验收",
    "",
    "- 时间：" + new Date().toISOString(),
    "- 站点：" + base,
    "- 结果：" + (results.length - failed.length) + "/" + results.length + " 通过",
    "",
    "| 用例 | 结果 | 说明 |",
    "| --- | --- | --- |",
    ...results.map((row) => "| " + row.id + " | " + row.status + " | " + String(row.detail).replace(/\|/g, "\\|") + " |"),
    "",
  ].join("\n");
  fs.writeFileSync(path.join(OUT, "report.md"), report, "utf8");

  console.log("\n" + (results.length - failed.length) + "/" + results.length + " 通过");
  if (failed.length > 0) {
    console.error("未通过：");
    for (const row of failed) console.error("- " + row.id + "：" + row.detail);
    process.exitCode = 1;
  }
}

await main();
