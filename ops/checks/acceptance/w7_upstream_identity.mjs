#!/usr/bin/env node
/**
 * W7 ticket 04 验收：上游标志与别名收口（spec User Stories 9–14/50、Implementation
 * Decisions「领域与数据模型-上游身份」「交互与界面」、Conflict Review C5、ADR-023）。
 *
 * 覆盖：
 *   1. 列表列头为「上游标志」「上游别名」，列表与详情不出现厂商（US 9/10/11）；
 *   2. alias 编辑与展示一致：详情表单保存 → API 落库 → 列表列与详情头部展示同一别名（US 11/50）；
 *   3. 用别名搜索列表能命中对应上游（US 50）；
 *   4. 重名 422：把标志改成已有上游的名称 → PATCH 422 + 表单内唯一性错误呈现（role=alert），
 *      改回后保存 200（US 10、ADR-023 #6）；
 *   5. 新建：不填标志、只填连接地址 → 名称由 base_url 生成（api-fresh-example-com），
 *      创建时填的别名在列表可见（US 10/11）；
 *   6. md（768）以上：标志/别名同排、连接地址/协议风格同排（同排元素 y 一致，US 12）；
 *   7. 375：详情表单纵向堆叠且列表/详情均无横向溢出（spec 响应式约定）；
 *   8. 测试密钥默认项文案唯一：「自动使用第一把」，页面不再出现「默认（第一把）」「默认密钥」（US 14）；
 *   9. 添加模型/拉取模型/全部测试按钮与页签分隔线之间有明确间距（>16px，US 13）。
 *
 * 运行：
 *   node ops/checks/acceptance/w7_upstream_identity.mjs              # 自起隔离站点：API 3896 + web 3897
 *   node ops/checks/acceptance/w7_upstream_identity.mjs --base-url http://127.0.0.1:3897   # 复用已起站点
 *   node ops/checks/acceptance/w7_upstream_identity.mjs --headed
 *
 * 前提：web/dist 已构建（cd web && npx vite build）。脚本自管 seed/服务进程，结束后全部清理；
 * 使用临时 SQLite 与临时 ag-config，绝不触碰 3700/3600 与主仓库工作树。
 *
 * 退出码：0 全部 PASS；1 有 FAIL；2 环境/依赖未就绪。
 * 证据：ops/checks/.logs/acceptance/w7-upstream-identity-<时间戳>/（report.md + *.png，.logs/ 不入库）。
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
const API_PORT = Number(flags.get("api-port") || process.env.W7_UPSTREAM_API_PORT || 3896);
const WEB_PORT = Number(flags.get("web-port") || process.env.W7_UPSTREAM_WEB_PORT || 3897);
const HEADED = flags.has("headed");
const CHANNEL = flags.get("channel") || process.env.PLAYWRIGHT_CHANNEL || "";
const REUSE = Boolean(flags.get("base-url"));
const BASE_URL = (flags.get("base-url") || "").replace(/\/$/, "");
const ADMIN_CRED = parseCred(flags.get("admin") || process.env.W6_ADMIN, { user: "admin", pass: "admin12345" });
const OUT = path.resolve(flags.get("out") || path.join(ROOT, "ops", "checks", ".logs", "acceptance", "w7-upstream-identity-" + stamp()));
fs.mkdirSync(OUT, { recursive: true });

/* DOM 契约（实现必须提供的稳定选择器/文案） */
const NAME_INPUT = "#up-name";
const ALIAS_INPUT = "#up-alias";
const BASE_URL_INPUT = "#up-base-url";
const API_STYLE_TRIGGER = 'button[aria-label="协议风格"]';
const NAME_ERROR = '[data-slot="upstream-name-error"]';
const SAVE_BUTTON = 'button:has-text("保存")';
const PROBE_KEY_TRIGGER = 'button[aria-label="选择测试密钥"]';
const TABLIST = '[role="tablist"][aria-label="上游渠道编辑器页签"]';

