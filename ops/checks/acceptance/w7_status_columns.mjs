#!/usr/bin/env node
/**
 * W7 ticket 10 验收：状态列删除与模型状态图标（spec User Story 34/35/49；
 * Implementation Decisions「交互与界面-状态」「API 与契约-状态相关」；Conflict Review C11）。
 *
 * 覆盖：
 *   1. 四类表格（用户 / 上游渠道 / 连接密钥 / 模型管理两 Tab）表头没有「状态」列；
 *   2. 操作列仍在，且末行操作内容的右缘贴表格右缘（≤16px，与 W6 口径一致）；
 *   3. normal 模型名旁没有状态图标，也不留空占位；
 *   4. closed / cooling / unknown 三态都有图标，悬浮文案正确；
 *   5. 冷却解除时间格式固定 yyyy-mm-dd hh:mm:ss，且与 API 返回的截止时间一致；
 *   6. 键盘 Tab 聚焦状态图标即打开同一份详情；
 *   7. 删列后行底色仍区分关闭（微灰）/ 冷却（微黄）/ 正常（无底色）；
 *   8. 排序与筛选契约没被删列破坏（表头排序三态图标 + 筛选框）；
 *   9. 375 宽度与深色主题下图标与悬浮详情仍可读、不出屏。
 *
 * 运行：
 *   node ops/checks/acceptance/w7_status_columns.mjs              # 自起隔离站点：API 3906 + web 3907
 *   node ops/checks/acceptance/w7_status_columns.mjs --base-url http://127.0.0.1:3907   # 复用已起站点
 *   node ops/checks/acceptance/w7_status_columns.mjs --headed
 *
 * 前提：web/dist 已构建（cd web && npx vite build）。脚本自管 seed/服务进程，结束后全部清理；
 * 使用临时 SQLite 与临时 ag-config，绝不触碰 3700/3600 与主仓库工作树。
 *
 * 夹具：seed 里所有模型都是正常态。用控制面 API 造两种非正常态（与页面读的是同一份投影）：
 *   - 关闭：PATCH /admin/upstream-models/{id} {enabled:false} → availability.state=closed；
 *   - 冷却：PATCH /admin/upstream-models/{id} {cooldown_until_ms:now+2h} → availability.state=cooling。
 * 未知态是「控制台不认识的状态」，后端投影只有 normal/cooling/closed，只能由响应改写制造：
 * 拦一份 /admin/upstream-models 响应，把一行改成未知 state，断言页面给出「状态未知」而不是装作正常。
 *
 * 退出码：0 全部 PASS；1 有 FAIL；2 环境/依赖未就绪。
 * 证据：ops/checks/.logs/acceptance/w7-status-columns-<时间戳>/（report.md + *.png，.logs/ 不入库）。
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
const API_PORT = Number(flags.get("api-port") || process.env.W7_STATUS_API_PORT || 3906);
const WEB_PORT = Number(flags.get("web-port") || process.env.W7_STATUS_WEB_PORT || 3907);
const HEADED = flags.has("headed");
const CHANNEL = flags.get("channel") || process.env.PLAYWRIGHT_CHANNEL || "";
const REUSE = Boolean(flags.get("base-url"));
const BASE_URL = (flags.get("base-url") || "").replace(/\/$/, "");
const ADMIN_CRED = parseCred(flags.get("admin") || process.env.W6_ADMIN, { user: "admin", pass: "admin12345" });
const OUT = path.resolve(flags.get("out") || path.join(ROOT, "ops", "checks", ".logs", "acceptance", "w7-status-columns-" + stamp()));
fs.mkdirSync(OUT, { recursive: true });

const TRIGGER = '[data-hover-info="trigger"]';
const PANEL = '[data-slot="hover-info-panel"]';
const ICON = '[data-status-icon]';

/** 夹具用的两个上游模型（种子里确定存在，页面上按名字定位行）。 */
const CLOSED_MODEL = "glm-4.6";
const COOLING_MODEL = "glm-4.5-air";
const NORMAL_MODEL = "glm-5.3";
/** 冷却夹具的时长（毫秒）：2 小时，够脚本跑完又不至于过期。 */
const COOLDOWN_MS = 2 * 60 * 60 * 1000;

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
 * 1. 隔离站点：API 3906 + web 3907（静态托管 + /admin、/api 反代）
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
    throw new CheckError("拒绝在 3700/3600 上运行（必须使用隔离端口 3906/3907）");
  }
  const distIndex = path.join(WEB_ROOT, "dist", "index.html");
  if (!fs.existsSync(distIndex)) {
    throw new CheckError("web/dist 不存在：先 cd web && npx vite build");
  }
  const serverDir = path.join(OUT, "server");
  fs.mkdirSync(path.join(serverDir, "ag-config"), { recursive: true });
  serverLog = path.join(serverDir, "server.log");
  const databaseFile = path.join(serverDir, "w7-status-columns.db").replace(/\\/g, "/");
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
    SLIPSTREAM_SECRET_KEY: "w7-status-columns-acceptance-only",
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
 * 2. 浏览器断言助手
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

