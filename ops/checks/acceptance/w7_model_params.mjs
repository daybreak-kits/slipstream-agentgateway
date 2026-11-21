#!/usr/bin/env node
/**
 * W7 ticket 09 验收：模型参数列与 HoverInfo（spec User Story 36/37、39；
 * Implementation Decisions「交互与界面-参数」；Testing Decisions 必测矩阵）。
 *
 * 覆盖：
 *   1. 参数列只显示「输入 xxx / 输出 xxx」，不再堆叠上下文/能力摘要（US 36）；
 *   2. hover / 键盘 Tab 聚焦 / 触屏轻点三路打开完整参数，内容与实际模型配置一致（US 37/38/39）；
 *   3. 正常值不加提示图标；缺失值有明确说明，不做输入框式占位；
 *   4. 浮层打开不改变列宽与行高；375 宽度下可读、无文档级横向溢出；
 *   5. 上游详情页的模型表是同一套参数列口径。
 *
 * 运行：
 *   node ops/checks/acceptance/w7_model_params.mjs              # 自起隔离站点：API 3887 + web 3888
 *   node ops/checks/acceptance/w7_model_params.mjs --base-url http://127.0.0.1:3888   # 复用已起站点
 *   node ops/checks/acceptance/w7_model_params.mjs --headed
 *
 * 前提：web/dist 已构建（cd web && npx vite build）。脚本自管 seed/服务进程，结束后全部清理；
 * 使用临时 SQLite 与临时 ag-config，绝不触碰 3700/3600 与主仓库工作树。
 *
 * 夹具：种子数据里所有上游模型的参数都是默认值（上下限 0 = 未配置），无法证明
 * 「完整参数」这一路。这里用管理员 API 给一个模型写入一组真实参数（控制面元数据，
 * 不影响数据面），再用浏览器读回页面断言「内容与实际模型配置一致」。
 *
 * 退出码：0 全部 PASS；1 有 FAIL；2 环境/依赖未就绪。
 * 证据：ops/checks/.logs/acceptance/w7-model-params-<时间戳>/（report.md + *.png，.logs/ 不入库）。
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
const API_PORT = Number(flags.get("api-port") || process.env.W7_PARAMS_API_PORT || 3887);
const WEB_PORT = Number(flags.get("web-port") || process.env.W7_PARAMS_WEB_PORT || 3888);
const HEADED = flags.has("headed");
const CHANNEL = flags.get("channel") || process.env.PLAYWRIGHT_CHANNEL || "";
const REUSE = Boolean(flags.get("base-url"));
const BASE_URL = (flags.get("base-url") || "").replace(/\/$/, "");
const ADMIN_CRED = parseCred(flags.get("admin") || process.env.W6_ADMIN, { user: "admin", pass: "admin12345" });
const OUT = path.resolve(flags.get("out") || path.join(ROOT, "ops", "checks", ".logs", "acceptance", "w7-model-params-" + stamp()));
fs.mkdirSync(OUT, { recursive: true });

const TRIGGER = '[data-hover-info="trigger"]';
const PANEL = '[data-slot="hover-info-panel"]';

/** 夹具：写进控制面参数块的一组真实参数（页面断言的独立事实来源）。 */
const FIXTURE = {
  max_input_tokens: 200_000,
  max_output_tokens: 128_000,
  reasoning_level: "high",
  reasoning_levels: ["low", "medium", "high"],
  default_reasoning_level: "medium",
  input_types: ["text", "image"],
  output_types: ["text"],
  tool_call: true,
  reasoning: true,
  attachment: false,
  structured_output: true,
};

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
 * 1. 隔离站点：API 3887 + web 3888（静态托管 + /admin、/api 反代）
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
    throw new CheckError("拒绝在 3700/3600 上运行（必须使用隔离端口 3887/3888）");
  }
  const distIndex = path.join(WEB_ROOT, "dist", "index.html");
  if (!fs.existsSync(distIndex)) {
    throw new CheckError("web/dist 不存在：先 cd web && npx vite build");
  }
  const serverDir = path.join(OUT, "server");
  fs.mkdirSync(path.join(serverDir, "ag-config"), { recursive: true });
  serverLog = path.join(serverDir, "server.log");
  const databaseFile = path.join(serverDir, "w7-model-params.db").replace(/\\/g, "/");
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
    SLIPSTREAM_SECRET_KEY: "w7-model-params-acceptance-only",
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
      side: el.getAttribute("data-side") || "",
      role: el.getAttribute("role") || "",
      text: (el.textContent || "").trim(),
      box: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      viewport: { width: window.innerWidth, height: window.innerHeight },
    };
  }, PANEL);
}

