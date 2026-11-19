#!/usr/bin/env node
/**
 * M4 终版验收 · 流程七：请求内重试 + 健康驱逐（ADR-024 / M3 配置面）。
 *
 * 这是把 M3 冒烟（.scratch/m3_smoke.mjs）固化为正式回归脚本：全程走真实控制面 + 真实
 * agentgateway 二进制，验证「网关策略页开 retry → mock 主 500 → 客户端切备 200 → 关闭 →
 * 回到透传」的完整闭环，并留证据到 ops/checks/.logs/acceptance/m4-retry-<stamp>/。
 *
 * 步骤：
 *   1) seed_demo 重置演示库 + 起 3700 控制面（单端口托管 web/dist）
 *   2) 建 mock upstream（主 8911 恒 500 / 备 8912 恒 200）+ 上游模型 + 公开模型（failover）
 *   3) 浏览器 /gateway-policies?tab=policies：开「请求内重试」，4xx 码必须与健康驱逐成对
 *      （未配对时保存禁用 + 提示），配对后保存下发
 *   4) 校验 /admin/policies 生效 + 渲染配置出现 internal/llm:request + gateway-retry +
 *      unhealthyExpression + consecutiveFailures
 *   5) 起 AG 加载渲染配置：客户端请求 → 主目标 500 重试两次 → 切备 200（backup-ok）
 *   6) 浏览器关闭两个开关 → 渲染配置回到默认透传 → 同一请求直接 500（primary +1/backup +0）
 *
 * 运行前需已构建 web/dist（npm run build）；脚本自管 seed/服务/AG 进程，结束后全部清理。
 *
 * 用法：node ops/checks/acceptance/m4_retry_flow.mjs [--headed] [--out DIR]
 * 退出码：0 全过；1 FAIL；2 环境未就绪。
 */
import { spawn, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..", "..", "..");
const API_DIR = path.join(ROOT, "api");
const WEB_DIR = path.join(ROOT, "web");
const AG = path.join(ROOT, "ops", "experiments", "ag-lab", "bin-e14", "agentgateway.exe");
const AG_CFG = path.join(API_DIR, ".data_store", "ag-config");
const CFG_PATH = path.join(AG_CFG, "config.yaml");
const MOCK_PRIMARY_PORT = 8911;
const MOCK_BACKUP_PORT = 8912;
const API = "http://127.0.0.1:3700";
const AG_URL = "http://127.0.0.1:3600";
const ADMIN = { username: "admin", password: "admin12345" };

function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}
const argv = process.argv.slice(2);
const HEADED = argv.includes("--headed");
const outIdx = argv.indexOf("--out");
const OUT = path.resolve(outIdx >= 0 ? argv[outIdx + 1] : path.join(ROOT, "ops", "checks", ".logs", "acceptance", "m4-retry-" + stamp()));
fs.mkdirSync(OUT, { recursive: true });

const PY = ["C:/Program Files/Python313/python.exe", "python"].find((p) => p === "python" || fs.existsSync(p));
const TMP = path.join(ROOT, ".scratch", "vite-tmp");
fs.mkdirSync(TMP, { recursive: true });
const BASE_ENV = {
  PATH: "C:/Program Files/nodejs;C:/Program Files/Git/cmd;C:/Windows/System32;C:/Windows",
  SystemRoot: "C:\\Windows",
  TEMP: TMP,
  TMP: TMP,
  APPDATA: "C:/Users/microsoft/AppData/Roaming",
  LOCALAPPDATA: "C:/Users/microsoft/AppData/Local",
  HOME: "C:/Users/microsoft",
  USERPROFILE: "C:/Users/microsoft",
  PYTHONPATH: path.join(API_DIR, "src"),
  PYTHONUTF8: "1",
  PYTHONIOENCODING: "utf-8",
  AG_BINARY: AG,
  SLIPSTREAM_AG_BINARY: AG,
};

const hits = { primary: 0, backup: 0 };
const checks = [];
const children = [];
let cookie = "";
let page = null;
let browser = null;
const shots = [];