/** 浮层快照：位置、内容、父节点（portal 判定）。 */
function readPanel(page) {
  return page.evaluate((selector) => {
    const el = document.querySelector(selector);
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    return {
      parentTag: el.parentElement ? el.parentElement.tagName : "",
      role: el.getAttribute("role") || "",
      text: (el.textContent || "").trim(),
      box: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      viewport: { width: window.innerWidth, height: window.innerHeight },
    };
  }, PANEL);
}

/** 表头文本列表（每张表一行）。 */
function readHeaders(page) {
  return page.evaluate(() =>
    [...document.querySelectorAll("table")].map((table) =>
      [...table.querySelectorAll("thead th")].map((th) => (th.textContent || "").trim()),
    ),
  );
}

/** 按模型名定位所在行（表内某个元素的文本正好等于模型名）。 */
function findRowIndex(page, modelName) {
  return page.evaluate((needle) => {
    const rows = [...document.querySelectorAll("tbody tr")];
    return rows.findIndex((tr) =>
      [...tr.querySelectorAll("td")].some((td) =>
        [...td.querySelectorAll("*")]
          .map((el) => (el.textContent || "").trim())
          .includes(needle),
      ),
    );
  }, modelName);
}

/** 行内状态图标信息：kind、是否可聚焦、位置。 */
function readRowIcons(page, modelName) {
  return page.evaluate((needle) => {
    const rows = [...document.querySelectorAll("tbody tr")];
    const row = rows.find((tr) =>
      [...tr.querySelectorAll("td")].some((td) =>
        [...td.querySelectorAll("*")]
          .map((el) => (el.textContent || "").trim())
          .includes(needle),
      ),
    );
    if (!row) return null;
    const icons = [...row.querySelectorAll("[data-status-icon]")].map((el) => {
      const rect = el.getBoundingClientRect();
      return {
        kind: el.getAttribute("data-status-icon") || "",
        label: el.getAttribute("aria-label") || "",
        tabIndex: el.getAttribute("tabindex") || "",
        width: rect.width,
        height: rect.height,
      };
    });
    // 模型名单元格里的空占位（normal 行不该有）：量一下名字格里有没有 0 宽/0 高的元素。
    const cell = [...row.querySelectorAll("td")].find((td) =>
      [...td.querySelectorAll("*")]
        .map((el) => (el.textContent || "").trim())
        .includes(needle),
    );
    const empties = cell
      ? [...cell.querySelectorAll("*")].filter((el) => {
          const rect = el.getBoundingClientRect();
          return el.children.length === 0 && (el.textContent || "").trim() === "" && rect.height > 0;
        }).length
      : -1;
    return { icons, empties };
  }, modelName);
}

/** 行底色（--row-bg 生效后的实际背景色）。 */
function readRowBackground(page, modelName) {
  return page.evaluate((needle) => {
    const rows = [...document.querySelectorAll("tbody tr")];
    const row = rows.find((tr) =>
      [...tr.querySelectorAll("td")].some((td) =>
        [...td.querySelectorAll("*")]
          .map((el) => (el.textContent || "").trim())
          .includes(needle),
      ),
    );
    if (!row) return null;
    return getComputedStyle(row).backgroundColor;
  }, modelName);
}

/** 表格操作列贴边：末行操作单元格内最右内容与滚动容器右缘的距离（px）。 */
function readActionEdgeGap(page) {
  return page.evaluate(() => {
    const wrap = document.querySelector('[data-slot="table-wrap"]');
    if (!wrap) return null;
    const lastRow = wrap.querySelector("tbody tr:last-child");
    if (!lastRow) return null;
    let maxRight = null;
    for (const el of lastRow.querySelectorAll("td:last-child *")) {
      const rect = el.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0 && (maxRight === null || rect.right > maxRight)) maxRight = rect.right;
    }
    if (maxRight === null) return null;
    return wrap.getBoundingClientRect().right - maxRight;
  });
}