/**
 * 在页面里定位「参数」列：返回表下标、列下标与行下标。
 * 表以「表头里有『参数』」为特征；行以包含指定模型名为特征。
 */
async function locateParamsColumn(page, modelName) {
  return page.evaluate(
    ({ needle, columnLabel }) => {
      const tables = [...document.querySelectorAll("table")];
      for (let t = 0; t < tables.length; t += 1) {
        const table = tables[t];
        const heads = [...table.querySelectorAll("thead th")];
        const colIndex = heads.findIndex((th) => (th.textContent || "").trim() === columnLabel);
        if (colIndex < 0) continue;
        const rows = [...table.querySelectorAll("tbody tr")];
        // 按「某个叶子元素的文本正好是模型名」定位行：
        // 子串匹配会把 glm-5.3 认成 glm-5.3-flash；整格文本又会与上游名粘在一起。
        const rowIndex = rows.findIndex((tr) =>
          [...tr.querySelectorAll("td")].some((td) =>
            [...td.querySelectorAll("*")]
              .map((el) => (el.textContent || "").trim())
              .includes(needle),
          ),
        );
        if (rowIndex < 0) continue;
        return { tableIndex: t, colIndex, rowIndex, rowCount: rows.length };
      }
      return null;
    },
    { needle: modelName, columnLabel: "参数" },
  );
}

/** 参数单元格（td）定位器。 */
function paramsCell(page, loc) {
  return page.locator("table").nth(loc.tableIndex).locator("tbody tr").nth(loc.rowIndex).locator("td").nth(loc.colIndex);
}

/** 浮层必须完整落在视口内（窄屏 + 碰撞翻转共同的要求）。 */
function assertInsideViewport(panel, label) {
  assert(panel, label + "：浮层不存在");
  const { box, viewport } = panel;
  assert(box.x >= -0.5, label + "：浮层左缘出屏 x=" + box.x);
  assert(box.y >= -0.5, label + "：浮层上缘出屏 y=" + box.y);
  assert(box.x + box.width <= viewport.width + 0.5, label + "：浮层右缘出屏 right=" + (box.x + box.width));
  assert(box.y + box.height <= viewport.height + 0.5, label + "：浮层下缘出屏 bottom=" + (box.y + box.height));
}

/** 单元格几何：列宽、行高、文本。 */
function readCell(page, loc) {
  return page.evaluate(
    ({ tableIndex, colIndex, rowIndex }) => {
      const table = [...document.querySelectorAll("table")][tableIndex];
      const row = [...table.querySelectorAll("tbody tr")][rowIndex];
      const cell = [...row.querySelectorAll("td")][colIndex];
      const rect = cell.getBoundingClientRect();
      const rowRect = row.getBoundingClientRect();
      return {
        text: (cell.textContent || "").trim(),
        width: rect.width,
        height: rect.height,
        rowHeight: rowRect.height,
        inputs: cell.querySelectorAll("input, textarea").length,
        icons: cell.querySelectorAll("svg").length,
        trigger: Boolean(cell.querySelector('[data-hover-info="trigger"]')),
      };
    },
    loc,
  );
}

/* ------------------------------------------------------------------ *
 * 3. 验收项
 * ------------------------------------------------------------------ */