/* 独立事实源：种子派生名（seed UPSTREAMS 的 base_url 按 ADR-023 #6 规则折叠）。 */
const SEED_ZAI = "open-bigmodel-cn";
const SEED_ZAI_BASE_URL = "https://open.bigmodel.cn/api/paas/v4";
const SEED_NEBULA = "api-nebula-example";
const DERIVED_FRESH = "api-fresh-example-com"; // https://api.fresh-example.com/v1 → host 折叠

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
 * 1. 隔离站点：API 3896 + web 3897（静态托管 + /admin、/api 反代）
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
    throw new CheckError("拒绝在 3700/3600 上运行（必须使用隔离端口 3896/3897）");
  }
  const distIndex = path.join(WEB_ROOT, "dist", "index.html");
  if (!fs.existsSync(distIndex)) {
    throw new CheckError("web/dist 不存在：先 cd web && npx vite build");
  }
  const serverDir = path.join(OUT, "server");
  fs.mkdirSync(path.join(serverDir, "ag-config"), { recursive: true });
  serverLog = path.join(serverDir, "server.log");
  const databaseFile = path.join(serverDir, "w7-upstream-identity.db").replace(/\\/g, "/");
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
    SLIPSTREAM_SECRET_KEY: "w7-upstream-identity-acceptance-only",
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

async function openUpstream(session, name) {
  const page = session.page;
  const response = await session.apiGet("/admin/upstreams?page_size=200");
  assert(response.status === 200, "读取上游列表失败：" + response.status);
  const row = listItems(response.body).find((item) => item.name === name);
  assert(row, "种子里没有上游 " + name);
  await page.goto(session.base + "/upstreams/" + row.id, { waitUntil: "domcontentloaded", timeout: 30000 });
  await settle(page, { quietMs: 400 });
  await session.assertSane("上游详情");
  return row;
}

async function openUpstreamsList(session) {
  const page = session.page;
  await page.goto(session.base + "/upstreams", { waitUntil: "domcontentloaded", timeout: 30000 });
  await settle(page, { quietMs: 400 });
  await session.assertSane("上游列表");
}

/** 读列表表头与行（名称 → 行文本映射，page.evaluate 不能返回函数）；表头来自 DataTable 的 th。 */
async function readList(page) {
  return page.evaluate(() => {
    const heads = [...document.querySelectorAll("th")].map((el) => (el.textContent || "").trim());
    const bodyText = document.body.innerText;
    const rows = {};
    for (const a of document.querySelectorAll("td a")) {
      const tr = a.closest("tr");
      if (tr) rows[(a.textContent || "").trim()] = (tr.textContent || "").trim();
    }
    return { heads, bodyText, rows, docWidth: document.documentElement.scrollWidth, viewWidth: window.innerWidth };
  });
}

/** 读详情页连接表单几何：各字段输入框的盒子与文档溢出状态。 */
async function readConnectionForm(page) {
  return page.evaluate(({ nameSel, aliasSel, baseUrlSel, styleSel }) => {
    const boxOf = (sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const rect = el.getBoundingClientRect();
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    };
    return {
      name: boxOf(nameSel),
      alias: boxOf(aliasSel),
      baseUrl: boxOf(baseUrlSel),
      style: boxOf(styleSel),
      docWidth: document.documentElement.scrollWidth,
      viewWidth: window.innerWidth,
    };
  }, { nameSel: NAME_INPUT, aliasSel: ALIAS_INPUT, baseUrlSel: BASE_URL_INPUT, styleSel: API_STYLE_TRIGGER });
}

/** 清掉右上角 sonner 提示：toast 悬停会暂停自动消失，持续遮住页头保存按钮，先点关闭钮再操作。 */
async function dismissToasts(page) {
  for (let i = 0; i < 5; i += 1) {
    const close = page.locator('[data-sonner-toast] button');
    if ((await close.count()) === 0) break;
    await close.first().click({ timeout: 1000 }).catch(() => {
      /* 关闭钮可能已随 toast 消失 */
    });
    await page.waitForTimeout(200);
  }
}