/** 浮层必须完整落在视口内。 */
function assertInsideViewport(panel, label) {
  assert(panel, label + "：浮层不存在");
  const { box, viewport } = panel;
  assert(box.x >= -0.5, label + "：浮层左缘出屏 x=" + box.x);
  assert(box.y >= -0.5, label + "：浮层上缘出屏 y=" + box.y);
  assert(box.x + box.width <= viewport.width + 0.5, label + "：浮层右缘出屏 right=" + (box.x + box.width));
  assert(box.y + box.height <= viewport.height + 0.5, label + "：浮层下缘出屏 bottom=" + (box.y + box.height));
}

/** 页面级横向溢出（文档宽度不得超过视口）。 */
function readOverflow(page) {
  return page.evaluate(() => ({ doc: document.documentElement.scrollWidth, view: window.innerWidth }));
}

/* ------------------------------------------------------------------ *
 * 3. 验收项
 * ------------------------------------------------------------------ */

/** 四类表格（+ 模型两个 Tab）的表头：不得再有「状态」列。 */
async function assertNoStatusColumn(page, label) {
  const tables = await readHeaders(page);
  assert(tables.length > 0, label + "：页面里没有表格");
  for (const headers of tables) {
    assert(
      !headers.includes("状态"),
      label + "：表头仍有「状态」列（当前表头：" + JSON.stringify(headers) + "）",
    );
  }
  return "表头：" + JSON.stringify(tables[0]);
}