async function runParamsChecks(session) {
  const page = session.page;

  await test("params.fixture", "夹具就位：一个上游模型写入真实参数（其余保持默认未配置）", async () => {
    const list = await session.apiGet("/admin/upstream-models");
    assert(list.status === 200, "读取上游模型失败：" + list.status);
    const items = listItems(list.body);
    const target = items.find((item) => item.name === "glm-5.3");
    assert(target, "种子里没有 glm-5.3 上游模型");
    const response = await page.request.patch(session.apiBase + "/admin/upstream-models/" + target.id, {
      data: { parameters: FIXTURE },
      headers: { "Content-Type": "application/json" },
    });
    assert(response.status() === 200, "写入参数失败：HTTP " + response.status() + " " + (await response.text()).slice(0, 200));
    const body = await response.json();
    assert(body.parameters.max_input_tokens === FIXTURE.max_input_tokens, "参数未写入：" + JSON.stringify(body.parameters).slice(0, 200));
    return target.name + " ← " + JSON.stringify(FIXTURE.max_input_tokens) + "/" + FIXTURE.max_output_tokens;
  });

  await test("params.column", "参数列只显示「输入 xxx / 输出 xxx」，不再堆叠上下文/能力摘要", async () => {
    await page.goto(session.base + "/models", { waitUntil: "domcontentloaded", timeout: 30000 });
    await settle(page, { quietMs: 400 });
    await session.assertSane("模型管理");
    const loc = await locateParamsColumn(page, "glm-5.3");
    assert(loc, "模型管理页找不到「参数」列");
    const cell = await readCell(page, loc);
    assert(
      /^输入\s+[\d,]+\s*\/\s*输出\s+(?:[\d,]+|未配置)$/.test(cell.text),
      "参数单元格只允许「输入 xxx / 输出 xxx」，实际：" + JSON.stringify(cell.text),
    );
    assert(!cell.text.includes("→"), "参数单元格不得再堆叠模态摘要（→）：" + cell.text);
    for (const word of ["工具", "推理", "结构化", "附件"]) {
      assert(!cell.text.includes(word), "参数单元格不得再堆叠能力摘要（" + word + "）：" + cell.text);
    }
    await shot(page, "params-column");
    return "单元格文本：" + cell.text;
  });

  await test("params.hover", "鼠标 hover 打开完整参数，内容与模型配置一致", async () => {
    const loc = await locateParamsColumn(page, "glm-5.3");
    assert(loc, "找不到「参数」列");
    const cell = paramsCell(page, loc);
    await cell.hover();
    await page.waitForTimeout(600);
    const panel = await readPanel(page);
    assert(panel, "hover 后浮层未打开");
    assert(panel.parentTag === "BODY", "浮层必须 portal 到 body（当前 " + panel.parentTag + "）");
    assert(panel.role === "tooltip", "浮层必须是 role=tooltip，当前 " + panel.role);
    for (const needle of ["200,000", "128,000", "text", "image", "工具调用", "推理", "结构化输出", "medium", "high"]) {
      assert(panel.text.includes(needle), "浮层缺少「" + needle + "」：" + panel.text);
    }
    assert(!panel.text.includes("附件"), "未开启的能力不得出现在浮层里：" + panel.text);
    await shot(page, "params-hover");
    return "浮层 " + panel.text.replace(/\s+/g, " ").slice(0, 160);
  });

  await test("params.layout", "浮层打开不改变列宽与行高（浮层走 portal，不参与布局）", async () => {
    const loc = await locateParamsColumn(page, "glm-5.3");
    const before = await readCell(page, loc);
    const cell = paramsCell(page, loc);
    await cell.hover();
    await page.waitForTimeout(600);
    assert((await page.locator(PANEL).count()) === 1, "浮层未打开，无法比较布局");
    const after = await readCell(page, loc);
    assert(Math.abs(after.width - before.width) < 0.5, "列宽变了：" + before.width + " → " + after.width);
    assert(Math.abs(after.height - before.height) < 0.5, "单元格高度变了：" + before.height + " → " + after.height);
    assert(Math.abs(after.rowHeight - before.rowHeight) < 0.5, "行高变了：" + before.rowHeight + " → " + after.rowHeight);
    await page.mouse.move(0, 0);
    await page.waitForTimeout(300);
    return "列宽 " + after.width.toFixed(1) + "px · 行高 " + after.rowHeight.toFixed(1) + "px（前后一致）";
  });

  await test("params.no-icon", "正常值不加提示图标（参数单元格内没有图标元素）", async () => {
    const loc = await locateParamsColumn(page, "glm-5.3");
    const cell = await readCell(page, loc);
    assert(cell.icons === 0, "参数单元格出现 " + cell.icons + " 个图标（正常值不该有提示图标）");
    assert(cell.trigger, "参数单元格必须带统一悬浮详情触发元素");
    return "图标 0 个 · 触发元素在位";
  });

  await test("params.missing", "缺失值有明确说明「未配置」，且不是输入框式占位", async () => {
    const loc = await locateParamsColumn(page, "embedding-4");
    assert(loc, "找不到 embedding-4 所在行");
    const cell = await readCell(page, loc);
    assert(cell.text.includes("未配置"), "缺失值必须有明确说明，实际：" + cell.text);
    assert(cell.inputs === 0, "缺失值不得渲染成输入框式占位（发现 " + cell.inputs + " 个输入元素）");
    await paramsCell(page, loc).hover();
    await page.waitForTimeout(600);
    const panel = await readPanel(page);
    assert(panel, "hover 后浮层未打开");
    assert(panel.text.includes("未配置"), "浮层里缺失值也要说明「未配置」：" + panel.text);
    await shot(page, "params-missing");
    await page.mouse.move(0, 0);
    await page.waitForTimeout(250);
    return "单元格：" + cell.text;
  });

  await test("params.focus", "键盘 Tab 聚焦即打开同一份完整参数", async () => {
    await page.mouse.move(0, 0);
    await page.waitForTimeout(300);
    assert((await page.locator(PANEL).count()) === 0, "移开鼠标后浮层应收起");
    let focused = false;
    for (let i = 0; i < 120 && !focused; i += 1) {
      await page.keyboard.press("Tab");
      focused = await page.evaluate((selector) => {
        const active = document.activeElement;
        if (!active || !active.matches(selector)) return false;
        // 必须是夹具那一行（带真实上限）的触发元素，而不是别的行的触发元素。
        return (active.textContent || "").includes("200,000");
      }, TRIGGER);
    }
    assert(focused, "Tab 必须能走到夹具行的参数悬浮触发元素");
    await page.waitForTimeout(300);
    const panel = await readPanel(page);
    assert(panel, "键盘聚焦后浮层必须打开");
    assert(panel.text.includes("200,000") && panel.text.includes("工具调用"), "键盘打开的内容与鼠标一致：" + panel.text);
    await shot(page, "params-focus");
    await page.keyboard.press("Escape");
    await page.waitForTimeout(250);
    return "Tab 聚焦即打开，内容一致";
  });

  await test("params.mobile", "375 宽度下可读：参数列仍在、文本未被裁掉、页面无横向溢出", async () => {
    const previous = page.viewportSize();
    await page.setViewportSize({ width: 375, height: 800 });
    await page.waitForTimeout(400);
    await page.goto(session.base + "/models", { waitUntil: "domcontentloaded", timeout: 30000 });
    await settle(page, { quietMs: 400 });
    const loc = await locateParamsColumn(page, "glm-5.3");
    assert(loc, "375 下找不到「参数」列");
    const cell = await readCell(page, loc);
    assert(cell.text.length > 0, "375 下参数单元格没有文本");
    assert(
      /^输入\s+[\d,]+\s*\/\s*输出\s+(?:[\d,]+|未配置)$/.test(cell.text),
      "375 下参数单元格口径漂移：" + cell.text,
    );
    const overflow = await page.evaluate(() => ({
      doc: document.documentElement.scrollWidth,
      view: window.innerWidth,
    }));
    assert(
      overflow.doc <= overflow.view + 1,
      "375 下出现文档级横向溢出：" + overflow.doc + " > " + overflow.view,
    );
    // 窄屏参数列要横向滚动才看见：滚到它再悬浮，详情同样要读得到且不出屏。
    // 尾列冻结（sticky）会一直贴在表格右缘，所以要把表格滚到参数列露出在冻结列左侧。
    const trigger = paramsCell(page, loc).locator(TRIGGER);
    await trigger.evaluate((el) => {
      const wrap = el.closest('[data-slot="table-wrap"]');
      if (!wrap) return;
      const table = wrap.querySelector("table");
      const frozen = [...table.querySelectorAll("th.sticky, td.sticky")]
        .filter((cell) => cell.offsetWidth > 0)
        .pop();
      const cellRect = el.getBoundingClientRect();
      const frozenRect = frozen ? frozen.getBoundingClientRect() : null;
      if (frozenRect && cellRect.right > frozenRect.left) {
        wrap.scrollLeft += cellRect.right - frozenRect.left + 8;
      }
    });
    await trigger.hover();
    await page.waitForTimeout(600);
    const panel = await readPanel(page);
    assert(panel, "375 下悬浮详情必须能打开");
    assertInsideViewport(panel, "375 悬浮详情");
    assert(panel.text.includes("200,000"), "375 下悬浮详情内容漂移：" + panel.text);
    await shot(page, "params-mobile");
    await page.setViewportSize(previous);
    await page.waitForTimeout(200);
    return "375 下文本「" + cell.text + "」，scrollWidth " + overflow.doc + " ≤ " + overflow.view;
  });

  await test("params.upstream-detail", "上游详情页模型表同一套口径（输入/输出 + 悬浮详情）", async () => {
    const upstreams = await session.apiGet("/admin/upstreams");
    const items = listItems(upstreams.body);
    assert(items.length > 0, "没有上游渠道");
    await page.goto(session.base + "/upstreams/" + items[0].id, { waitUntil: "domcontentloaded", timeout: 30000 });
    await settle(page, { quietMs: 400 });
    const tab = page.getByRole("tab", { name: "路由与模型" });
    await tab.click();
    await page.waitForTimeout(600);
    await settle(page, { quietMs: 300 });
    const loc = await locateParamsColumn(page, "glm-5.3");
    assert(loc, "上游详情页模型表找不到「参数」列");
    const cell = await readCell(page, loc);
    assert(
      /^输入\s+[\d,]+\s*\/\s*输出\s+(?:[\d,]+|未配置)$/.test(cell.text),
      "上游详情页参数列口径不一致：" + cell.text,
    );
    const trigger = paramsCell(page, loc).locator(TRIGGER);
    assert((await trigger.count()) === 1, "上游详情页参数单元格必须带悬浮详情触发元素");
    await trigger.hover();
    await page.waitForTimeout(600);
    const panel = await readPanel(page);
    assert(panel, "上游详情页 hover 未打开浮层");
    assert(panel.text.includes("200,000"), "上游详情页浮层内容与配置不一致：" + panel.text);
    await shot(page, "params-upstream-detail");
    await page.mouse.move(0, 0);
    return "单元格：" + cell.text;
  });
}