/** 点页头「保存」并等待响应；返回响应对象供状态断言。超时/点击受阻时带诊断信息重抛。 */
async function saveDetail(page, method, urlPart, expectStatus) {
  await dismissToasts(page);
  const saveBtn = page.locator('div:has(> h1) button:has-text("保存")').first();
  assert(await saveBtn.isVisible(), "页头必须有「保存」按钮");
  assert(await saveBtn.isEnabled(), "保存按钮应可用（表单不完整时是禁用的）");
  try {
    const [response] = await Promise.all([
      page.waitForResponse((res) => res.request().method() === method && res.url().includes(urlPart), { timeout: 15000 }),
      saveBtn.click({ timeout: 5000 }),
    ]);
    assert(
      !expectStatus || response.status() === expectStatus,
      method + " " + urlPart + " 应 " + expectStatus + "，实际 " + response.status() + " " + (await response.text()).slice(0, 200),
    );
    await page.waitForTimeout(500);
    return response;
  } catch (error) {
    const diag = await page.evaluate(() => {
      const btn = [...document.querySelectorAll("button")].find((el) => (el.textContent || "").trim() === "保存");
      if (!btn) return { reason: "no-save-button" };
      const r = btn.getBoundingClientRect();
      const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
      return {
        disabled: btn.disabled,
        box: { x: r.x, y: r.y, w: r.width, h: r.height },
        hitTag: hit ? hit.tagName : null,
        hitText: hit ? (hit.textContent || "").slice(0, 40) : null,
        hitIsButton: hit === btn || (hit && btn.contains(hit)),
      };
    }).catch((e) => ({ reason: "diag-failed: " + String(e && e.message) }));
    throw new CheckError(String((error && error.message) || error) + " | 诊断：" + JSON.stringify(diag));
  }
}

/* ------------------------------------------------------------------ *
 * 3. 验收项
 * ------------------------------------------------------------------ */