async function runStatusChecks(session) {
  const page = session.page;
  const fixture = { closed: null, cooling: null, normal: null };

  await test("status.fixture", "夹具就位：一个上游模型关闭、一个上游模型冷却到两小时后", async () => {
    const list = await session.apiGet("/admin/upstream-models");
    assert(list.status === 200, "读取上游模型失败：" + list.status);
    const items = listItems(list.body);
    const closed = items.find((item) => item.name === CLOSED_MODEL);
    const cooling = items.find((item) => item.name === COOLING_MODEL);
    const normal = items.find((item) => item.name === NORMAL_MODEL);
    assert(closed && cooling && normal, "种子里缺少夹具模型：" + JSON.stringify(items.map((item) => item.name)));

    const patch = async (id, data, label) => {
      const response = await page.request.patch(session.apiBase + "/admin/upstream-models/" + id, {
        data,
        headers: { "Content-Type": "application/json" },
      });
      assert(response.ok(), label + " 失败：HTTP " + response.status() + " " + (await response.text()).slice(0, 200));
      return response.json();
    };

    const closedBody = await patch(closed.id, { enabled: false }, "关闭夹具模型");
    assert(closedBody.availability?.state === "closed", "关闭夹具未生效：" + JSON.stringify(closedBody.availability));

    const until = Date.now() + COOLDOWN_MS;
    const coolingBody = await patch(cooling.id, { cooldown_until_ms: until }, "冷却夹具模型");
    assert(coolingBody.availability?.state === "cooling", "冷却夹具未生效：" + JSON.stringify(coolingBody.availability));
    assert(
      Number(coolingBody.availability?.cooldown_until_ms) > Date.now(),
      "冷却夹具的截止时间不在未来：" + JSON.stringify(coolingBody.availability),
    );

    fixture.closed = closed.id;
    fixture.cooling = cooling.id;
    fixture.normal = normal.id;
    fixture.cooldownUntilMs = Number(coolingBody.availability?.cooldown_until_ms ?? until);
    // 非正常模型的行数（页面上的状态图标应恰好这么多：正常模型不出图标）。
    const after = await session.apiGet("/admin/upstream-models");
    fixture.expectedIcons = listItems(after.body).filter(
      (item) => item.availability && item.availability.state !== "normal",
    ).length;
    return CLOSED_MODEL + "=closed · " + COOLING_MODEL + "=cooling（至 " + fixture.cooldownUntilMs + "）";
  });

  await test("status.no-column", "四类表格表头都没有「状态」列（用户/上游/密钥/模型两 Tab）", async () => {
    const pages = [
      { path: "/users", label: "用户管理" },
      { path: "/upstreams", label: "上游渠道" },
      { path: "/client-keys", label: "连接密钥" },
      { path: "/models", label: "模型管理·上游模型" },
    ];
    const notes = [];
    for (const item of pages) {
      await page.goto(session.base + item.path, { waitUntil: "domcontentloaded", timeout: 30000 });
      await settle(page, { quietMs: 400 });
      await session.assertSane(item.label);
      notes.push(item.label + " → " + (await assertNoStatusColumn(page, item.label)));
    }
    // 模型管理第二个 Tab（公开模型）同样不得有状态列。
    await page.getByRole("tab", { name: "公开模型" }).click();
    await page.waitForTimeout(600);
    await settle(page, { quietMs: 300 });
    notes.push("模型管理·公开模型 → " + (await assertNoStatusColumn(page, "模型管理·公开模型")));
    await shot(page, "status-no-column");
    return notes.join("；");
  });

  await test("status.actions", "操作列仍在且右对齐贴边（四类表格）", async () => {
    const pages = [
      { path: "/users", label: "用户管理" },
      { path: "/upstreams", label: "上游渠道" },
      { path: "/client-keys", label: "连接密钥" },
      { path: "/models", label: "模型管理" },
    ];
    const notes = [];
    for (const item of pages) {
      await page.goto(session.base + item.path, { waitUntil: "domcontentloaded", timeout: 30000 });
      await settle(page, { quietMs: 400 });
      const headers = (await readHeaders(page))[0] ?? [];
      assert(headers.includes("操作"), item.label + "：表头没有「操作」列（当前：" + JSON.stringify(headers) + "）");
      assert(
        headers[headers.length - 1] === "操作",
        item.label + "：操作列必须是最后一列（当前：" + JSON.stringify(headers) + "）",
      );
      const gap = await readActionEdgeGap(page);
      assert(gap !== null, item.label + "：末行没有可量的操作内容");
      assert(gap <= 16.5, item.label + "：操作列未贴右边缘（距右缘 " + Math.round(gap) + "px > 16px）");
      notes.push(item.label + " 贴边 " + Math.round(gap) + "px");
    }
    await shot(page, "status-actions");
    return notes.join("；");
  });

  await test("status.normal", "normal 模型名旁没有状态图标，也不留空占位", async () => {
    await page.goto(session.base + "/models", { waitUntil: "domcontentloaded", timeout: 30000 });
    await settle(page, { quietMs: 400 });
    const info = await readRowIcons(page, NORMAL_MODEL);
    assert(info, "模型管理页找不到 " + NORMAL_MODEL + " 行");
    assert(info.icons.length === 0, "normal 行出现状态图标：" + JSON.stringify(info.icons));
    assert(info.empties === 0, "normal 行名字格里留了空占位元素（" + info.empties + " 个）");
    // 整张表的状态图标数 = 非正常模型数：正常模型一个都不出。
    const kinds = await page.locator(ICON).evaluateAll((els) =>
      els.map((el) => el.getAttribute("data-status-icon") || ""),
    );
    assert(
      kinds.length === fixture.expectedIcons,
      "状态图标数量应等于非正常模型数（" + fixture.expectedIcons + "），实际 " + kinds.length + "：" + JSON.stringify(kinds),
    );
    await shot(page, "status-normal");
    return NORMAL_MODEL + " 行 0 个图标 · 0 个空占位 · 全表 " + kinds.length + " 个图标（= 非正常模型数）";
  });

  await test("status.closed", "关闭模型：名字旁有图标，悬浮文案「已关闭，人工启用后恢复」", async () => {
    await page.goto(session.base + "/models", { waitUntil: "domcontentloaded", timeout: 30000 });
    await settle(page, { quietMs: 400 });
    const info = await readRowIcons(page, CLOSED_MODEL);
    assert(info, "找不到关闭模型行：" + CLOSED_MODEL);
    assert(info.icons.length === 1, "关闭模型行应恰好 1 个状态图标，实际 " + info.icons.length + "：" + JSON.stringify(info.icons));
    const icon = info.icons[0];
    assert(icon.kind === "closed", "关闭模型图标状态应为 closed，实际 " + icon.kind);
    assert(icon.tabIndex === "0", "状态图标必须可聚焦（tabindex=" + icon.tabIndex + "）");
    assert(icon.width > 0 && icon.height > 0, "状态图标不可见（" + icon.width + "×" + icon.height + "）");
    assert(icon.label.includes("已关闭"), "关闭图标的可访问名缺文案：" + icon.label);

    const rowIndex = await findRowIndex(page, CLOSED_MODEL);
    const trigger = page.locator("tbody tr").nth(rowIndex).locator(ICON).first();
    await trigger.hover();
    await page.waitForTimeout(600);
    const panel = await readPanel(page);
    assert(panel, "hover 后浮层未打开");
    assert(panel.text.includes("已关闭，人工启用后恢复"), "悬浮文案不对：" + panel.text);
    await shot(page, "status-closed");
    await page.mouse.move(0, 0);
    await page.waitForTimeout(250);
    return "图标 closed · 文案「" + panel.text + "」";
  });

  await test("status.cooling", "冷却模型：图标 + 文案「冷却中，yyyy-mm-dd hh:mm:ss 后解除」，时间与 API 一致", async () => {
    await page.goto(session.base + "/models", { waitUntil: "domcontentloaded", timeout: 30000 });
    await settle(page, { quietMs: 400 });
    const info = await readRowIcons(page, COOLING_MODEL);
    assert(info, "找不到冷却模型行：" + COOLING_MODEL);
    assert(info.icons.length === 1, "冷却模型行应恰好 1 个状态图标，实际 " + info.icons.length);
    assert(info.icons[0].kind === "cooling", "冷却模型图标状态应为 cooling，实际 " + info.icons[0].kind);

    const rowIndex = await findRowIndex(page, COOLING_MODEL);
    const trigger = page.locator("tbody tr").nth(rowIndex).locator(ICON).first();
    await trigger.hover();
    await page.waitForTimeout(600);
    const panel = await readPanel(page);
    assert(panel, "hover 后浮层未打开");
    const matched = panel.text.match(/冷却中，(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}) 后解除/);
    assert(matched, "冷却文案格式不对（要求 yyyy-mm-dd hh:mm:ss）：" + panel.text);
    // 时间必须等于后端投影的截止时间（按页面所在时区渲染）。
    const expected = await page.evaluate((ms) => {
      const d = new Date(ms);
      const p = (n) => String(n).padStart(2, "0");
      return (
        d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()) +
        " " + p(d.getHours()) + ":" + p(d.getMinutes()) + ":" + p(d.getSeconds())
      );
    }, fixture.cooldownUntilMs);
    assert(matched[1] === expected, "冷却解除时间与 API 不一致：" + matched[1] + " ≠ " + expected);
    await shot(page, "status-cooling");
    await page.mouse.move(0, 0);
    await page.waitForTimeout(250);
    return "图标 cooling · 文案「" + panel.text + "」";
  });

  await test("status.unknown", "未知态：图标 + 文案「状态未知」（不装作正常）", async () => {
    // 后端投影只有 normal/cooling/closed：未知态只能由「控制台不认识的状态」制造。
    const rewrite = async (route) => {
      if (route.request().method() !== "GET") {
        await route.continue();
        return;
      }
      const response = await route.fetch();
      const body = await response.json();
      const items = listItems(body);
      if (items.length > 0) {
        items[0] = { ...items[0], availability: { state: "degraded", cooldown_until_ms: 0 } };
      }
      // 保留原来的信封形状（裸数组或 {items}），只换掉一行的状态投影。
      await route.fulfill({ response, json: Array.isArray(body) ? items : { ...body, items } });
    };
    await page.route((url) => url.pathname === "/admin/upstream-models", rewrite);
    await page.goto(session.base + "/models", { waitUntil: "domcontentloaded", timeout: 30000 });
    await settle(page, { quietMs: 400 });
    const first = await page.locator(ICON).count();
    assert(first >= 1, "未知态没有渲染状态图标");
    const kind = await page.locator(ICON).first().getAttribute("data-status-icon");
    assert(kind === "unknown", "未知态图标应为 unknown，实际 " + kind);
    await page.locator(ICON).first().hover();
    await page.waitForTimeout(600);
    const panel = await readPanel(page);
    assert(panel, "hover 后浮层未打开");
    assert(panel.text.includes("状态未知"), "未知态文案不对：" + panel.text);
    await shot(page, "status-unknown");
    await page.mouse.move(0, 0);
    await page.waitForTimeout(250);
    await page.unroute((url) => url.pathname === "/admin/upstream-models", rewrite);
    return "图标 unknown · 文案「" + panel.text + "」";
  });

  await test("status.keyboard", "键盘 Tab 聚焦状态图标即打开同一份详情", async () => {
    await page.goto(session.base + "/models", { waitUntil: "domcontentloaded", timeout: 30000 });
    await settle(page, { quietMs: 400 });
    await page.mouse.move(0, 0);
    await page.waitForTimeout(200);
    let focused = false;
    for (let i = 0; i < 200 && !focused; i += 1) {
      await page.keyboard.press("Tab");
      focused = await page.evaluate((selector) => {
        const active = document.activeElement;
        return Boolean(active && active.matches(selector) && active.getAttribute("data-status-icon") === "closed");
      }, ICON);
    }
    assert(focused, "Tab 必须能走到关闭模型的状态图标");
    await page.waitForTimeout(300);
    const panel = await readPanel(page);
    assert(panel, "键盘聚焦后浮层必须打开");
    assert(panel.text.includes("已关闭，人工启用后恢复"), "键盘打开的内容不对：" + panel.text);
    await shot(page, "status-keyboard");
    await page.keyboard.press("Escape");
    await page.waitForTimeout(250);
    return "Tab 聚焦即打开，内容一致";
  });

  await test("status.row-tone", "删列后行底色仍区分关闭（微灰）/ 冷却（微黄）/ 正常", async () => {
    await page.goto(session.base + "/models", { waitUntil: "domcontentloaded", timeout: 30000 });
    await settle(page, { quietMs: 400 });
    const closedBg = await readRowBackground(page, CLOSED_MODEL);
    const coolingBg = await readRowBackground(page, COOLING_MODEL);
    const normalBg = await readRowBackground(page, NORMAL_MODEL);
    assert(closedBg && coolingBg && normalBg, "行底色读取失败");
    assert(closedBg !== normalBg, "关闭行与正常行底色相同：" + closedBg);
    assert(coolingBg !== normalBg, "冷却行与正常行底色相同：" + coolingBg);
    assert(closedBg !== coolingBg, "关闭行与冷却行底色相同：" + closedBg);
    await shot(page, "status-row-tone");
    return "关闭 " + closedBg + " · 冷却 " + coolingBg + " · 正常 " + normalBg;
  });

  await test("status.sort-filter", "排序与筛选契约没被删列破坏（用户表）", async () => {
    await page.goto(session.base + "/users", { waitUntil: "domcontentloaded", timeout: 30000 });
    await settle(page, { quietMs: 400 });
    // 列表视图（树视图保持层级顺序，排序断言走列表）。
    const listButton = page.getByRole("button", { name: "列表", exact: true });
    if (await listButton.count()) {
      await listButton.click();
      await page.waitForTimeout(400);
    }
    const nameTh = page.locator("th").filter({ hasText: "用户名称" }).first();
    await nameTh.waitFor({ state: "visible", timeout: 15000 });
    const beforeIcon = (await nameTh.locator("svg").first().getAttribute("class")) || "";
    assert(beforeIcon.includes("lucide-arrow-up-down"), "未排序必须常驻 ArrowUpDown（当前 " + beforeIcon + "）");
    const readNames = () =>
      page.evaluate(() =>
        [...document.querySelectorAll("tbody tr")]
          .map((tr) => {
            const cell = tr.querySelector("td");
            return cell ? (cell.textContent || "").trim() : "";
          })
          .filter((text) => text.length > 0),
      );
    const before = await readNames();
    await nameTh.click({ position: { x: 5, y: 12 } });
    await page.waitForTimeout(400);
    assert((await nameTh.getAttribute("aria-sort")) === "ascending", "点击后表头必须带 aria-sort=ascending");
    const afterIcon = (await nameTh.locator("svg").first().getAttribute("class")) || "";
    assert(afterIcon.includes("lucide-arrow-up-narrow-wide"), "升序必须显示 ArrowUpNarrowWide（当前 " + afterIcon + "）");
    const after = await readNames();
    // 表格默认比较器是字符串码位序（TanStack 默认 sortingFn）；升序后必须非降序且与原序不同。
    const ascending = [...after].sort();
    assert(
      JSON.stringify(after) === JSON.stringify(ascending),
      "按用户名称升序后行序不符：" + JSON.stringify(after),
    );
    assert(JSON.stringify(after) !== JSON.stringify(before), "点击排序后行序没有变化（排序未生效）");
    // 筛选框仍然生效（删列不影响全局筛选）。
    const filter = page.getByPlaceholder("筛选用户名称 / 登录帐户");
    await filter.fill("root");
    await page.waitForTimeout(500);
    const filtered = await page.locator("tbody tr").count();
    assert(filtered >= 1 && filtered < after.length, "筛选失效（命中 " + filtered + " 行）");
    await shot(page, "status-sort-filter");
    return "排序三态图标正常 · 行序已升序 · 筛选命中 " + filtered + " 行";
  });

  await test("status.mobile", "375 宽度下状态图标与悬浮详情仍可读、不出屏", async () => {
    const previous = page.viewportSize();
    await page.setViewportSize({ width: 375, height: 800 });
    await page.goto(session.base + "/models", { waitUntil: "domcontentloaded", timeout: 30000 });
    await settle(page, { quietMs: 400 });
    const overflow = await readOverflow(page);
    assert(
      overflow.doc <= overflow.view + 1,
      "375 下出现文档级横向溢出：" + overflow.doc + " > " + overflow.view,
    );
    const rowIndex = await findRowIndex(page, CLOSED_MODEL);
    assert(rowIndex >= 0, "375 下找不到关闭模型行");
    const trigger = page.locator("tbody tr").nth(rowIndex).locator(ICON).first();
    await trigger.scrollIntoViewIfNeeded();
    await trigger.hover();
    await page.waitForTimeout(600);
    const panel = await readPanel(page);
    assert(panel, "375 下悬浮详情必须能打开");
    assertInsideViewport(panel, "375 悬浮详情");
    assert(panel.text.includes("已关闭"), "375 下悬浮文案漂移：" + panel.text);
    await shot(page, "status-mobile");
    await page.setViewportSize(previous);
    await page.waitForTimeout(200);
    return "375 下浮层在视口内 · scrollWidth " + overflow.doc + " ≤ " + overflow.view;
  });

  await test("status.dark-theme", "深色主题下状态图标与悬浮详情仍可读", async () => {
    const previous = page.viewportSize();
    await page.setViewportSize({ width: 1440, height: 900 });
    // 主题的真源在服务端偏好（localStorage 只是首屏加速），按真实路径切主题。
    const prefs = await page.request.put(session.apiBase + "/admin/auth/preferences", {
      data: { theme: "dark", notify_email: true, notify_browser: false, notify_weekly: true, bio: "" },
      headers: { "Content-Type": "application/json" },
    });
    assert(prefs.ok(), "切换深色主题失败：HTTP " + prefs.status());
    await page.goto(session.base + "/models", { waitUntil: "domcontentloaded", timeout: 30000 });
    await settle(page, { quietMs: 400 });
    const isDark = await page.evaluate(() => document.documentElement.classList.contains("dark"));
    assert(isDark, "深色主题未生效");
    const rowIndex = await findRowIndex(page, CLOSED_MODEL);
    assert(rowIndex >= 0, "深色主题下找不到关闭模型行");
    const trigger = page.locator("tbody tr").nth(rowIndex).locator(ICON).first();
    const box = await trigger.boundingBox();
    assert(box && box.width > 0 && box.height > 0, "深色主题下状态图标不可见");
    await trigger.hover();
    await page.waitForTimeout(600);
    const panel = await readPanel(page);
    assert(panel, "深色主题下悬浮详情必须能打开");
    assert(panel.text.includes("已关闭"), "深色主题下悬浮文案漂移：" + panel.text);
    assertInsideViewport(panel, "深色主题悬浮详情");
    await shot(page, "status-dark");
    await page.mouse.move(0, 0);
    // 还原主题（服务端偏好是跨会话的真源，验收完要恢复跟随系统）。
    await page.request.put(session.apiBase + "/admin/auth/preferences", {
      data: { theme: "system", notify_email: true, notify_browser: false, notify_weekly: true, bio: "" },
      headers: { "Content-Type": "application/json" },
    });
    await page.setViewportSize(previous);
    await page.waitForTimeout(200);
    return "深色主题下图标可见 · 浮层在视口内";
  });
}

/* ------------------------------------------------------------------ *
 * 4. 主流程
 * ------------------------------------------------------------------ */

async function main() {
  if (!REUSE && (API_PORT === 3700 || WEB_PORT === 3700)) {
    console.error("拒绝在 3700 上运行（隔离端口应为 3906/3907）");
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
    const outcome = await session.login(ADMIN_CRED);
    assert(outcome.ok, "登录失败：" + outcome.message);
    await runStatusChecks(session);
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
    "# W7 ticket 10 · 状态列删除与模型状态图标浏览器验收",
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