async function runTouchCheck(base, fixtureName) {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    locale: "zh-CN",
    hasTouch: true,
    baseURL: base,
  });
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  try {
    await test("params.touch", "触屏轻点参数单元格打开同一份完整参数", async () => {
      await page.goto(base + "/login", { waitUntil: "domcontentloaded", timeout: 30000 });
      await page.waitForTimeout(400);
      await page.fill("#login-username", ADMIN_CRED.user);
      await page.fill("#login-password", ADMIN_CRED.pass);
      await page.click('button[type="submit"]');
      const outcome = await waitLoginOutcome(page, { timeoutMs: 15000 });
      assert(outcome.ok, "触屏上下文登录失败：" + outcome.message);
      await page.goto(base + "/models", { waitUntil: "domcontentloaded", timeout: 30000 });
      await settle(page, { quietMs: 400 });
      const loc = await locateParamsColumn(page, fixtureName);
      assert(loc, "找不到「参数」列");
      const trigger = paramsCell(page, loc).locator(TRIGGER);
      await trigger.waitFor({ state: "visible", timeout: 15000 });
      await trigger.tap();
      await page.waitForTimeout(500);
      const panel = await readPanel(page);
      assert(panel, "触屏轻点后浮层必须打开");
      assert(panel.parentTag === "BODY", "触屏浮层同样必须 portal 到 body");
      assert(panel.text.includes("200,000") && panel.text.includes("工具调用"), "触屏打开的内容与鼠标/键盘一致：" + panel.text);
      await shot(page, "params-touch");
      return "轻点即打开，内容一致";
    });
  } finally {
    await context.close();
  }
}

/* ------------------------------------------------------------------ *
 * 4. 主流程
 * ------------------------------------------------------------------ */

async function main() {
  if (!REUSE && (API_PORT === 3700 || WEB_PORT === 3700)) {
    console.error("拒绝在 3700 上运行（隔离端口应为 3887/3888）");
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
    await runParamsChecks(session);
    await session.close();
    await runTouchCheck(base, "glm-5.3");
  } catch (error) {
    console.error(String((error && error.message) || error));
    results.push({ id: "run", name: "验收脚本执行", status: "fail", detail: String((error && error.message) || error), evidence: [] });
  } finally {
    if (browser) await browser.close().catch(() => {});
    stopIsolatedSite();
  }

  const failed = results.filter((row) => row.status === "fail");
  const report = [
    "# W7 ticket 09 · 模型参数列与 HoverInfo 浏览器验收",
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