function log(step, detail) {
  console.log("STEP " + JSON.stringify({ step, ...(detail || {}) }));
}
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
function killTree(child) {
  if (!child) return;
  try {
    spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { env: BASE_ENV });
  } catch (e) {}
}
function killPort(port) {
  try {
    const r = spawnSync("cmd", ["/c", "netstat -ano | findstr :" + port], { env: BASE_ENV, encoding: "utf8" });
    const pids = new Set();
    for (const line of String(r.stdout || "").split("\n")) {
      const cols = line.trim().split(/\s+/);
      const pid = cols[cols.length - 1];
      if (/^[0-9]+$/.test(pid)) pids.add(pid);
    }
    for (const pid of pids) spawnSync("taskkill", ["/PID", pid, "/T", "/F"], { env: BASE_ENV });
  } catch (e) {}
}
function startMock(port, kind) {
  return new Promise((resolve, reject) => {
    const srv = http.createServer((req, res) => {
      let body = "";
      req.on("data", (c) => {
        body += c;
      });
      req.on("end", () => {
        if (kind === "primary") {
          hits.primary += 1;
          res.writeHead(500, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: { message: "mock primary 500", type: "server_error" } }));
          return;
        }
        hits.backup += 1;
        let model = "mock";
        try {
          model = JSON.parse(body).model || "mock";
        } catch (e) {}
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            id: "chatcmpl-m4",
            object: "chat.completion",
            created: Math.floor(Date.now() / 1000),
            model,
            choices: [{ index: 0, message: { role: "assistant", content: "backup-ok" }, finish_reason: "stop" }],
            usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 },
          }),
        );
      });
    });
    srv.listen(port, "127.0.0.1", () => resolve(srv));
    srv.on("error", reject);
  });
}
async function waitHttp(url, timeoutMs) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    try {
      const r = await fetch(url);
      if (r.status < 500) return r;
    } catch (e) {}
    await sleep(300);
  }
  throw new Error("timeout waiting " + url);
}
function waitPort(port, timeoutMs) {
  return new Promise((resolve, reject) => {
    const end = Date.now() + timeoutMs;
    const attempt = () => {
      const s = net.connect(port, "127.0.0.1");
      s.on("connect", () => {
        s.destroy();
        resolve();
      });
      s.on("error", () => {
        s.destroy();
        if (Date.now() > end) reject(new Error("port timeout " + port));
        else setTimeout(attempt, 300);
      });
    };
    attempt();
  });
}
async function api(method, apiPath, body) {
  const headers = { "content-type": "application/json" };
  if (cookie) headers.cookie = cookie;
  const r = await fetch(API + apiPath, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await r.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch (e) {
    json = text;
  }
  if (!r.ok) throw new Error(method + " " + apiPath + " -> " + r.status + " " + String(text).slice(0, 500));
  return json;
}
async function shot(name) {
  if (!page) return;
  const file = path.join(OUT, name + ".png");
  try {
    await page.screenshot({ path: file, fullPage: false });
    shots.push(file);
  } catch (e) {}
}
function check(id, ok, detail) {
  checks.push({ id, status: ok ? "PASS" : "FAIL", detail: detail === undefined ? "" : String(detail) });
  console.log((ok ? "PASS" : "FAIL") + " " + id + (detail === undefined ? "" : " · " + detail));
  if (!ok) throw new Error("check failed: " + id + (detail === undefined ? "" : " (" + detail + ")"));
}
function writeReport(err) {
  const pass = checks.filter((c) => c.status === "PASS").length;
  const fail = checks.filter((c) => c.status === "FAIL").length;
  const ok = !err && fail === 0 && checks.length > 0;
  const report = { stamp: path.basename(OUT), ok, pass, fail, checks, hits, error: err ? String(err.stack || err).slice(0, 3000) : null, shots };
  fs.writeFileSync(path.join(OUT, "report.json"), JSON.stringify(report, null, 2));
  const lines = [
    "# M4 流程七验收 · 请求内重试 + 健康驱逐（ADR-024 / M3 配置面）",
    "",
    "时间：" + new Date().toISOString(),
    "结论：" + (ok ? "PASS" : "FAIL"),
    "",
    "| 检查 | 结果 | 说明 |",
    "| --- | --- | --- |",
    ...checks.map((c) => "| " + c.id + " | " + c.status + " | " + String(c.detail).replace(/\|/g, "\\|") + " |"),
    "",
    "mock 命中矩阵：primary=" + hits.primary + " backup=" + hits.backup,
    "",
    "证据文件：",
    ...shots.map((s) => "- " + path.relative(OUT, s)),
    "",
  ];
  if (err) lines.push("错误：", "", "```", String(err.stack || err).slice(0, 3000), "```", "");
  fs.writeFileSync(path.join(OUT, "report.md"), lines.join("\n"));
  return ok;
}
async function loadPlaywright() {
  const requireWeb = createRequire(path.join(WEB_DIR, "package.json"));
  const pw = requireWeb("playwright-core");
  const root = "C:/Users/microsoft/AppData/Local/ms-playwright";
  let exe = null;
  if (fs.existsSync(root)) {
    for (const name of fs.readdirSync(root)) {
      if (!name.startsWith("chromium-")) continue;
      const candidate = path.join(root, name, "chrome-win64", "chrome.exe");
      if (fs.existsSync(candidate)) exe = candidate;
    }
  }
  if (!exe) throw new Error("未找到 chromium（playwright-core 浏览器）");
  return { pw, exe };
}
async function openPage(browserInstance) {
  page = await browserInstance.newPage();
  page.setDefaultTimeout(25000);
  await page.goto(API + "/login", { waitUntil: "networkidle" });
  await page.fill("#login-username", ADMIN.username);
  await page.fill("#login-password", ADMIN.password);
  await page.click("button[type=submit]");
  await page.waitForURL((u) => !String(u).includes("/login"), { timeout: 30000 });
  return page;
}
async function pollPolicies(predicate, tries = 40) {
  for (let i = 0; i < tries; i += 1) {
    const raw = await api("GET", "/admin/policies");
    if (predicate(raw.config)) return raw.config;
    await sleep(500);
  }
  return null;
}
async function pollConfig(needlePredicate, tries = 40) {
  let text = "";
  for (let i = 0; i < tries; i += 1) {
    try {
      text = fs.readFileSync(CFG_PATH, "utf8");
    } catch (e) {
      text = "";
    }
    if (needlePredicate(text)) return text;
    await sleep(500);
  }
  return null;
}
async function safeApi(method, apiPath, body) {
  try {
    return await api(method, apiPath, body);
  } catch (e) {
    return null;
  }
}

async function run() {
  if (!fs.existsSync(AG)) throw new Error("agentgateway 二进制缺失：" + AG);
  if (!PY) throw new Error("未找到 python");
  if (!fs.existsSync(path.join(WEB_DIR, "dist", "index.html"))) {
    throw new Error("web/dist 未构建，请先在 web/ 运行 npm run build");
  }
  killPort(3600);
  killPort(3700);
  killPort(MOCK_PRIMARY_PORT);
  killPort(MOCK_BACKUP_PORT);
  const srv1 = await startMock(MOCK_PRIMARY_PORT, "primary");
  const srv2 = await startMock(MOCK_BACKUP_PORT, "backup");
  log("mocks-up", { primary: MOCK_PRIMARY_PORT, backup: MOCK_BACKUP_PORT });

  const seed = spawnSync(PY, ["scripts/seed_demo.py"], { cwd: API_DIR, env: BASE_ENV, encoding: "utf8", timeout: 240000 });
  if (seed.status !== 0) throw new Error("seed_demo.py 失败：" + String(seed.stderr || seed.stdout).slice(-800));
  check("seed.demo", true, "seed_demo.py");

  const apiLog = fs.openSync(path.join(OUT, "api.log"), "w");
  const apiProc = spawn(PY, ["-m", "uvicorn", "l06_api.app:create_app", "--factory", "--host", "127.0.0.1", "--port", "3700"], {
    cwd: API_DIR,
    env: BASE_ENV,
    stdio: ["ignore", apiLog, apiLog],
  });
  children.push(apiProc);
  await waitHttp(API + "/admin/health", 120000);
  log("api-up", { pid: apiProc.pid });

  const lr = await fetch(API + "/admin/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(ADMIN),
  });
  if (!lr.ok) throw new Error("登录失败：" + lr.status + " " + (await lr.text()).slice(0, 300));
  const cookies = lr.headers.getSetCookie ? lr.headers.getSetCookie() : [lr.headers.get("set-cookie")];
  cookie = cookies.map((c) => String(c).split(";")[0]).join("; ");

  const up1 = await api("POST", "/admin/upstreams", {
    name: "m4-primary",
    base_url: "http://127.0.0.1:" + MOCK_PRIMARY_PORT + "/v1",
    api_style: "openai_chat",
    api_key: "sk-mock-primary",
  });
  const up2 = await api("POST", "/admin/upstreams", {
    name: "m4-backup",
    base_url: "http://127.0.0.1:" + MOCK_BACKUP_PORT + "/v1",
    api_style: "openai_chat",
    api_key: "sk-mock-backup",
  });
  const um1 = await api("POST", "/admin/upstream-models", { upstream_id: up1.id, name: "mock-primary-model", model_type: "chat" });
  const um2 = await api("POST", "/admin/upstream-models", { upstream_id: up2.id, name: "mock-ok-model", model_type: "chat" });
  await api("POST", "/admin/public-models", {
    name: "m4-smoke",
    routing_mode: "failover",
    note: "M4 流程七验收",
    targets: [
      { upstream_model_id: um1.id, priority: 0 },
      { upstream_model_id: um2.id, priority: 1 },
    ],
  });
  const usersRaw = await api("GET", "/admin/users");
  const users = Array.isArray(usersRaw) ? usersRaw : usersRaw.items || usersRaw.users || usersRaw.data || [];
  if (!users.length) throw new Error("seed 后无用户");
  const issued = await api("POST", "/admin/users/" + users[0].id + "/api-keys", { user_id: users[0].id, name: "m4-smoke" });
  const clientKey = issued.key;
  check("entities.seeded", Boolean(clientKey), "上游/模型/公开模型/客户端密钥");
  log("entities-ready", { publicModel: "m4-smoke" });

  const { pw, exe } = await loadPlaywright();
  browser = await pw.chromium.launch({
    executablePath: exe,
    headless: !HEADED,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  await openPage(browser);
  await page.goto(API + "/gateway-policies?tab=policies", { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "编辑" }).click();
  await page.getByRole("switch", { name: "启用请求内重试" }).click();
  await page.getByRole("button", { name: "401", exact: true }).click();
  await sleep(400);
  const saveBtn = page.getByRole("button", { name: "保存并下发" });
  const disabledBeforePairing = await saveBtn.isDisabled();
  const bodyText = await page.locator("body").innerText();
  const pairingWarn = bodyText.includes("必须配置健康驱逐") || bodyText.includes("4xx");
  await shot("01-retry-4xx-pairing-guard");
  check("ui.4xx-pairing-guard", disabledBeforePairing && pairingWarn, "保存禁用=" + disabledBeforePairing + " 提示=" + pairingWarn);

  await page.getByRole("button", { name: "401", exact: true }).click();
  await page.getByRole("switch", { name: "启用健康标记与驱逐" }).click();
  await page.getByLabel("consecutive_failures").fill("1");
  await sleep(400);
  check("ui.pairing-fixed-save-enabled", await saveBtn.isEnabled(), "配对后保存可用");
  await saveBtn.click();
  const savedCfg = await pollPolicies((c) => c.retry !== null && c.health !== null);
  check("policies.saved", Boolean(savedCfg), savedCfg ? "retry/health 已保存" : "超时未保存");
  await shot("02-policies-saved");
  log("ui-saved", { retry: savedCfg && savedCfg.retry, health: savedCfg && savedCfg.health });

  const rendered = await pollConfig((t) => t.includes("internal/llm:request") && t.includes("unhealthyExpression"));
  check("render.retry-policy", Boolean(rendered), rendered ? "渲染配置含 internal/llm:request" : "渲染配置缺失");
  if (rendered) fs.writeFileSync(path.join(OUT, "rendered-config-retry.yaml"), rendered);
  if (rendered) {
    const shapes = {
      gatewayRetry: rendered.includes("gateway-retry"),
      unhealthyExpression: rendered.includes("unhealthyExpression"),
      consecutiveFailures: rendered.includes("consecutiveFailures"),
    };
    check("render.shapes", shapes.gatewayRetry && shapes.unhealthyExpression && shapes.consecutiveFailures, JSON.stringify(shapes));
  }

  const agLog = fs.openSync(path.join(OUT, "ag-retry.log"), "w");
  let agProc = spawn(AG, ["-f", CFG_PATH], { cwd: AG_CFG, env: BASE_ENV, stdio: ["ignore", agLog, agLog] });
  children.push(agProc);
  await waitPort(3600, 90000);
  await sleep(1000);
  log("ag-up", { pid: agProc.pid });

  async function ask() {
    const r = await fetch(AG_URL + "/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer " + clientKey },
      body: JSON.stringify({ model: "m4-smoke", messages: [{ role: "user", content: "ping" }], max_tokens: 16 }),
    });
    return { status: r.status, text: await r.text() };
  }
  const first = await ask();
  fs.writeFileSync(path.join(OUT, "response-with-retry.json"), first.text);
  check(
    "dataplane.retry-switch-backup",
    first.status === 200 && first.text.includes("backup-ok") && hits.primary === 2 && hits.backup === 1,
    "status=" + first.status + " hits=" + JSON.stringify(hits),
  );
  killTree(agProc);
  await sleep(1200);

  await page.goto(API + "/gateway-policies?tab=policies", { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "编辑" }).click();
  await page.getByRole("switch", { name: "启用请求内重试" }).click();
  await page.getByRole("switch", { name: "启用健康标记与驱逐" }).click();
  await page.getByRole("button", { name: "保存并下发" }).click();
  const offCfg = await pollPolicies((c) => c.retry === null && c.health === null);
  check("policies.default-off", Boolean(offCfg), offCfg ? "retry/health 已关闭" : "超时未关闭");
  await shot("03-policies-default-off");

  const renderedOff = await pollConfig((t) => !t.includes("internal/llm:request") && !t.includes("unhealthyExpression"));
  check("render.default-passthrough", Boolean(renderedOff), renderedOff ? "渲染配置回到透传" : "渲染配置仍含 retry/health");
  if (renderedOff) fs.writeFileSync(path.join(OUT, "rendered-config-off.yaml"), renderedOff);

  const agLog2 = fs.openSync(path.join(OUT, "ag-passthrough.log"), "w");
  agProc = spawn(AG, ["-f", CFG_PATH], { cwd: AG_CFG, env: BASE_ENV, stdio: ["ignore", agLog2, agLog2] });
  children.push(agProc);
  await waitPort(3600, 90000);
  await sleep(1000);
  const before = { primary: hits.primary, backup: hits.backup };
  const second = await ask();
  fs.writeFileSync(path.join(OUT, "response-passthrough.json"), second.text);
  const delta = { primary: hits.primary - before.primary, backup: hits.backup - before.backup };
  check("dataplane.default-passthrough", second.status === 500 && delta.primary === 1 && delta.backup === 0, "status=" + second.status + " delta=" + JSON.stringify(delta));
  await shot("04-default-passthrough-500");
  log("retry-flow-pass", { hits, delta });
  try {
    srv1.close();
    srv2.close();
  } catch (e) {}
}

let failure = null;
try {
  await run();
} catch (err) {
  failure = err;
  try {
    await shot("99-failure");
  } catch (e) {}
}
finally {
  if (browser) {
    try {
      await browser.close();
    } catch (e) {}
  }
  for (const c of children) killTree(c);
  killPort(3600);
  killPort(3700);
}
const ok = writeReport(failure);
console.log("RESULT " + JSON.stringify({ ok, pass: checks.filter((c) => c.status === "PASS").length, fail: checks.filter((c) => c.status === "FAIL").length, out: OUT }));
if (failure) console.log("FAIL " + String(failure.stack || failure).slice(0, 2000));
process.exit(ok ? 0 : 1);