async function runChecks(session) {
  const page = session.page;

  await test("list.columns", "列表列头为「上游标志」「上游别名」，无厂商文案（US 9/10/11）", async () => {
    await openUpstreamsList(session);
    const list = await readList(page);
    assert(list.heads.some((t) => t.includes("上游标志")), "列头必须有「上游标志」，实际：" + JSON.stringify(list.heads));
    assert(list.heads.some((t) => t.includes("上游别名")), "列头必须有「上游别名」，实际：" + JSON.stringify(list.heads));
    assert(!list.heads.some((t) => t.includes("厂商")), "列头不得出现「厂商」：" + JSON.stringify(list.heads));
    assert(!list.bodyText.includes("厂商"), "列表页不得出现「厂商」文案");
    const zaiRow = list.rows[SEED_ZAI];
    assert(zaiRow !== undefined, "列表应包含种子上游 " + SEED_ZAI);
    await shot(page, "upstream-list");
    return "列头 " + JSON.stringify(list.heads);
  });

  await test("alias.edit", "详情编辑别名保存 → API 落库 → 列表列与详情头部展示一致（US 11/50）", async () => {
    await openUpstream(session, SEED_ZAI);
    const alias = page.locator(ALIAS_INPUT);
    assert(await alias.count() === 1, "详情连接表单必须有上游别名输入框（" + ALIAS_INPUT + "）");
    await alias.fill("智谱官方渠道");
    await saveDetail(page, "PATCH", "/admin/upstreams/", 200);
    const after = await session.apiGet("/admin/upstreams?page_size=200");
    const saved = listItems(after.body).find((item) => item.name === SEED_ZAI);
    assert(saved && saved.alias === "智谱官方渠道", "落库别名应为 智谱官方渠道，实际 " + JSON.stringify(saved && saved.alias));
    // 详情头部展示别名
    const headerText = await page.locator("h1").first().innerText();
    const nearHeader = await page.evaluate(() => {
      const h1 = document.querySelector("h1");
      return h1 && h1.parentElement ? (h1.parentElement.textContent || "").trim() : "";
    });
    assert(nearHeader.includes("智谱官方渠道"), "详情头部应展示别名，实际：" + nearHeader);
    await shot(page, "alias-detail-header");
    // 列表列展示同一别名
    await openUpstreamsList(session);
    const list = await readList(page);
    const zaiRow = list.rows[SEED_ZAI];
    assert(zaiRow !== undefined && zaiRow.includes("智谱官方渠道"), "列表 " + SEED_ZAI + " 行应显示别名，实际：" + JSON.stringify(zaiRow));
    await shot(page, "alias-list-row");
    return "落库 alias=智谱官方渠道；详情头部与列表行均展示";
  });

  await test("alias.search", "用别名搜索列表能命中对应上游（US 50）", async () => {
    await openUpstreamsList(session);
    const search = page.locator('input[aria-label="搜索名称或连接地址"], input[placeholder*="搜索"]').first();
    assert(await search.count() === 1, "列表应有搜索输入框");
    await search.fill("智谱官方渠道");
    await page.waitForTimeout(400);
    const list = await readList(page);
    assert(list.rows[SEED_ZAI] !== undefined, "按别名搜索应命中 " + SEED_ZAI);
    assert(list.rows[SEED_NEBULA] === undefined, "按别名搜索不应命中其他上游 " + SEED_NEBULA);
    await shot(page, "alias-search");
    await search.fill("");
    await page.waitForTimeout(300);
    return "别名搜索命中 " + SEED_ZAI + "，其他上游被过滤";
  });

  await test("name.422", "重名 422：标志改成已有上游的名称 → 422 + 表单内错误呈现；改回保存 200（US 10）", async () => {
    await openUpstream(session, SEED_ZAI);
    const name = page.locator(NAME_INPUT);
    assert(await name.count() === 1, "详情连接表单必须有上游标志输入框（" + NAME_INPUT + "）");
    await name.fill(SEED_NEBULA);
    const response = await saveDetail(page, "PATCH", "/admin/upstreams/", 422);
    const body = await response.json().catch(() => null);
    assert(body && String(body.code || "").toUpperCase().includes("VALIDATION"), "422 响应应为校验错误，实际：" + JSON.stringify(body).slice(0, 200));
    const errorBox = page.locator(NAME_ERROR);
    assert(await errorBox.count() === 1, "重名后表单内必须有唯一性错误元素（" + NAME_ERROR + "）");
    assert(await errorBox.isVisible(), "唯一性错误必须可见");
    const role = await errorBox.getAttribute("role");
    assert(role === "alert", "唯一性错误应以 role=alert 呈现，实际 " + role);
    const errorText = (await errorBox.innerText()).trim();
    assert(errorText.length > 0, "唯一性错误必须有文案，实际为空");
    await shot(page, "name-422-error");
    // 改回原名保存 200；错误提示应消失。
    await name.fill(SEED_ZAI);
    await saveDetail(page, "PATCH", "/admin/upstreams/", 200);
    assert((await errorBox.count()) === 0 || !(await errorBox.isVisible()), "改回后唯一性错误应消失");
    await shot(page, "name-422-recovered");
    return "422 → " + errorText.slice(0, 40) + "…；改回保存 200";
  });

  await test("name.derive", "新建不填标志：名称由 base_url 生成，创建时别名在列表可见（US 10/11）", async () => {
    await page.goto(session.base + "/upstreams/new", { waitUntil: "domcontentloaded", timeout: 30000 });
    await settle(page, { quietMs: 400 });
    await session.assertSane("新建上游");
    await page.locator(BASE_URL_INPUT).fill("https://api.fresh-example.com/v1");
    // 选具体协议风格（隔离站点无法出网，auto 会探测失败 422——那是后端既有语义，不属于本票）。
    await page.locator(API_STYLE_TRIGGER).click();
    await page.waitForTimeout(300);
    await page.locator('[role="option"]', { hasText: "OpenAI Chat" }).first().click();
    await page.waitForTimeout(300);
    // 别名在新建表单即可填。
    await page.locator(ALIAS_INPUT).fill("新渠道示例");
    // 登记一把密钥（新建至少一把才能保存）。
    await page.locator('button:has-text("添加密钥")').first().click();
    await page.waitForTimeout(300);
    await page.locator("#up-key-secret").fill("sk-fresh-example-acceptance");
    await page.locator('[role="dialog"] button:has-text("保存")').last().click();
    await page.waitForTimeout(500);
    await saveDetail(page, "POST", "/admin/upstreams", 201);
    await page.waitForTimeout(600);
    // 服务端事实源：新行名称 = base_url 派生，别名 = 创建时填写。
    const after = await session.apiGet("/admin/upstreams?page_size=200");
    const created = listItems(after.body).find((item) => item.base_url === "https://api.fresh-example.com/v1");
    assert(created, "创建后应能在 API 中找到新上游");
    assert(created.name === DERIVED_FRESH, "未填标志时名称应由 base_url 生成 " + DERIVED_FRESH + "，实际 " + created.name);
    assert(created.alias === "新渠道示例", "创建时别名应落库，实际 " + JSON.stringify(created.alias));
    // 列表可见。
    await openUpstreamsList(session);
    const list = await readList(page);
    const row = list.rows[DERIVED_FRESH];
    assert(row !== undefined && row.includes("新渠道示例"), "列表应显示派生标志与创建时别名，实际：" + JSON.stringify(row));
    await shot(page, "name-derived-list");
    return "name=" + created.name + "（base_url 派生），alias=新渠道示例";
  });

  await test("detail.two-per-row", "md（768+）标志/别名同排、连接地址/协议风格同排；375 纵向堆叠（US 12）", async () => {
    await openUpstream(session, SEED_ZAI);
    const previous = page.viewportSize();
    try {
      await page.setViewportSize({ width: 768, height: 900 });
      await page.waitForTimeout(400);
      let form = await readConnectionForm(page);
      assert(form.name && form.alias, "768 下标志与别名输入框都必须可见");
      assert(Math.abs(form.name.y - form.alias.y) < 2, "768 下标志/别名应同排（y 一致）：name y=" + form.name.y + " alias y=" + form.alias.y);
      assert(form.alias.x > form.name.x + form.name.width - 2, "别名应在标志右侧：name x=" + form.name.x + " alias x=" + form.alias.x);
      assert(form.baseUrl && form.style, "768 下连接地址与协议风格都必须可见");
      assert(Math.abs(form.baseUrl.y - form.style.y) < 2, "768 下连接地址/协议风格应同排（y 一致）：url y=" + form.baseUrl.y + " style y=" + form.style.y);
      assert(form.style.x > form.baseUrl.x + form.baseUrl.width - 2, "协议风格应在连接地址右侧");
      assert(form.docWidth <= form.viewWidth + 1, "768 下不得横向溢出：" + form.docWidth + " > " + form.viewWidth);
      await shot(page, "two-per-row-768");
      // 375：纵向堆叠。
      await page.setViewportSize({ width: 375, height: 800 });
      await page.waitForTimeout(400);
      form = await readConnectionForm(page);
      assert(form.alias.y > form.name.y + form.name.height - 2, "375 下别名应堆叠在标志下方：name y=" + form.name.y + " alias y=" + form.alias.y);
      assert(form.docWidth <= form.viewWidth + 1, "375 详情不得横向溢出：" + form.docWidth + " > " + form.viewWidth);
      await shot(page, "stacked-375");
      return "768 同排（Δy<2），375 堆叠，scrollWidth " + form.docWidth + "≤" + form.viewWidth;
    } finally {
      await page.setViewportSize(previous);
      await page.waitForTimeout(300);
    }
  });

  await test("mobile.375", "375 列表无横向溢出（spec 响应式约定）", async () => {
    const previous = page.viewportSize();
    try {
      await page.setViewportSize({ width: 375, height: 800 });
      await openUpstreamsList(session);
      const list = await readList(page);
      assert(list.docWidth <= list.viewWidth + 1, "375 列表不得横向溢出：" + list.docWidth + " > " + list.viewWidth);
      await shot(page, "list-375");
      return "scrollWidth " + list.docWidth + " ≤ " + list.viewWidth;
    } finally {
      await page.setViewportSize(previous);
      await page.waitForTimeout(300);
    }
  });

  await test("probe.default-key", "测试密钥默认项为「自动使用第一把」，与密钥行的「默认密钥」标签不再双语义（US 14）", async () => {
    await openUpstream(session, SEED_ZAI);
    await page.locator('[role="tab"][aria-label*="路由与模型"], [role="tab"]:has-text("路由与模型")').first().click();
    await page.waitForTimeout(600);
    const trigger = page.locator(PROBE_KEY_TRIGGER);
    assert(await trigger.count() === 1, "路由与模型页必须有测试密钥选择器（" + PROBE_KEY_TRIGGER + "）");
    const triggerText = (await trigger.innerText()).trim();
    assert(triggerText === "自动使用第一把", "默认项文案应为「自动使用第一把」，实际：" + JSON.stringify(triggerText));
    assert(!triggerText.includes("默认"), "默认项不得再携带「默认」字样（与密钥行的「默认密钥」标签去重）： " + JSON.stringify(triggerText));
    // 打开下拉确认选项文案。
    await trigger.click();
    await page.waitForTimeout(300);
    const options = await page.evaluate(() =>
      [...document.querySelectorAll('[role="option"]')].map((el) => (el.textContent || "").trim()),
    );
    assert(options.some((t) => t === "自动使用第一把"), "下拉应有「自动使用第一把」选项，实际：" + JSON.stringify(options));
    assert(!options.some((t) => t.includes("默认（第一把）")), "下拉不得再有「默认（第一把）」选项：" + JSON.stringify(options));
    await shot(page, "probe-default-key");
    await page.keyboard.press("Escape");
    const bodyText = await page.evaluate(() => document.body.innerText);
    assert(!bodyText.includes("默认（第一把）"), "页面不得再出现「默认（第一把）」");
    // 说明：种子里首把密钥的 label「默认密钥」是用户可改的数据（keys 表 label 列），不是下拉默认项语义；
    // 本票只收敛下拉默认项文案，不重写种子数据标签。
    return "trigger=" + JSON.stringify(triggerText) + "，options=" + JSON.stringify(options);
  });

  await test("routing.button-spacing", "添加模型按钮与页签分隔线之间有明确间距（1440 与 768 均 >16px）（US 13）", async () => {
    await openUpstream(session, SEED_ZAI);
    await page.locator('[role="tab"][aria-label*="路由与模型"], [role="tab"]:has-text("路由与模型")').first().click();
    await page.waitForTimeout(600);
    const previous = page.viewportSize();
    try {
      const gaps = [];
      for (const width of [1440, 768]) {
        await page.setViewportSize({ width, height: 900 });
        await page.waitForTimeout(400);
        const gap = await page.evaluate(({ tablistSel }) => {
          const tablist = document.querySelector(tablistSel);
          const button = [...document.querySelectorAll("button")].find((el) => (el.textContent || "").includes("添加模型"));
          if (!tablist || !button) return null;
          const tb = tablist.getBoundingClientRect();
          const bb = button.getBoundingClientRect();
          return { lineBottom: tb.y + tb.height, buttonTop: bb.y, gap: bb.y - (tb.y + tb.height) };
        }, { tablistSel: TABLIST });
        assert(gap !== null, "必须有页签条与「添加模型」按钮");
        // mb-4 = 16px；阈值 15 留 1px 亚像素容差（红时实测 0.0px）。
        assert(gap.gap > 15, width + "px 宽下按钮与页签分隔线间距应 ≥16px（明确间距），实际 " + gap.gap.toFixed(1) + "px");
        gaps.push(width + ":" + gap.gap.toFixed(1) + "px");
      }
      await shot(page, "button-spacing");
      return "分隔线底部到按钮顶部间距 " + gaps.join(" / ");
    } finally {
      await page.setViewportSize(previous);
      await page.waitForTimeout(300);
    }
  });

  await test("no.vendor", "详情页（连接/其他设置页签）不出现厂商文案（US 9 查漏）", async () => {
    await openUpstream(session, SEED_ZAI);
    const bodyText = await page.evaluate(() => document.body.innerText);
    assert(!bodyText.includes("厂商"), "详情页不得出现「厂商」文案");
    await page.locator('[role="tab"]:has-text("其他设置")').first().click();
    await page.waitForTimeout(400);
    const settingsText = await page.evaluate(() => document.body.innerText);
    assert(!settingsText.includes("厂商"), "其他设置页签不得出现「厂商」文案");
    await shot(page, "detail-no-vendor");
    return "详情页全文无「厂商」";
  });
}

/* ------------------------------------------------------------------ *
 * 4. 主流程
 * ------------------------------------------------------------------ */

async function main() {
  if (!REUSE && (API_PORT === 3700 || WEB_PORT === 3700)) {
    console.error("拒绝在 3700 上运行（隔离端口应为 3896/3897）");
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
    "# W7 ticket 04 · 上游标志与别名浏览器验收",
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
