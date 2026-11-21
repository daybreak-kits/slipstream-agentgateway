#!/usr/bin/env node
/**
 * W6 ticket 09：全站自适应五档浏览器矩阵。
 *
 * 为什么是独立脚本：响应式缺陷（侧栏把主内容压到 127px、顶栏按钮被裁、抽屉固定
 * 820px 在 768 出屏）都不是 TypeScript/ESLint 能发现的，必须用真实视口驱动
 * Chromium 断言「关键控件可见、可点、不超出视口」。
 *
 * 覆盖（375 / 640 / 768 / 1024 / 1536 五档逐档执行）：
 *   1. 登录页提交按钮在视口内可见；
 *   2. <lg 汉堡打开 off-canvas 侧栏、Esc 关闭，主内容宽度不被常驻侧栏挤压；
 *      ≥lg 侧栏常驻且可折叠；
 *   3. 顶栏主题、通知、刷新、用户菜单可见可点（窄屏允许收进“更多操作”溢出菜单）；
 *   4. 表格页横向滚动 + 冻结操作列在滚动前后都可达；
 *   4b. （W6 ticket 10）模型管理上游/公开两张表：375/768 横滚、操作列贴边 ≤16px、
 *       冻结操作列滚动前后可点、关闭模型行默认置尾；
 *   4b+. （W6 ticket 15）成员编排专项（375/1536）：左6右6/堆叠、行内字段随策略收敛、
 *       行内编辑变脏页头计数联动、候选按上游分组 chip 加入、搜索固定滚动区外、
 *       大列表（300 候选）高度有界；
 *   4c. （W6 ticket 11）其余数据表（连接密钥/上游渠道/用户/日志/审计/角色/价目/配置版本）：
 *       375/768 横滚、冻结操作列贴边可点、关闭行默认置尾、连接密钥显式排序尊重排序、
 *       日志排序列三态图标（未排序 ArrowUpDown 常驻）；
 *   5. 弹窗宽度/高度受视口约束、内容可滚、footer 竖排有间距；
 *      375/768 额外打开上游模型抽屉，断言左右边缘都在视口内、内容区可滚；
 *   6. 375 短视口（375×400）弹窗可滚，提交出口仍可达；
 *   7. 375 用 CDP 模拟粗指针，断言按钮触控目标 ≥44px、表格行高 ≥40px；
 *   8. 静态断点审计：只允许 Tailwind 默认断点，禁止 --breakpoint-* 自定义 token
 *      与 min-[…]/max-[…] 裸断点；图表/表格响应式容器 token 必须在位。
 *   9. （W6 ticket 12）登录页专项（未登录独立上下文）：375/667×375/768/1536 四档
 *      三态主题切换与持久化、登录框三档宽度 384/460/576、密码显隐 aria-pressed、
 *      登录失败错误区固定 h-10 按钮零位移 + 字段标红 + 详情进通知中心、
 *      667×375 横屏提交按钮免滚可见可点、登录成功/失败流程回归。
 *
 * 运行：
 *   node ops/checks/responsive_matrix.mjs                 # 自动在 3777 起隔离站点
 *   node ops/checks/responsive_matrix.mjs --base-url http://127.0.0.1:3777
 *   node ops/checks/responsive_matrix.mjs --channel msedge --headed
 *
 * 自动起站点时需要：
 *   - web/dist 已构建（cd web && npx vite build）；
 *   - api/.venv 可用（Windows: api/.venv/Scripts/python.exe；POSIX: api/.venv/bin/python）；
 *   - 3777 未被占用。脚本会使用临时 SQLite 与临时 ag-config，绝不触碰 3700/3600；
 *     退出时自动结束子进程。3700/3600 与主仓库工作树均被显式拒绝。
 *
 * 退出码：0 全部 PASS；1 有 FAIL；2 环境/依赖/站点未就绪。
 * 证据：ops/checks/.logs/responsive/matrix-<时间戳>/（截图 + report.md/json + server.log）。
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
const PORT = Number(flags.get("port") || process.env.W6_MATRIX_PORT || 3777);
const HEADED = flags.has("headed");
const CHANNEL = flags.get("channel") || process.env.PLAYWRIGHT_CHANNEL || "";
const ADMIN_CRED = parseCred(flags.get("admin") || process.env.W6_ADMIN, { user: "admin", pass: "admin12345" });
const OUT = path.resolve(flags.get("out") || path.join(ROOT, "ops", "checks", ".logs", "responsive", "matrix-" + stamp()));
fs.mkdirSync(OUT, { recursive: true });

const VIEWPORTS = [
  { label: "375", width: 375, height: 667 },
  { label: "640", width: 640, height: 900 },
  { label: "768", width: 768, height: 1024 },
  { label: "1024", width: 1024, height: 768 },
  { label: "1536", width: 1536, height: 864 },
];

const PLAYWRIGHT_TIMEOUT = 15_000;
const results = [];
let currentEvidence = [];
let browser = null;
let serverProc = null;
let serverLog = "";

class MatrixError extends Error {}

function assert(condition, message) {
  if (!condition) throw new MatrixError(message);
}

function baseUrl() {
  return BASE_URL_FLAG || "http://127.0.0.1:" + PORT;
}

function rel(target) {
  return path.relative(ROOT, target).replace(/\\/g, "/");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function test(id, name, fn) {
  currentEvidence = [];
  const started = Date.now();
  try {
    const detail = await fn();
    const row = {
      id,
      name,
      status: "pass",
      detail: detail || "",
      evidence: currentEvidence.slice(),
      ms: Date.now() - started,
    };
    results.push(row);
    console.log("PASS " + id + " (" + row.ms + "ms)" + (detail ? " — " + detail : ""));
    return row;
  } catch (error) {
    const row = {
      id,
      name,
      status: "fail",
      detail: String((error && error.message) || error),
      evidence: currentEvidence.slice(),
      ms: Date.now() - started,
    };
    results.push(row);
    console.log("FAIL " + id + " — " + row.detail);
    return row;
  }
}

/* ------------------------------------------------------------------ *
 * 0. 静态审计：断点 token + 响应式容器 token（不依赖浏览器）
 * ------------------------------------------------------------------ */

function listSourceFiles(dir = path.join(WEB_ROOT, "src")) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return listSourceFiles(full);
    return /\.(?:css|ts|tsx)$/.test(entry.name) ? [full] : [];
  });
}

function staticAudit() {
  const violations = [];
  const rawBreakpoint = /(?:^|[\s"'`])(?:@)?(?:min|max)-\[/;
  for (const file of listSourceFiles()) {
    const text = fs.readFileSync(file, "utf8");
    const short = rel(file);
    if (/--breakpoint-[A-Za-z0-9-]+\s*:/.test(text)) violations.push(short + "：自定义断点 token --breakpoint-*");
    const lines = text.split(/\r?\n/);
    lines.forEach((line, index) => {
      if (rawBreakpoint.test(line)) violations.push(short + ":" + (index + 1) + "：裸断点 min-[…]/max-[…]");
    });
  }
  const css = fs.readFileSync(path.join(WEB_ROOT, "src", "index.css"), "utf8");
  const missing = [];
  for (const token of [
    "--chart-height: 15rem",
    "--chart-height: 20rem",
    "--chart-height: 22.5rem",
    "@media (min-width: 48rem)",
    "@media (min-width: 96rem)",
    "@utility chart-frame",
    "@utility table-responsive",
    "--table-responsive-max-height",
  ]) {
    if (!css.includes(token)) missing.push(token);
  }
  return { violations, missing };
}

/* ------------------------------------------------------------------ *
 * 1. 隔离站点：绝对不碰 3700/3600
 * ------------------------------------------------------------------ */

function pythonExecutable() {
  const candidates = [
    process.env.W6_PYTHON || "",
    process.platform === "win32" ? path.join(API_ROOT, ".venv", "Scripts", "python.exe") : path.join(API_ROOT, ".venv", "bin", "python"),
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
      if (response.ok) return true;
      lastError = "HTTP " + response.status;
    } catch (error) {
      lastError = String((error && error.message) || error);
    }
    await sleep(400);
  }
  throw new MatrixError("隔离站点未在 " + timeoutMs + "ms 内就绪：" + lastError);
}

function tailServerLog(lines = 12) {
  if (!serverLog || !fs.existsSync(serverLog)) return "";
  return fs.readFileSync(serverLog, "utf8").split(/\r?\n/).slice(-lines).join("\n");
}

async function startIsolatedServer() {
  if (PORT === 3700 || PORT === 3600) {
    throw new MatrixError("拒绝在 3700/3600 上运行矩阵（必须使用隔离端口，如 3777）");
  }
  const base = baseUrl();
  // 端口上已有服务：拒绝复用，避免误测主控制面或另一轮矩阵。
  try {
    const probe = await fetch(base + "/admin/health", { signal: AbortSignal.timeout(1200) });
    if (probe.ok) throw new MatrixError("端口 " + PORT + " 已有服务在运行；请换 --port 或传 --base-url 明确复用");
  } catch (error) {
    if (error instanceof MatrixError) throw error;
    // 连接失败 = 端口空闲，继续启动。
  }
  const distIndex = path.join(WEB_ROOT, "dist", "index.html");
  if (!fs.existsSync(distIndex)) {
    throw new MatrixError("web/dist 不存在：先 cd web && npx vite build，或用 --base-url 指向已构建站点");
  }

  const serverDir = path.join(OUT, "server");
  fs.mkdirSync(path.join(serverDir, "ag-config"), { recursive: true });
  serverLog = path.join(serverDir, "server.log");
  const databaseFile = path.join(serverDir, "matrix.db").replace(/\\/g, "/");
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
    SLIPSTREAM_SECRET_KEY: "responsive-matrix-only",
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
  serverProc.on("exit", (code) => {
    if (code !== null && code !== 0 && serverProc) {
      console.error("隔离站点提前退出，code=" + code + "\n" + tailServerLog());
    }
  });
  try {
    await waitForHealth(base);
  } catch (error) {
    throw new MatrixError(error.message + "\n" + tailServerLog());
  }
  return base;
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

async function goto(page, target) {
  const response = await page.goto(baseUrl() + target, { waitUntil: "domcontentloaded", timeout: 30_000 });
  await settle(page, { quietMs: 350 });
  return response;
}

async function visible(locator) {
  return (await locator.count()) > 0 && (await locator.first().isVisible().catch(() => false));
}

async function boxOf(locator) {
  const box = await locator.first().boundingBox();
  if (!box) throw new MatrixError("元素没有布局盒（不可见）：" + (await locator.first().evaluate((node) => node.outerHTML.slice(0, 120)).catch(() => "")));
  return box;
}

function assertInViewport(box, width, height, label) {
  assert(box.x >= -0.5, label + " 左缘出屏：x=" + box.x);
  assert(box.y >= -0.5, label + " 上缘出屏：y=" + box.y);
  assert(box.x + box.width <= width + 0.5, label + " 右缘出屏：right=" + (box.x + box.width) + " > " + width);
  assert(box.y + box.height <= height + 0.5, label + " 下缘出屏：bottom=" + (box.y + box.height) + " > " + height);
}

async function assertClickableAtCenter(page, locator, label) {
  const box = await boxOf(locator);
  const hit = await page.evaluate(
    ({ x, y }) => {
      const node = document.elementFromPoint(x, y);
      return node ? node.outerHTML.slice(0, 160) : "";
    },
    { x: box.x + box.width / 2, y: box.y + box.height / 2 },
  );
  assert(hit.length > 0, label + " 中心点被视口裁剪，elementFromPoint 为空");
}

async function login(page) {
  await page.goto(baseUrl() + "/login", { waitUntil: "domcontentloaded", timeout: 30_000 });
  await page.waitForTimeout(300);
  await page.fill("#login-username", ADMIN_CRED.user);
  await page.fill("#login-password", ADMIN_CRED.pass);
  await page.click('button[type="submit"]');
  const deadline = Date.now() + 45_000; // 冷服务器首登要加载全部懒 chunk，15s 会误报超时
  while (Date.now() < deadline) {
    if (!new URL(page.url()).pathname.startsWith("/login")) return;
    const error = await page.locator("p.text-danger-text").first().innerText().catch(() => "");
    if (error) throw new MatrixError("登录失败：" + error);
    await page.waitForTimeout(200);
  }
  throw new MatrixError("登录超时（检查隔离站点与账号）");
}

async function seedFixtures(page) {
  const suffix = Date.now().toString(36);
  const user = {
    name: "响应式矩阵测试用户" + "·长名称用于撑开表格宽度".repeat(6) + suffix,
    username: "matrix_" + suffix,
    password: "Matrix12345!",
    // W6 ticket 21 合并后 user/agent 角色键已退役，内置角色为 admin/customer/reseller。
    role: "customer",
  };
  const created = await page.request.post(baseUrl() + "/admin/users", { data: user });
  if (!created.ok()) {
    throw new MatrixError("创建矩阵测试用户失败 HTTP " + created.status() + "：" + (await created.text()).slice(0, 300));
  }
  const upstreamName = "矩阵上游-" + suffix;
  const upstream = await page.request.post(baseUrl() + "/admin/upstreams", {
    data: {
      name: upstreamName,
      base_url: "http://127.0.0.1:9",
      api_style: "openai_chat",
      api_key: "sk-matrix-" + suffix,
    },
  });
  if (!upstream.ok()) {
    throw new MatrixError("创建矩阵上游失败 HTTP " + upstream.status() + "：" + (await upstream.text()).slice(0, 300));
  }
  // W6 ticket 11：其余数据表的置尾/排序断言都要按 id 调管理端点（签发密钥、关用户）。
  return { userId: (await created.json()).id, userName: user.name, username: user.username, upstreamName, upstreamId: (await upstream.json()).id };
}

/* W6 ticket 11：其余数据表惰性播种——启用/关闭上游、启用/关闭连接密钥、关闭用户。
 * 长名无空格保证窄屏必然横滚；关闭行供「默认视图置尾」断言；
 * 关闭密钥名称字典序小于启用密钥（closed < open），供「显式升序排序尊重排序、不强制置尾」断言。 */
let rolloutSeeded = false;
async function ensureRolloutSeeded(page, fixtures) {
  if (rolloutSeeded) return;
  rolloutSeeded = true;
  // 签发密钥会触发配置下发（apply），空库没有公开模型会 502——先保证模型表已播种。
  await ensureModelsSeeded(page, fixtures);
  const suffix = Date.now().toString(36);
  const long = "withaverylongunbreakablenameforoverflow";
  const post = async (url, data, label) => {
    const response = await page.request.post(baseUrl() + url, { data });
    if (!response.ok()) throw new MatrixError(label + "失败 HTTP " + response.status() + "：" + (await response.text()).slice(0, 300));
    return response.json();
  };
  const patch = async (url, data, label) => {
    const response = await page.request.patch(baseUrl() + url, { data });
    if (!response.ok()) throw new MatrixError(label + "失败 HTTP " + response.status() + "：" + (await response.text()).slice(0, 300));
    return response.json().catch(() => ({}));
  };
  const openUpstream = await post("/admin/upstreams", {
    name: "matrixrollupopen" + suffix + long,
    base_url: "http://127.0.0.1:9",
    api_style: "openai_chat",
    api_key: "sk-matrix-roll-o-" + suffix,
  }, "创建矩阵开启上游");
  const closedUpstream = await post("/admin/upstreams", {
    name: "matrixrollupclosed" + suffix + long,
    base_url: "http://127.0.0.1:9",
    api_style: "openai_chat",
    api_key: "sk-matrix-roll-c-" + suffix,
  }, "创建矩阵关闭上游");
  await patch("/admin/upstreams/" + closedUpstream.id, { enabled: false }, "关闭矩阵上游");
  const keyOpen = await post("/admin/users/" + fixtures.userId + "/api-keys", {
    user_id: fixtures.userId,
    name: "matrixkeyopen" + suffix + long,
  }, "创建矩阵密钥");
  const keyClosed = await post("/admin/users/" + fixtures.userId + "/api-keys", {
    user_id: fixtures.userId,
    name: "matrixkeyclosed" + suffix + long,
  }, "创建矩阵关闭密钥");
  await patch("/admin/api-keys/" + keyClosed.id + "/status", { status: "disabled" }, "关闭矩阵密钥");
  const closedUser = await post("/admin/users", {
    name: "矩阵关闭用户" + suffix + long,
    username: "matrixclosed_" + suffix,
    password: "Matrix12345!",
    role: "customer",
  }, "创建矩阵关闭用户");
  await patch("/admin/users/" + closedUser.id, { status: "disabled" }, "关闭矩阵用户");
  fixtures.rollout = {
    openUpstreamName: openUpstream.name,
    closedUpstreamName: closedUpstream.name,
    openKeyName: keyOpen.name || "matrixkeyopen" + suffix + long,
    closedKeyName: keyClosed.name || "matrixkeyclosed" + suffix + long,
    closedUsername: closedUser.name,
  };
}

/* W6 ticket 10：模型表数据惰性播种。「登记模型」入口是 ModelsTable 的空态 CTA——
 * 表格非空时消失，所以抽屉测试必须在空表下跑；模型表断言首次执行时才播种行
 * （无空格长名保证窄屏必然横滚；最后一个上游模型关闭，供「关闭行默认置尾」断言）。 */
let modelsSeeded = false;
async function ensureModelsSeeded(page, fixtures) {
  if (modelsSeeded) return;
  modelsSeeded = true;
  const wide = "matrixupstreammodel" + Date.now().toString(36) + "withaverylongunbreakablenameforoverflow";
  const makeModel = async (name, enabled) => {
    const response = await page.request.post(baseUrl() + "/admin/upstream-models", {
      data: { upstream_id: fixtures.upstreamId, name, model_type: "chat", enabled },
    });
    if (!response.ok()) {
      throw new MatrixError("创建矩阵上游模型失败 HTTP " + response.status() + "：" + (await response.text()).slice(0, 300));
    }
    return response.json();
  };
  const modelA = await makeModel(wide + "a", true);
  await makeModel(wide + "b", true);
  const closedModel = await makeModel(wide + "closed", false);
  const publicModel = await page.request.post(baseUrl() + "/admin/public-models", {
    // W6 ticket 11：必须 enabled —— 渲染器只取 enabled 公开模型（rendering.py :97），
    // 禁用公开模型即使挂了成员也不会渲染，签发连接密钥触发的 apply 照样 502。
    data: { name: "matrixpublicmodel" + Date.now().toString(36) + "withaverylongunbreakablenameforoverflow", routing_mode: "failover", enabled: true },
  });
  if (!publicModel.ok()) {
    throw new MatrixError("创建矩阵公开模型失败 HTTP " + publicModel.status() + "：" + (await publicModel.text()).slice(0, 300));
  }
  const publicJson = await publicModel.json();
  // W6 ticket 11：公开模型挂一个成员。渲染器跳过无成员公开模型（contract invariant 1），
  // 全库只有无成员公开模型时，签发连接密钥触发的配置下发会以
  // APPLY_FAILED「nothing to render: no public models」502 失败（矩阵 RED 轮实测）。
  const member = await page.request.post(baseUrl() + "/admin/model-targets", {
    data: { public_model_id: publicJson.id, upstream_model_id: modelA.id, priority: 1 },
  });
  if (!member.ok()) {
    throw new MatrixError("挂矩阵公开模型成员失败 HTTP " + member.status() + "：" + (await member.text()).slice(0, 300));
  }
  fixtures.upstreamModelName = wide;
  fixtures.closedUpstreamModelName = closedModel.name;
  fixtures.publicModelName = publicJson.name;
  fixtures.publicModelId = publicJson.id;
}

async function openOverflow(page) {
  const trigger = page.getByRole("button", { name: "更多操作" });
  assert(await visible(trigger), "窄屏顶栏缺少「更多操作」溢出菜单入口");
  await trigger.click();
  await page.waitForTimeout(150);
}

async function closeOverlay(page) {
  // 两层 Escape：嵌套的“更多操作 → 主题”子菜单需要先关子菜单再关根菜单。
  for (let index = 0; index < 2; index += 1) {
    await page.keyboard.press("Escape");
    await page.waitForTimeout(120);
  }
  await page.waitForTimeout(180);
}

// W6 ticket 13：通知中心专项（375）。seed 一条超长标题/正文的通知：store 在应用
// 启动时从 localStorage 读取（lib/notification-store 的 STORAGE_KEY），每次导航由
// init script 重置，保证专项拿到确定性的行内容；原生 title tooltip 无法进截图，
// 所以 hover 详情断言行 title 属性全文并执行一次真实 hover。
async function assertNotificationCenterNarrow(page) {
  await goto(page, "/users");
  const bell = page.getByRole("button", { name: /^通知/ });
  assert(await visible(bell), "375 下通知按钮不可见");
  await bell.click();
  const panel = page.locator('[data-slot="notification-panel"]');
  await panel.waitFor({ state: "visible", timeout: 3000 });
  // 等开箱 zoom-in（95%→100%）动画落位再量盒，过早量会得到 320×0.95=304 的动画中间帧。
  await page.waitForFunction(
    () => {
      const el = document.querySelector('[data-slot="notification-panel"]');
      return el !== null && el.getBoundingClientRect().width >= 318;
    },
    { timeout: 3000 },
  ).catch(() => {});
  const panelBox = await boxOf(panel);
  // 票09 约束 w-[min(20rem,100vw-2rem)]：375 下取 20rem 上限 320px，双边缘都在视口内。
  assert(panelBox.x >= 0 && panelBox.x + panelBox.width <= 375.5, "375 下通知面板超出视口：" + JSON.stringify(panelBox));
  assert(panelBox.width >= 318 && panelBox.width <= 344, "375 下面板未占满可用宽度（min(20rem, 100vw-2rem)）：width=" + panelBox.width);
  const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  assert(scrollWidth <= 375, "面板打开后页面横向溢出：scrollWidth=" + scrollWidth);

  const row = page.locator('[data-slot="notification-row"]').first();
  const rowTitle = row.locator('[data-slot="notification-title"]');
  const rowTime = row.locator('[data-slot="notification-time"]');
  const rowDesc = row.locator('[data-slot="notification-desc"]');
  if (!(await visible(rowTime))) {
    const dump = await panel
      .evaluate((node) => {
        const li = node.querySelector('[data-slot="notification-row"]');
        return JSON.stringify({
          rows: node.querySelectorAll('[data-slot="notification-row"]').length,
          times: node.querySelectorAll('[data-slot="notification-time"]').length,
          firstRow: li ? li.outerHTML.slice(0, 800) : null,
        });
      })
      .catch(() => String());
    throw new MatrixError("通知行缺少 time 元素（诊断：" + dump + "）");
  }
  assert(await rowTime.getAttribute("datetime"), "time 元素缺 datetime 属性（机器可读时间）");
  const titleBox = await boxOf(rowTitle);
  const timeBox = await boxOf(rowTime);
  const rowBox = await boxOf(row);
  assert(Math.abs(timeBox.y - titleBox.y) <= 4, "时间与标题不在同一行：delta=" + (timeBox.y - titleBox.y).toFixed(1));
  assert(timeBox.x >= titleBox.x + titleBox.width - 1, "时间未在标题行尾（与标题重叠）");
  assert(timeBox.x + timeBox.width <= rowBox.x + rowBox.width + 0.5, "时间超出行右缘");
  // 正文单行省略：一行高（text-2xs 行高 18）且长文案下 scrollWidth > clientWidth 证明 truncate 生效。
  const descBox = await boxOf(rowDesc);
  assert(descBox.height <= 20, "通知正文不是单行：height=" + descBox.height);
  const descTruncated = await rowDesc.evaluate((node) => node.scrollWidth > node.clientWidth);
  assert(descTruncated, "正文没有触发截断（文案不够长或未用 truncate）");
  // hover 完整详情：行 title 属性包含标题与正文全文。
  const detail = (await row.getAttribute("title")) ?? "";
  assert(detail.includes("超长标题") && detail.includes("hover 可读完整详情"), "行 hover 详情缺失或不完整：" + detail);
  await page.hover('[data-slot="notification-row"]');
  await shot(page, "375-notification-hover");
  // 可操作：清空后回到空态。
  await page.getByRole("button", { name: "清空" }).click();
  assert(await visible(page.getByText("暂无通知")), "清空后未回到空态");
  await closeOverlay(page);
  return "面板 " + Math.round(panelBox.width) + "px 双缘在视口内、时间行尾同高、正文单行截断、hover 详情完整、清空可点";
}

async function assertTopbarCluster(page, width) {
  // 主题：≥md 直接入口；<md 收进“更多操作 → 主题”子菜单。
  const theme = page.getByRole("button", { name: "切换主题" });
  if (await visible(theme)) {
    await theme.click();
    assert(await visible(page.getByRole("menuitemradio", { name: /浅色/ })), "主题菜单没有浅色选项");
    await closeOverlay(page);
  } else {
    await openOverflow(page);
    const sub = page.getByRole("menuitem", { name: /主题/ }).first();
    assert(await visible(sub), "溢出菜单没有主题入口");
    await sub.click();
    const themeOption = page.getByRole("menuitemradio", { name: /浅色/ });
    if (!(await visible(themeOption))) {
      // 触屏/无 hover 环境用键盘右箭头打开子菜单。
      await page.keyboard.press("ArrowRight");
      await page.waitForTimeout(200);
    }
    assert(await visible(themeOption), "溢出菜单主题子菜单没有选项");
    await closeOverlay(page);
  }

  // 通知：任何档位都必须有直接入口。
  const bell = page.getByRole("button", { name: /^通知/ });
  assert(await visible(bell), width + " 下通知按钮不可见");
  await bell.click();
  const panel = page.locator('[data-radix-popper-content-wrapper]').filter({ hasText: "通知" }).last();
  await panel.waitFor({ state: "visible", timeout: 3000 }).catch(() => {});
  assert(await visible(panel), width + " 下通知面板未打开");
  await closeOverlay(page);

  // 刷新：≥md 直接入口；<md 溢出菜单。
  let refresh = page.getByRole("button", { name: "刷新全部数据" });
  if (!(await visible(refresh))) {
    await openOverflow(page);
    refresh = page.getByRole("menuitem", { name: "刷新全部数据" });
    assert(await visible(refresh), "溢出菜单没有刷新入口");
  }
  await refresh.click();
  await page.waitForTimeout(400);
  await closeOverlay(page);

  // 用户菜单：任何档位都必须有直接入口，且退出登录可达。
  const userMenu = page.getByRole("button", { name: "用户菜单" });
  await userMenu.waitFor({ state: "visible", timeout: 5000 }).catch(() => {});
  assert(await visible(userMenu), width + " 下用户菜单不可见");
  await userMenu.click();
  assert(await visible(page.getByRole("menuitem", { name: "退出登录" })), width + " 下用户菜单没有退出登录");
  await closeOverlay(page);
}

async function assertSidebar(page, width, height) {
  const main = page.locator("main").first();
  const mainBox = await boxOf(main);
  if (width < 1024) {
    assert(mainBox.width >= width - 1.5, width + " 下主内容被常驻侧栏挤压：main=" + mainBox.width + "px");
    const open = page.getByRole("button", { name: "打开导航" });
    assert(await visible(open), width + " 下缺少汉堡按钮");
    await open.click();
    // Sheet 打开动画 500ms：等落位后再量盒，避免量到 translateX 动画中的负坐标。
    await page.waitForTimeout(650);
    const sidebar = page.locator('[data-testid="app-sidebar"]:visible').first();
    assert(await visible(sidebar), width + " 下汉堡未打开侧栏");
    const sidebarBox = await boxOf(sidebar);
    assertInViewport(sidebarBox, width, height, "移动侧栏");
    const afterOpen = await boxOf(main);
    assert(Math.abs(afterOpen.width - mainBox.width) <= 1.5, width + " 下打开侧栏挤压了主内容宽度");
    await shot(page, width + "-sidebar-open");
    await closeOverlay(page);
    await page.waitForTimeout(300);
    assert(!(await visible(page.locator('[data-testid="app-sidebar"]:visible').first())), width + " 下 Esc 后侧栏未关闭");
  } else {
    assert(!(await visible(page.getByRole("button", { name: "打开导航" }))), width + " 下桌面仍显示汉堡按钮");
    const sidebar = page.locator('[data-testid="app-sidebar"]:visible').first();
    assert(await visible(sidebar), width + " 下桌面侧栏不可见");
    const expanded = await boxOf(sidebar);
    const toggle = page.getByRole("button", { name: /收起侧栏|展开侧栏/ }).first();
    assert(await visible(toggle), width + " 下缺少侧栏折叠按钮");
    await toggle.click();
    await page.waitForTimeout(350);
    const collapsed = await boxOf(sidebar);
    assert(collapsed.width < expanded.width - 100, width + " 下侧栏折叠未生效：" + expanded.width + " -> " + collapsed.width);
    await toggle.click();
    await page.waitForTimeout(350);
    await shot(page, width + "-sidebar-desktop");
  }
}

async function assertTable(page, width, height, fixtures) {
  await goto(page, "/users");
  // 列表视图展开全部用户，避免树视图默认折叠让测试行不在 DOM 视口内。
  const listView = page.getByRole("button", { name: "列表", exact: true });
  if (await visible(listView)) {
    await listView.click();
    await page.waitForTimeout(250);
  }
  const wrap = page.locator('[data-slot="table-wrap"]').first();
  await wrap.waitFor({ state: "visible", timeout: 8000 });
  const dims = await wrap.evaluate((node) => ({
    scrollWidth: node.scrollWidth,
    clientWidth: node.clientWidth,
    overflowX: getComputedStyle(node).overflowX,
  }));
  assert(dims.overflowX === "auto" || dims.overflowX === "scroll", "表格容器不是横向滚动容器");
  if (width < 1024) {
    assert(dims.scrollWidth > dims.clientWidth + 1, width + " 下表格没有横向滚动（scroll=" + dims.scrollWidth + " client=" + dims.clientWidth + "）");
  }
  const row = page.locator("tbody tr").filter({ hasText: fixtures.username }).first();
  await row.scrollIntoViewIfNeeded();
  const edit = row.getByRole("button", { name: "编辑" }).first();
  assert(await visible(edit), width + " 下测试用户行没有可点的编辑按钮");
  await wrap.evaluate((node) => { node.scrollLeft = 0; });
  await page.waitForTimeout(200);
  const startBox = await boxOf(edit);
  assert(startBox.x >= -0.5, width + " 下操作列左缘出屏（滚动到最左时）");
  assert(startBox.x + startBox.width <= width + 0.5, width + " 下操作列右缘出屏（冻结列失效）");
  await assertClickableAtCenter(page, edit, "表格操作列");
  await wrap.evaluate((node) => { node.scrollLeft = node.scrollWidth; });
  await page.waitForTimeout(200);
  const endBox = await boxOf(edit);
  assert(endBox.x >= -0.5 && endBox.x + endBox.width <= width + 0.5, width + " 下操作列在横向滚动后不可达");
  await shot(page, width + "-table");
  return "表格 scroll/client=" + dims.scrollWidth + "/" + dims.clientWidth + "，操作列滚动前后均可达";
}

/** W6 ticket 10：模型管理两张表（上游 / 公开）的表格专项——窄屏横滚、冻结操作列可操作、
 * 操作列按钮贴近表格右边缘（≤16px）、关闭行默认置尾。复用票 09 的 table-responsive 与冻结列基建。 */
async function assertModelsTable(page, width, fixtures, tabKey) {
  await ensureModelsSeeded(page, fixtures);
  await goto(page, tabKey === "public" ? "/models?tab=public" : "/models");
  const wrap = page.locator('[data-slot="table-wrap"]').first();
  await wrap.waitFor({ state: "visible", timeout: 8000 });
  const dims = await wrap.evaluate((node) => ({
    scrollWidth: node.scrollWidth,
    clientWidth: node.clientWidth,
    overflowX: getComputedStyle(node).overflowX,
  }));
  assert(dims.overflowX === "auto" || dims.overflowX === "scroll", "模型表容器不是横向滚动容器");
  assert(
    dims.scrollWidth > dims.clientWidth + 1,
    width + " 下" + (tabKey === "public" ? "公开" : "上游") + "模型表没有横向滚动（scroll=" + dims.scrollWidth + " client=" + dims.clientWidth + "）",
  );
  const modelName = tabKey === "public" ? fixtures.publicModelName : fixtures.upstreamModelName;
  const row = page.locator("tbody tr").filter({ hasText: modelName }).first();
  await row.waitFor({ state: "visible", timeout: 8000 });
  // 表体在 table-responsive 容器内自滚动：375 下行可能整行在折叠区外，先滚入视口再量盒。
  await row.scrollIntoViewIfNeeded();
  const edit = row.getByRole("button", { name: "编辑" }).first();
  assert(await visible(edit), width + " 下" + (tabKey === "public" ? "公开" : "上游") + "模型行没有可点的编辑按钮");
  await wrap.evaluate((node) => { node.scrollLeft = 0; });
  await page.waitForTimeout(200);
  const startBox = await boxOf(edit);
  assert(startBox.x >= -0.5 && startBox.x + startBox.width <= width + 0.5, width + " 下" + (tabKey === "public" ? "公开" : "上游") + "模型操作列滚动到最左时不可见（冻结列失效）");
  await assertClickableAtCenter(page, edit, (tabKey === "public" ? "公开" : "上游") + "模型操作列");
  // 贴边：最后一个可交互元素的右缘与滚动容器右缘的距离 ≤16px（pr-2 = 8px 基线）。
  const edgeGap = await wrap.evaluate((node) => {
    const lastRow = node.querySelector("tbody tr:last-child");
    const buttons = lastRow ? Array.from(lastRow.querySelectorAll("td:last-child button")) : [];
    const last = buttons[buttons.length - 1];
    if (!last) return null;
    return node.getBoundingClientRect().right - last.getBoundingClientRect().right;
  });
  assert(edgeGap !== null, "操作列末行没有可量按钮");
  assert(edgeGap <= 16.5, width + " 下操作列最后一个按钮未贴右边缘（距容器右缘 " + Math.round(edgeGap) + "px > 16px）");
  // 关闭行默认置尾：播种的关闭模型必须排在全部启用模型之后（user story 41）。
  const order = await page.evaluate(
    ({ closed, enabledSuffix }) => {
      const rows = Array.from(document.querySelectorAll("tbody tr"));
      const index = (name) => rows.findIndex((tr) => tr.textContent.includes(name));
      return { closedIndex: index(closed), firstEnabledIndex: rows.findIndex((tr) => tr.textContent.includes(enabledSuffix)) };
    },
    { closed: fixtures.closedUpstreamModelName, enabledSuffix: fixtures.upstreamModelName },
  );
  if (tabKey !== "public") {
    assert(order.firstEnabledIndex >= 0 && order.closedIndex > order.firstEnabledIndex, "默认视图关闭模型行必须排在启用行之后（置尾失效：" + JSON.stringify(order) + "）");
  }
  await shot(page, width + "-models-" + tabKey);
  return (
    (tabKey === "public" ? "公开" : "上游") +
    "模型表 scroll/client=" + dims.scrollWidth + "/" + dims.clientWidth +
    "，操作列贴边 " + Math.round(edgeGap) + "px，冻结列滚动前后可操作"
  );
}

/** 行序查询：在指定滚动容器内按文本找行号（找不到 = -1）。 */
async function rowIndexOf(wrap, text) {
  return wrap.evaluate((node, needle) => {
    const trs = Array.from(node.querySelectorAll("tbody tr"));
    return trs.findIndex((tr) => tr.textContent.includes(needle));
  }, text);
}

/** W6 ticket 11：其余数据表专项——窄屏横滚、冻结操作列滚动前后可点、
 * 操作列最后一个内容元素贴近滚动容器右缘（≤16px，pr-2 基线）、
 * 关闭行默认置尾（spec 提供 open/closed 行文本时）。
 * 表格无数据行（空态）时只断言容器契约并注明，播种表不受影响。 */
async function assertRolloutTable(page, width, fixtures, spec) {
  await ensureRolloutSeeded(page, fixtures);
  if (spec.seedModels) await ensureModelsSeeded(page, fixtures);
  await goto(page, spec.path);
  if (spec.listView) {
    const listView = page.getByRole("button", { name: "列表", exact: true });
    if (await visible(listView)) {
      await listView.click();
      await page.waitForTimeout(250);
    }
  }
  const wrap = page.locator('[data-slot="table-wrap"]').first();
  await wrap.waitFor({ state: "visible", timeout: 8000 });
  const dims = await wrap.evaluate((node) => ({
    scrollWidth: node.scrollWidth,
    clientWidth: node.clientWidth,
    overflowX: getComputedStyle(node).overflowX,
  }));
  assert(dims.overflowX === "auto" || dims.overflowX === "scroll", spec.label + "容器不是横向滚动容器");
  if (width < 1024 && spec.expectOverflow !== false) {
    assert(dims.scrollWidth > dims.clientWidth + 1, width + " 下" + spec.label + "没有横向滚动（scroll=" + dims.scrollWidth + " client=" + dims.clientWidth + "）");
  }
  // 操作列目标：优先 spec.rowText 的行，否则全表第一个操作按钮；无按钮列（价目）只锚行。
  const rows = wrap.locator("tbody tr");
  const rowLocator = spec.rowText ? rows.filter({ hasText: spec.rowText }).first() : null;
  const actionTarget = spec.actionButton
    ? (rowLocator ? rowLocator.getByRole("button", { name: spec.actionButton }).first() : wrap.getByRole("button", { name: spec.actionButton }).first())
    : rowLocator;
  const hasTarget = actionTarget && (await visible(actionTarget));
  if (!hasTarget) {
    await shot(page, width + "-rollout-" + spec.key);
    return spec.label + " 空表：容器横滚契约已验，无数据行可量冻结/贴边";
  }
  await actionTarget.scrollIntoViewIfNeeded();
  if (spec.actionButton) {
    await wrap.evaluate((node) => { node.scrollLeft = 0; });
    await page.waitForTimeout(200);
    const startBox = await boxOf(actionTarget);
    assert(startBox.x >= -0.5 && startBox.x + startBox.width <= width + 0.5, width + " 下" + spec.label + "操作列滚动到最左时不可见（冻结列失效）");
    await assertClickableAtCenter(page, actionTarget, spec.label + "操作列");
    await wrap.evaluate((node) => { node.scrollLeft = node.scrollWidth; });
    await page.waitForTimeout(200);
    const endBox = await boxOf(actionTarget);
    assert(endBox.x >= -0.5 && endBox.x + endBox.width <= width + 0.5, width + " 下" + spec.label + "操作列在横向滚动后不可达");
  }
  // 贴边：末行操作单元格内最右内容的右缘与滚动容器右缘距离 ≤16px（无按钮时量任意内容元素）。
  const edgeGap = await wrap.evaluate((node) => {
    const lastRow = node.querySelector("tbody tr:last-child");
    if (!lastRow) return null;
    let maxRight = null;
    for (const el of lastRow.querySelectorAll("td:last-child *")) {
      const rect = el.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0 && (maxRight === null || rect.right > maxRight)) maxRight = rect.right;
    }
    return maxRight === null ? null : node.getBoundingClientRect().right - maxRight;
  });
  assert(edgeGap !== null, spec.label + "末行没有可量元素");
  assert(edgeGap <= 16.5, width + " 下" + spec.label + "操作列未贴右边缘（距容器右缘 " + Math.round(edgeGap) + "px > 16px）");
  // 关闭行默认置尾（可选断言）。
  if (spec.closedRowText && spec.openRowText) {
    const openIndex = await rowIndexOf(wrap, spec.openRowText);
    const closedIndex = await rowIndexOf(wrap, spec.closedRowText);
    assert(openIndex >= 0 && closedIndex > openIndex, spec.label + "默认视图关闭行必须排在开启行之后（置尾失效：" + JSON.stringify({ openIndex, closedIndex }) + "）");
  }
  await shot(page, width + "-rollout-" + spec.key);
  return (
    spec.label + " scroll/client=" + dims.scrollWidth + "/" + dims.clientWidth +
    "，操作列贴边 " + Math.round(edgeGap) + "px" +
    (spec.actionButton ? "，冻结列滚动前后可点" : "")
  );
}

/** W6 ticket 11：连接密钥表显式排序尊重排序——默认视图关闭密钥置尾；
 * 点击「名称」升序后关闭密钥（字典序在前）必须排最前，不得强制置尾（user story 42）。 */
async function assertClientKeysRollout(page, width, fixtures) {
  // spec 里要读 fixtures.rollout 的播种名：必须先播种再构造 spec（对象字面量会立即求值）。
  await ensureRolloutSeeded(page, fixtures);
  await assertRolloutTable(page, width, fixtures, {
    key: "client-keys",
    path: "/client-keys",
    label: "连接密钥表",
    actionButton: "重命名",
    rowText: fixtures.rollout.openKeyName,
    openRowText: fixtures.rollout.openKeyName,
    closedRowText: fixtures.rollout.closedKeyName,
  });
  const nameTh = page.locator("th").filter({ hasText: "名称" }).first();
  // 三态图标（浏览器实证）：未排序 ArrowUpDown 常驻，点击后升序 ArrowUpNarrowWide。
  const beforeIcon = (await nameTh.locator("svg").first().getAttribute("class")) || "";
  assert(beforeIcon.includes("lucide-arrow-up-down"), "可排序列未排序必须常驻 ArrowUpDown（当前 " + beforeIcon + "）");
  // 375 下冻结操作列（约 290px 宽）盖住首列右半：点表头左缘，避开冻结列拦截点击。
  await nameTh.click({ position: { x: 5, y: 12 } });
  await page.waitForTimeout(300);
  assert((await nameTh.getAttribute("aria-sort")) === "ascending", "显式排序后名称列表头必须带 aria-sort=ascending");
  const afterIcon = (await nameTh.locator("svg").first().getAttribute("class")) || "";
  assert(afterIcon.includes("lucide-arrow-up-narrow-wide"), "升序必须显示 ArrowUpNarrowWide（当前 " + afterIcon + "）");
  const wrap2 = page.locator('[data-slot="table-wrap"]').first();
  const closedIndex = await rowIndexOf(wrap2, fixtures.rollout.closedKeyName);
  const openIndex = await rowIndexOf(wrap2, fixtures.rollout.openKeyName);
  assert(openIndex >= 0 && closedIndex >= 0 && closedIndex < openIndex, "显式按名称升序排序后必须尊重排序，关闭密钥（字典序在前）不得强制置尾：" + JSON.stringify({ closedIndex, openIndex }));
  await shot(page, width + "-rollout-client-keys-sorted");
  return "默认视图关闭密钥置尾；名称升序后关闭密钥回到字典序位置（尊重排序），三态图标随点击切换";
}

/** W6 ticket 11：用户表列表视图——关闭用户置尾（树视图不参与置尾，由源码契约钉住）。 */
async function assertUsersRollout(page, width, fixtures) {
  await ensureRolloutSeeded(page, fixtures);
  return assertRolloutTable(page, width, fixtures, {
    key: "users",
    path: "/users",
    label: "用户表（列表视图）",
    actionButton: "编辑",
    rowText: fixtures.rollout.closedUsername,
    openRowText: fixtures.userName,
    closedRowText: fixtures.rollout.closedUsername,
    listView: true,
  });
}

/** W6 ticket 11：日志页服务端排序表头三态图标——未排序常驻 ArrowUpDown，
 * 点击后升序 ArrowUpNarrowWide；按钮可访问名保持「按词元排序」不被图标标签污染。
 * 矩阵站点只起控制面 API（无 relay 流量），空态不渲染表格：此时三态图标契约
 * 由 check-ui-foundation 的 SortHeader SSR 断言覆盖，这里只验页面可达不崩。 */
async function assertLogsRollout(page, width, fixtures) {
  await goto(page, "/logs");
  const tokensBtn = page.getByRole("button", { name: "按词元排序", exact: true }).first();
  if (!(await visible(tokensBtn))) {
    await shot(page, width + "-rollout-logs");
    return "日志空态（矩阵站点无 relay 流量不渲染表格）：三态图标契约由 SSR 门禁覆盖";
  }
  const unsortedIcon = (await tokensBtn.locator("svg").first().getAttribute("class")) || "";
  assert(unsortedIcon.includes("lucide-arrow-up-down"), "未排序的日志排序列必须常驻 ArrowUpDown（当前 " + unsortedIcon + "）");
  await tokensBtn.click();
  await page.waitForTimeout(400);
  const ascBtn = page.getByRole("button", { name: "按词元排序", exact: true }).first();
  assert(await visible(ascBtn), "点击后「按词元排序」按钮可访问名被图标 aria-label 污染（必须 aria-hidden）");
  const ascIcon = (await ascBtn.locator("svg").first().getAttribute("class")) || "";
  assert(ascIcon.includes("lucide-arrow-up-narrow-wide"), "升序必须显示 ArrowUpNarrowWide（当前 " + ascIcon + "）");
  await shot(page, width + "-rollout-logs");
  return "未排序 ArrowUpDown 常驻、点击后升序图标切换、按钮可访问名不变";
}

async function assertDialog(page, width, height) {
  await goto(page, "/users");
  const create = page.getByRole("button", { name: "新建用户" }).first();
  assert(await visible(create), width + " 下缺少新建用户按钮");
  await create.click();
  const dialog = page.getByRole("dialog").first();
  await dialog.waitFor({ state: "visible", timeout: 5000 });
  await page.waitForTimeout(320);
  const box = await boxOf(dialog);
  assertInViewport(box, width, height, "弹窗");
  assert(box.width <= width - 16, width + " 下弹窗宽度未留出视口边距：" + box.width);
  const layout = await dialog.evaluate((node) => {
    const style = getComputedStyle(node);
    const footer = node.querySelector('[data-slot="dialog-footer"]');
    return {
      overflowY: style.overflowY,
      maxHeight: style.maxHeight,
      scrollHeight: node.scrollHeight,
      clientHeight: node.clientHeight,
      footerGap: footer ? getComputedStyle(footer).rowGap : "",
      footerDirection: footer ? getComputedStyle(footer).flexDirection : "",
    };
  });
  assert(layout.overflowY === "auto" || layout.overflowY === "scroll", width + " 下弹窗内容区不可滚（overflow-y=" + layout.overflowY + "）");
  if (width < 640) {
    assert(layout.footerDirection.startsWith("column"), width + " 下弹窗 footer 未竖排");
    assert(Number.parseFloat(layout.footerGap || "0") >= 8, width + " 下弹窗 footer 竖排无 8px 间距");
  }
  await shot(page, width + "-dialog");
  await closeOverlay(page);
  await page.waitForTimeout(250);
  return "弹窗 " + Math.round(box.width) + "×" + Math.round(box.height) + "，overflow-y=" + layout.overflowY;
}

async function assertShortViewportDialog(page) {
  await page.setViewportSize({ width: 375, height: 400 });
  await goto(page, "/users");
  await page.getByRole("button", { name: "新建用户" }).first().click();
  const dialog = page.getByRole("dialog").first();
  await dialog.waitFor({ state: "visible", timeout: 5000 });
  await page.waitForTimeout(320);
  const box = await boxOf(dialog);
  assertInViewport(box, 375, 400, "375×400 弹窗");
  const layout = await dialog.evaluate((node) => ({
    overflowY: getComputedStyle(node).overflowY,
    scrollHeight: node.scrollHeight,
    clientHeight: node.clientHeight,
  }));
  assert(layout.overflowY === "auto" || layout.overflowY === "scroll", "短视口弹窗不可滚");
  assert(layout.scrollHeight > layout.clientHeight + 1, "短视口弹窗内容超过高度却没有滚动区");
  await shot(page, "375x400-dialog-short");
  await closeOverlay(page);
  return "375×400 弹窗高 " + Math.round(box.height) + "，可滚（" + layout.scrollHeight + " > " + layout.clientHeight + "）";
}

async function assertDrawer(page, width, height) {
  await goto(page, "/models");
  // 「登记模型」是空态 CTA：表里有行（ticket 10 播种后）时改走行内「编辑」，
  // 打开的是同一个 UpstreamModelDrawer，响应式断言等价。
  const create = page.getByRole("button", { name: "登记模型" }).first();
  let open = create;
  if (!(await visible(create))) {
    open = page.locator("tbody tr").first().getByRole("button", { name: "编辑" }).first();
    assert(await visible(open), width + " 下缺少登记模型入口或行内编辑入口（无法打开模型抽屉）");
  }
  await open.click();
  const drawer = page.locator('[data-slot="upstream-model-drawer"]');
  await drawer.waitFor({ state: "visible", timeout: 5000 });
  // 抽屉打开动画 500ms；动画中 rect 可能仍在视口外（正是 P0-3 的观感），落位后再断言。
  await page.waitForTimeout(650);
  const box = await boxOf(drawer);
  assert(box.x >= -0.5, width + " 下抽屉左侧出屏：x=" + box.x);
  assert(box.x + box.width <= width + 0.5, width + " 下抽屉右侧出屏：right=" + (box.x + box.width) + " > " + width);
  assert(box.width <= width, width + " 下抽屉宽度超过视口");
  if (width < 640) {
    assert(Math.abs(box.width - width) <= 1.5, width + " 下抽屉不是全宽：" + box.width);
  }
  const scroll = await drawer.evaluate((node) => {
    const candidates = [node, ...node.querySelectorAll("*")];
    const target = candidates.find((item) => {
      const style = getComputedStyle(item);
      return style.overflowY === "auto" || style.overflowY === "scroll";
    });
    return target
      ? { ok: true, scrollHeight: target.scrollHeight, clientHeight: target.clientHeight }
      : { ok: false };
  });
  assert(scroll.ok, width + " 下上游模型抽屉内容区没有可滚容器");
  if (width < 640) {
    assert(scroll.scrollHeight > scroll.clientHeight + 1, width + " 下窄屏抽屉内容溢出却不可滚");
  }
  await shot(page, width + "-upstream-drawer");
  await closeOverlay(page);
  await page.waitForTimeout(300);
  return "抽屉 " + Math.round(box.width) + "px（视口 " + width + "），内容区 overflow-y-auto（" + scroll.scrollHeight + "/" + scroll.clientHeight + "）";
}

/* W6 ticket 14：公开模型编辑页专项——紧凑布局（基本信息三列/策略三横卡/页头保存）、
 * 只读摘要折叠不占主编辑区、成员编排左6右6容器与内部滚动、脏标记变脏布局零位移、
 * 窄屏（375/768）堆叠且保存入口可见。
 * 变脏断言改备注字段：页头 h1 随名称变化，改名称会引入与脏标记无关的布局噪声。 */
async function assertPublicModelEdit(page, width, fixtures) {
  await ensureModelsSeeded(page, fixtures);
  assert(fixtures.publicModelId, "矩阵公开模型缺 id（publicModelId 未播种）");
  await goto(page, "/models/public/" + fixtures.publicModelId);
  await page.locator('[data-slot="public-model-page"]').waitFor({ state: "visible", timeout: 8000 });

  // 1. 保存/状态/未保存数量固定页头：不滚动即可见（sticky 页头挂在 main 滚动上下文）。
  const headerSave = page.locator('[data-slot="header-save"]');
  assert(await visible(headerSave), width + " 下页头保存区（header-save）不可见");
  const saveBtn = headerSave.getByRole("button", { name: "保存" }).first();
  assert(await visible(saveBtn), width + " 下页头保存按钮不可见");
  const saveBox = await boxOf(saveBtn);
  const height = (VIEWPORTS.find((item) => item.width === width) || { height: 900 }).height;
  assertInViewport(saveBox, width, height, "页头保存按钮");

  // 2. 基本信息三列（≥md 同排；375 单列堆叠）与策略三张横向卡片。
  const nameBox = await boxOf(page.locator('[data-slot="field-name"]'));
  const noteBox = await boxOf(page.locator('[data-slot="field-note"]'));
  const enabledBox = await boxOf(page.locator('[data-slot="field-enabled"]'));
  const cards = page.locator('[data-slot="strategy-card"]');
  assert((await cards.count()) === 3, "策略卡必须恰好三张，实际 " + (await cards.count()));
  const cardBoxes = [await boxOf(cards.nth(0)), await boxOf(cards.nth(1)), await boxOf(cards.nth(2))];
  if (width >= 768) {
    assert(
      Math.abs(nameBox.y - noteBox.y) < 2 && Math.abs(nameBox.y - enabledBox.y) < 2,
      width + " 下基本信息不是三列（名称/备注/启用不同排）",
    );
    assert(
      Math.abs(cardBoxes[0].y - cardBoxes[1].y) < 2 && Math.abs(cardBoxes[0].y - cardBoxes[2].y) < 2,
      width + " 下策略不是三张横向卡片",
    );
  } else {
    assert(enabledBox.y > nameBox.y + 8, width + " 下基本信息未堆叠成单列");
    assert(cardBoxes[1].y > cardBoxes[0].y + 8, width + " 下策略卡未堆叠");
  }

  // 3. 成员编排容器：桌面左6右6，窄屏上下堆叠；两栏各自内部滚动且列头固定在滚动区外。
  const boardLeft = page.locator('[data-slot="member-board-left"]');
  const boardRight = page.locator('[data-slot="member-board-right"]');
  const leftBox = await boxOf(boardLeft);
  const rightBox = await boxOf(boardRight);
  if (width >= 1024) {
    assert(
      Math.abs(leftBox.y - rightBox.y) < 2 && rightBox.x >= leftBox.x + leftBox.width - 2,
      width + " 下成员编排不是左右两栏（左6右6）",
    );
  } else {
    assert(rightBox.y >= leftBox.y + leftBox.height - 2, width + " 下成员编排两栏未上下堆叠");
  }
  const columns = await page.evaluate(() => {
    const measure = (slot) => {
      const head = document.querySelector('[data-slot="member-column-head"][data-column="' + slot + '"]');
      const scroll = head && head.parentElement ? head.parentElement.querySelector('[data-slot="member-scroll"]') : null;
      if (!head || !scroll) return null;
      const headBox = head.getBoundingClientRect();
      const scrollBox = scroll.getBoundingClientRect();
      const style = getComputedStyle(scroll);
      return {
        headBottom: headBox.bottom,
        scrollTop: scrollBox.top,
        scrollHeight: scrollBox.height,
        overflowY: style.overflowY,
        maxHeightRaw: style.maxHeight,
        viewportH: window.innerHeight,
      };
    };
    return { left: measure("left"), right: measure("right") };
  });
  for (const key of ["left", "right"]) {
    const column = columns[key];
    assert(column !== null, key + " 栏缺少列头或滚动容器（member-column-head/member-scroll）");
    assert(column.overflowY === "auto" || column.overflowY === "scroll", key + " 栏不是内部滚动容器");
    const cap = Math.min(column.viewportH * 0.6, 560);
    assert(column.scrollHeight <= cap + 1, key + " 栏滚动区高 " + Math.round(column.scrollHeight) + "px 超过 min(60vh,560px)=" + Math.round(cap) + "px");
    assert(column.headBottom <= column.scrollTop + 2, key + " 栏列头未固定在滚动区上方（滚动会带走列头）");
  }

  // 4. 只读摘要折叠：默认收起不占主编辑区，展开后内容可见。
  const summary = page.locator('[data-slot="readonly-summary"]');
  assert(await visible(summary), width + " 下只读摘要折叠容器不可见");
  assert(!(await summary.evaluate((node) => node.hasAttribute("open"))), "只读摘要默认应折叠（不占主编辑区）");
  await summary.locator("summary").click();
  await page.waitForTimeout(150);
  assert(await summary.locator('[data-slot="public-model-summary"]').isVisible(), "只读摘要展开后内容不可见");
  await summary.locator("summary").click();
  await page.waitForTimeout(150);

  // 5. 硬验收：变脏前后字段位置/尺寸逐像素不变。滚动容器是 main（window.scrollY 恒 0），
  //    量测前后都把 main.scrollTop 归零，让视口坐标可直接比较（排除 fill 自动滚动的噪声）。
  //    量三组：变脏字段自身（宽度/高度/位置）、其后策略卡区、更后的成员编排区。
  const rectsOf = () =>
    page.evaluate(() => {
      const rect = (slot) => {
        const node = document.querySelector('[data-slot="' + slot + '"]');
        const box = node.getBoundingClientRect();
        return { x: box.x, y: box.y, w: box.width, h: box.height };
      };
      return { note: rect("field-note"), strategy: rect("strategy-cards"), board: rect("member-board-grid") };
    });
  const scrollMainTop = () =>
    page.evaluate(() => {
      const main = document.querySelector("main");
      if (main) main.scrollTop = 0;
    });
  await scrollMainTop();
  await page.waitForTimeout(150);
  const before = await rectsOf();
  await page.getByLabel("备注", { exact: true }).fill("矩阵脏标记断言");
  await page.waitForTimeout(300);
  await scrollMainTop();
  await page.waitForTimeout(150);
  const after = await rectsOf();
  const slotAbsolute = await page.evaluate(() => {
    const marker = document.querySelector('[data-slot="dirty-marker"]');
    return marker ? getComputedStyle(marker).position : "missing";
  });
  assert(slotAbsolute === "absolute", "脏标记槽不是绝对定位（position=" + slotAbsolute + "，会参与布局推挤）");
  const diff = (label, left, right) =>
    JSON.stringify(left) === JSON.stringify(right) ? "" : label + " " + JSON.stringify(left) + " → " + JSON.stringify(right) + "；";
  const shifts = diff("备注字段", before.note, after.note) + diff("策略卡区", before.strategy, after.strategy) + diff("成员编排区", before.board, after.board);
  assert(shifts === "", width + " 变脏后布局位移：" + shifts.trim());
  await shot(page, width + "-public-edit-dirty");

  // 6. 恢复按钮在字段固定操作槽：点击恢复备注原值且标记消失（data-dirty 在内层 dirty-field 上）。
  const reset = page.getByRole("button", { name: "恢复备注" });
  assert(await visible(reset), width + " 下备注字段缺少恢复按钮");
  await reset.click();
  await page.waitForTimeout(250);
  assert((await page.getByLabel("备注", { exact: true }).inputValue()) === "", "恢复备注后输入值未复原");
  const noteDirtyField = page.locator('[data-slot="field-note"] [data-slot="dirty-field"]');
  assert((await noteDirtyField.getAttribute("data-dirty")) === "false", "恢复后脏标记未清除");
  await shot(page, width + "-public-edit");
  return "保存入口可见 " + Math.round(saveBox.y) + "px，变脏零位移（字段/策略区/成员区逐像素一致），恢复入口可用";
}

/* W6 ticket 14：公开模型保存与错误回滚回归（1536 一次）——
 * 先拦截 PATCH 返回 500：表单值与脏标记必须保留、内联错误可见；
 * 解除拦截后走一次真保存：脏标记清零、服务端名称更新（ticket 12 单 PATCH 契约）。 */
async function assertPublicModelSaveRollback(page, fixtures) {
  await ensureModelsSeeded(page, fixtures);
  await goto(page, "/models/public/" + fixtures.publicModelId);
  await page.locator('[data-slot="public-model-page"]').waitFor({ state: "visible", timeout: 8000 });
  const saveBtn = page.locator('[data-slot="header-save"]').getByRole("button", { name: "保存" }).first();

  await page.route(/\/admin\/public-models\/[^/]+$/, (route) => {
    if (route.request().method() === "PATCH") {
      void route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ code: "INTERNAL_ERROR", message: "矩阵模拟保存失败", request_id: "matrix" }),
      });
    } else {
      void route.continue();
    }
  });
  await page.getByLabel("备注", { exact: true }).fill("矩阵回滚回归");
  await saveBtn.click();
  await page.locator('[data-slot="save-error"]').waitFor({ state: "visible", timeout: 8000 });
  assert((await page.getByLabel("备注", { exact: true }).inputValue()) === "矩阵回滚回归", "保存失败后备注输入被清空（回滚契约破坏）");
  const noteDirtyField = page.locator('[data-slot="field-note"] [data-slot="dirty-field"]');
  assert((await noteDirtyField.getAttribute("data-dirty")) === "true", "保存失败后脏标记丢失");
  await page.unroute(/\/admin\/public-models\/[^/]+$/);

  await page.getByRole("button", { name: "恢复备注" }).click();
  const unique = "矩阵公开模型改名" + Date.now().toString(36);
  await page.getByLabel("名称", { exact: true }).fill(unique);
  await saveBtn.click();
  const nameDirtyField = page.locator('[data-slot="field-name"] [data-slot="dirty-field"]');
  await page.waitForFunction(
    () => document.querySelector('[data-slot="field-name"] [data-slot="dirty-field"]')?.getAttribute("data-dirty") === "false",
    { timeout: 10_000 },
  ).catch(() => {});
  assert(
    (await nameDirtyField.getAttribute("data-dirty")) === "false",
    "保存成功后脏标记未清零（保存失败或响应未回填 baseline）",
  );
  const listed = await (await page.request.get(baseUrl() + "/admin/public-models")).json();
  // 列表端点返回裸数组（routers_models.list_public_models -> list[dict]），兼容 {items} 形状。
  const savedNames = (Array.isArray(listed) ? listed : listed.items ?? []).map((item) => item.name);
  assert(
    savedNames.includes(unique),
    "保存后服务端名称未更新（单 PATCH 未生效）",
  );
  await shot(page, "1536-public-edit-saved");
  return "500 拦截：错误内联+值/脏标记保留；解除后真保存：脏清零+服务端已更新";
}

/* W6 ticket 17：分流图播种——矩阵站点没有 relay 流量，直接向隔离 SQLite 写
 * usage/charge 行（与 api/tests/integration/test_reports_flow_focus.py 同一張
 * 路径表），让分流图有确定性的 9 节点闭包可供搜索断言。 */
let flowSeeded = false;
async function ensureFlowSeeded(page, fixtures) {
  if (flowSeeded) return;
  flowSeeded = true;
  void fixtures;
  const serverDir = path.join(OUT, "server");
  const databaseFile = path.join(serverDir, "matrix.db").replace(/\\/g, "/");
  const script = path.join(OUT, "seed-flow-events.py");
  fs.writeFileSync(
    script,
    [
      "import sys, time",
      "from sqlalchemy import create_engine",
      "from sqlalchemy.orm import sessionmaker",
      "from l04_repo.orm import ChargeEntryORM, GatewayUsageEventORM, UserORM",
      "",
      'engine = create_engine("sqlite:///" + sys.argv[1])',
      "Session = sessionmaker(bind=engine, future=True)",
      "now = int(time.time() * 1000)",
      'USERS = [("usr_mflow_a", "流甲"), ("usr_mflow_b", "流乙"), ("usr_mflow_c", "流丙")]',
      "PATHS = [",
      '    ("usr_mflow_a", "matrixflow公开甲", "matrixflow上游A", "matrixflow渠道X"),',
      '    ("usr_mflow_a", "matrixflow公开甲", "matrixflow上游B", "matrixflow渠道Y"),',
      '    ("usr_mflow_b", "matrixflow公开甲", "matrixflow上游A", "matrixflow渠道Y"),',
      '    ("usr_mflow_b", "matrixflow公开乙", "matrixflow上游A", "matrixflow渠道X"),',
      '    ("usr_mflow_c", "matrixflow公开乙", "matrixflow上游B", "matrixflow渠道X"),',
      '    ("usr_mflow_c", "matrixflow公开丙", "matrixflow上游A", "matrixflow渠道X"),',
      '    ("usr_mflow_a", "matrixflow公开乙", "matrixflow上游A", "matrixflow渠道Y"),',
      '    ("usr_mflow_b", "matrixflow公开丙", "matrixflow上游B", "matrixflow渠道Y"),',
      '    ("usr_mflow_a", "matrixflow公开丙", "matrixflow上游B", "matrixflow渠道X"),',
      "]",
      "with Session() as session:",
      '    if session.get(GatewayUsageEventORM, "evt_mflow_0") is not None:',
      '        print("already")',
      "        raise SystemExit(0)",
      "    for user_id, name in USERS:",
      "        if session.get(UserORM, user_id) is None:",
      "            session.add(UserORM(id=user_id, name=name, balance_micro=0, created_at_ms=now))",
      "    for index, (user_id, public_model, upstream_model, provider) in enumerate(PATHS):",
      "        at = now - 3_600_000 * (index + 1)",
      '        event_id = "evt_mflow_%d" % index',
      "        session.add(GatewayUsageEventORM(",
      "            event_id=event_id,",
      "            started_at_ms=at,",
      "            completed_at_ms=at + 1000,",
      "            duration_ms=1000,",
      "            time_to_first_token_ms=100,",
      "            http_status=200,",
      "            public_model=public_model,",
      "            upstream_model=upstream_model,",
      "            provider=provider,",
      "            input_tokens=10,",
      "            output_tokens=5,",
      "            total_tokens=15,",
      "        ))",
      "        session.add(ChargeEntryORM(",
      '            id="ce_" + event_id,',
      "            gateway_event_id=event_id,",
      "            user_id=user_id,",
      "            amount_micro=1000,",
      '            currency="CNY",',
      '            status="ok",',
      "            created_at_ms=at,",
      "        ))",
      "    session.commit()",
      'print("seeded")',
      "",
    ].join("\n"),
  );
  const python = pythonExecutable();
  const result = spawnSync(python, [script, databaseFile], {
    encoding: "utf8",
    env: { ...process.env, PYTHONPATH: path.join(API_ROOT, "src") },
    windowsHide: true,
  });
  if (result.status !== 0) {
    throw new MatrixError("分流播种失败：" + (result.stderr || result.stdout || "").slice(0, 400));
  }
}

/* W6 ticket 17：分流搜索专项——页头入口、无独立请求链路面板、无「已隐藏」芯片块、
 * 隐藏阶段卡片高度稳定、阶段轴在右/搜索在左（窄屏堆叠）、搜索高亮链路计数、
 * 仅显示链路、清除恢复全图。期望计数来自上方播种的 9 条路径（确定性）。 */
async function assertFlowSearch(page, width, fixtures) {
  await ensureFlowSeeded(page, fixtures);
  await goto(page, "/dashboard");
  // 1. 看板不再有独立「请求链路」面板；「查看分流」入口移到页头仍可达。
  assert((await page.getByText("请求链路", { exact: true }).count()) === 0, "看板仍渲染独立请求链路面板");
  const entry = page.getByRole("button", { name: "查看分流" });
  assert(await visible(entry), width + " 页头缺少「查看分流」入口");
  await entry.click();
  const canvas = page.locator('[role="img"][aria-label*="桑基"]');
  await canvas.waitFor({ state: "visible", timeout: 10_000 });
  await page.waitForTimeout(700);

  // 2. 无「已隐藏」芯片块；阶段轴在右（≥lg）/堆叠在画布下（<lg），搜索在左。
  assert((await page.getByText("已隐藏：", { exact: true }).count()) === 0, "「已隐藏」芯片块仍存在");
  const search = page.locator('[data-slot="flow-search-input"]');
  const axis = page.locator('[data-slot="flow-stage-axis"]');
  assert(await visible(search), width + " 分流搜索框不可见");
  assert(await visible(axis), width + " 分流阶段轴不可见");
  const searchBox = await boxOf(search);
  const axisBox = await boxOf(axis);
  const canvasBox = await boxOf(canvas);
  if (width >= 1024) {
    assert(searchBox.x < canvasBox.x + 2, width + " 搜索框不在画布左上（轴右搜索左）");
    assert(axisBox.x >= canvasBox.x + canvasBox.width - 1, width + " 阶段轴不在画布右侧");
  } else {
    assert(axisBox.y >= canvasBox.y + canvasBox.height - 1, width + " 窄屏阶段轴未堆叠在画布下方");
    assert(searchBox.y <= canvasBox.y, width + " 窄屏搜索框不在画布上方");
  }

  // 3. 高度稳定：隐藏一个阶段前后，趋势卡片高度不变（芯片块已删，W5 跳动源）。
  const trendCard = page.locator('[data-slot="card"]').filter({ hasText: "用量趋势" }).first();
  const cardHeight = async () => (await boxOf(trendCard)).height;
  await page.waitForTimeout(300);
  const heightBefore = await cardHeight();
  await axis.getByRole("button", { name: "公开模型" }).click();
  await page.waitForTimeout(1_200);
  const heightAfter = await cardHeight();
  assert(Math.abs(heightAfter - heightBefore) <= 1, width + " 隐藏阶段后卡片高度跳动：" + heightBefore + " → " + heightAfter);
  assert((await page.getByText("已隐藏：", { exact: true }).count()) === 0, width + " 隐藏后出现「已隐藏」芯片块");
  await axis.getByRole("button", { name: "公开模型" }).click();
  await page.waitForTimeout(900);

  // 4. 搜索高亮：命中 1（公开甲），闭包 = 3 用户 + key + 上游A/B + 渠道X/Y。
  await search.fill("公开甲");
  const status = page.locator('[data-slot="flow-search-status"]');
  await page.waitForTimeout(400);
  const highlightText = (await status.innerText()).trim();
  assert(
    highlightText === "命中 1 · 链路 9 节点 / 10 边",
    width + " 搜索高亮状态不符（期望 命中 1 · 链路 9 节点 / 10 边）：" + highlightText,
  );

  // 5. 仅显示搜索目标：只保留该链；清除后恢复全图。
  const onlyToggle = page.getByRole("switch", { name: "仅显示搜索目标" });
  assert(await visible(onlyToggle), width + " 缺少「仅显示搜索目标」开关");
  await onlyToggle.click();
  await page.waitForTimeout(500);
  const onlyText = (await status.innerText()).trim();
  assert(
    onlyText === "仅显示链路：9 节点 / 10 边",
    width + " 仅显示链状态不符：" + onlyText,
  );
  await search.fill("");
  await page.waitForTimeout(500);
  const clearedText = (await status.innerText()).trim();
  assert(clearedText === "", width + " 清除搜索后未恢复全图（状态残留）：" + clearedText);
  assert(!(await onlyToggle.isEnabled()), width + " 清除搜索后「仅显示」开关应禁用");
  await shot(page, width + "-flow-search");
  return "轴右搜索左（" + Math.round(axisBox.x - canvasBox.x) + "px）· 高度 " + Math.round(heightBefore) + "→" + Math.round(heightAfter) + " 稳定 · 搜索高亮 9/10 · 仅显示链 · 清除恢复";
}

/* W6 ticket 15：成员编排专项——左6右6行内编辑（行内字段随策略收敛）、行内编辑变脏
 * 页头计数联动、候选按上游分组 chip 搜索固定滚动区外、加入成员走 chip。
 * 375 只验堆叠 + chip 加入 + 搜索；1536 全量并含大列表预算（300 候选时页面高度有界）。
 * 跑在 public-edit / regression 之后；结束恢复全部，保证页面零脏态不影响后续测试。 */
const MEMBER_CHIP_BUDGET = 120;
async function assertMemberBoard(page, width, fixtures) {
  await ensureModelsSeeded(page, fixtures);
  await goto(page, "/models/public/" + fixtures.publicModelId);
  await page.locator('[data-slot="public-model-page"]').waitFor({ state: "visible", timeout: 8000 });
  const boardLeft = page.locator('[data-slot="member-board-left"]');
  const boardRight = page.locator('[data-slot="member-board-right"]');
  const leftBox = await boxOf(boardLeft);
  const rightBox = await boxOf(boardRight);
  if (width >= 1024) {
    assert(
      Math.abs(leftBox.y - rightBox.y) < 2 && rightBox.x >= leftBox.x + leftBox.width - 2,
      width + " 下成员编排不是左右两栏（左6右6）",
    );
  } else {
    assert(rightBox.y >= leftBox.y + leftBox.height - 2, width + " 下成员编排两栏未上下堆叠");
  }

  // 搜索框固定滚动区外：DOM 上不得是 member-scroll 的后代（列头槽位）。
  const searchOutside = await page.evaluate(() => {
    const input = document.querySelector('[data-slot="member-board-right"] input[aria-label="搜索上游渠道或模型"]');
    const scroll = document.querySelector('[data-slot="member-board-right"] [data-slot="member-scroll"]');
    return Boolean(input && scroll && !scroll.contains(input));
  });
  assert(searchOutside, "候选搜索框必须在 member-scroll 之外（固定列头）");

  const rows = page.locator('[data-slot="member-board-left"] [data-slot="member-row"]');
  const hasInput = async (label) =>
    (await page.locator('[data-slot="member-board-left"] [data-slot="member-row"] input[aria-label="' + label + '"]').count()) > 0;
  assert((await rows.count()) === 1, "播种场景应恰好一行成员，实际 " + (await rows.count()));
  assert(await hasInput("priority"), "failover 行内必须有 priority 输入");
  assert(!(await hasInput("weight")) && !(await hasInput("when")), "failover 行不得渲染 weight/when 输入");

  // 行内字段随策略收敛（1536 桌面）：切策略卡后字段集合跟着变，非当前策略字段完全不渲染。
  if (width >= 1024) {
    await page.locator('[data-slot="strategy-card"]', { hasText: "weighted" }).first().click();
    await page.waitForTimeout(200);
    assert(await hasInput("weight"), "weighted 行内必须有 weight 输入");
    assert(!(await hasInput("when")), "weighted 行不得渲染 when 输入");
    await page.locator('[data-slot="strategy-card"]', { hasText: "conditional" }).first().click();
    await page.waitForTimeout(200);
    assert(await hasInput("when"), "conditional 行内必须有 when 输入");
    assert(!(await hasInput("weight")), "conditional 行不得渲染 weight 输入");
    assert(await visible(page.locator('[data-slot="chip-order"]').first()), "conditional 行应有顺序徽标");
    await page.locator('[data-slot="strategy-card"]', { hasText: "failover" }).first().click();
    await page.waitForTimeout(200);
  }

  // 行内编辑变脏 → 页头未保存计数联动；恢复成员编排后计数清零、值回基线。
  const dirtyCount = page.locator('[data-slot="dirty-count"]');
  assert((await dirtyCount.count()) === 0, "行内编辑前不应有未保存计数徽章");
  const priorityInput = rows.first().locator('input[aria-label="priority"]');
  await priorityInput.fill("3");
  await page.waitForTimeout(250);
  assert(await dirtyCount.isVisible(), "行内编辑后页头应出现未保存计数");
  const countText = (await dirtyCount.textContent()) ?? "";
  assert(countText.includes("1 项未保存"), "未保存计数应显示 1 项，实际「" + countText.trim() + "」");
  await page.getByRole("button", { name: "恢复成员编排" }).click();
  await page.waitForTimeout(250);
  assert((await dirtyCount.count()) === 0, "恢复成员编排后计数徽章应消失");
  assert((await priorityInput.inputValue()) === "1", "恢复后 priority 应回基线值");

  // 加入成员走 chip：点未选中的候选 chip → 左栏新增一行 + 计数联动；
  // W7 票05 起候选原地灰显不消失，所以必须点 data-selected="false" 的 chip。
  const candidateChip = page.locator('[data-slot="member-candidate-chip"][data-selected="false"]').first();
  assert(await visible(candidateChip), "候选区应有未加入成员的 chip");
  const joinedId = await candidateChip.getAttribute("data-upstream-model-id");
  const beforeRows = await rows.count();
  await candidateChip.click();
  await page.waitForTimeout(250);
  assert((await rows.count()) === beforeRows + 1, "点候选 chip 后左栏应新增一行成员");
  assert(await dirtyCount.isVisible(), "加入成员后应有未保存计数");

  // 搜索过滤：无命中时候选清空，命中时只留匹配 chip；搜索框始终在滚动区外。
  const search = page.locator('[data-slot="member-board-right"] input[aria-label="搜索上游渠道或模型"]');
  await search.fill("matrix-no-such-model");
  await page.waitForTimeout(200);
  assert((await page.locator('[data-slot="member-candidate-chip"]').count()) === 0, "搜索无命中时候选 chip 应清空");
  await search.fill("closed");
  await page.waitForTimeout(200);
  assert((await page.locator('[data-slot="member-candidate-chip"]').count()) === 1, "按模型名搜索应只留命中 chip");
  assert(
    await page.evaluate(() => {
      const input = document.querySelector('[data-slot="member-board-right"] input[aria-label="搜索上游渠道或模型"]');
      const scroll = document.querySelector('[data-slot="member-board-right"] [data-slot="member-scroll"]');
      return Boolean(input && scroll && !scroll.contains(input));
    }),
    "搜索后候选搜索框必须仍固定在滚动区外",
  );
  await search.fill("");

  // 清理加入的成员：按上游模型 id 精确移除，回到基线（后续测试依赖零脏态）。
  await page.locator('[data-slot="member-row"][data-upstream-model-id="' + joinedId + '"] [data-slot="member-row-remove"]').click();
  await page.waitForTimeout(250);
  assert((await rows.count()) === beforeRows, "移除新成员后应回到基线行数");

  // 大列表预算（1536 一次）：临时播种 300 个候选模型，页面不被无限拉长、chip 有预算截断与展开。
  if (width >= 1024) {
    for (let index = 0; index < 300; index += 1) {
      const response = await page.request.post(baseUrl() + "/admin/upstream-models", {
        data: { upstream_id: fixtures.upstreamId, name: "matrixbulk" + String(index).padStart(3, "0") + "-bulk", model_type: "chat", enabled: true },
      });
      if (!response.ok()) throw new MatrixError("批量播种候选失败 HTTP " + response.status());
    }
    await goto(page, "/models/public/" + fixtures.publicModelId);
    await page.locator('[data-slot="member-board-left"]').waitFor({ state: "visible", timeout: 8000 });
    const heights = await page.evaluate(() => {
      const scroll = document.querySelector('[data-slot="member-board-right"] [data-slot="member-scroll"]');
      return {
        doc: document.documentElement.scrollHeight,
        scrollH: scroll ? scroll.getBoundingClientRect().height : 0,
        scrollCap: scroll ? Math.min(window.innerHeight * 0.6, 560) : 0,
      };
    });
    assert(heights.scrollCap > 0 && heights.scrollH <= heights.scrollCap + 2, "候选滚动区高度必须被 min(60vh,560px) 约束，实际 " + Math.round(heights.scrollH) + "px > " + Math.round(heights.scrollCap) + "px");
    assert(heights.doc < 8000, "大列表下页面不得被无限拉长，scrollHeight=" + heights.doc);
    const chipCount = await page.locator('[data-slot="member-candidate-chip"]').count();
    assert(chipCount === MEMBER_CHIP_BUDGET, "候选 chip 必须按预算 " + MEMBER_CHIP_BUDGET + " 截断渲染，实际 " + chipCount);
    const expand = page.getByRole("button", { name: /展开全部/ });
    assert(await visible(expand), "截断时必须提供「展开全部」入口");
    await expand.click();
    await page.waitForTimeout(300);
    const afterExpand = await page.evaluate(() => ({
      chips: document.querySelectorAll('[data-slot="member-candidate-chip"]').length,
      scrollH: document.querySelector('[data-slot="member-board-right"] [data-slot="member-scroll"]')?.getBoundingClientRect().height ?? 0,
    }));
    assert(afterExpand.chips > MEMBER_CHIP_BUDGET, "展开全部后应渲染预算外候选，实际 " + afterExpand.chips);
    assert(afterExpand.scrollH <= heights.scrollCap + 2, "展开全部后候选滚动区仍受最大高度约束，实际 " + Math.round(afterExpand.scrollH) + "px");
  }

  // 收尾：恢复成员编排（若仍有脏态），保证零脏态离开页面。
  if ((await dirtyCount.count()) > 0) {
    await page.getByRole("button", { name: "恢复全部" }).click();
    await page.waitForTimeout(200);
  }
  assert((await dirtyCount.count()) === 0, "成员编排专项结束必须回到零脏态");
  await shot(page, width + "-member-board");
  return "行内字段随策略收敛、脏计数联动、chip 加入/移除往返、搜索固定" + (width >= 1024 ? "、大列表高度有界" : "");
}

/* W6 ticket 12：登录页专项——三态主题（复用全站 slipstream.theme 存储）、登录框三档
 * 宽度（384/460/576）、密码显隐、错误零位移（错误区固定 h-10 + 字段 aria-invalid +
 * 失败详情进通知中心）、667×375 横屏免滚可见提交按钮、成功/失败流程回归。
 * 全部跑在未登录的独立上下文里，不污染主矩阵的已登录会话。 */
async function openLoginContext(width, height) {
  const context = await browser.newContext({
    viewport: { width, height },
    baseURL: baseUrl(),
    locale: "zh-CN",
  });
  const loginPage = await context.newPage();
  loginPage.setDefaultTimeout(PLAYWRIGHT_TIMEOUT);
  await loginPage.goto(baseUrl() + "/login", { waitUntil: "domcontentloaded", timeout: 30_000 });
  await loginPage.waitForTimeout(400);
  return { context, loginPage };
}

async function assertLoginTheme(width, height) {
  const { context, loginPage } = await openLoginContext(width, height);
  try {
    const switcher = loginPage.locator('[data-slot="login-theme"]');
    assert(await visible(switcher), width + " 下登录页主题切换器不可见");
    for (const name of ["浅色", "深色", "跟随系统"]) {
      assert(await visible(loginPage.getByRole("button", { name, exact: true })), width + " 下主题选项不可见：" + name);
    }
    const stored = () => loginPage.evaluate(() => localStorage.getItem("slipstream.theme"));
    const isDark = () => loginPage.evaluate(() => document.documentElement.classList.contains("dark"));
    // 深色：显式选择立即生效并持久化（全站 slipstream.theme，不另起存储）。
    await loginPage.getByRole("button", { name: "深色", exact: true }).click();
    await loginPage.waitForTimeout(250);
    assert(await isDark(), width + " 下选深色后 html 未切 .dark");
    assert((await stored()) === "dark", width + " 下选深色后 slipstream.theme 未持久化为 dark");
    // 刷新后仍是深色：持久化生效（index.html 反闪烁脚本同源，刷新无白闪回退）。
    await loginPage.reload({ waitUntil: "domcontentloaded" });
    await loginPage.waitForTimeout(400);
    assert(await isDark(), width + " 下刷新后深色主题丢失（持久化失效）");
    assert(await visible(switcher), width + " 下刷新后主题切换器不可见");
    // 跟随系统：矩阵默认 prefers-color-scheme=light → 应回落浅色。
    await loginPage.getByRole("button", { name: "跟随系统", exact: true }).click();
    await loginPage.waitForTimeout(250);
    assert(!(await isDark()), width + " 下跟随系统应回落浅色（矩阵 prefers-color-scheme=light）");
    assert((await stored()) === "system", width + " 下跟随系统未持久化为 system");
    // 浅色：显式选择。
    await loginPage.getByRole("button", { name: "浅色", exact: true }).click();
    await loginPage.waitForTimeout(250);
    assert(!(await isDark()), width + " 下选浅色后 html 仍有 .dark");
    assert((await stored()) === "light", width + " 下选浅色未持久化为 light");
    await shot(loginPage, "login-theme-" + width);
    return "深色生效+持久化、刷新保持、跟随系统回落浅色、浅色生效（slipstream.theme 全站同源）";
  } finally {
    await context.close().catch(() => {});
  }
}

async function assertLoginWidths() {
  const cases = [
    { width: 640, height: 900, expect: 384, tier: "基础 384" },
    { width: 768, height: 1024, expect: 460, tier: "md 460" },
    { width: 1536, height: 864, expect: 576, tier: "2xl 576" },
  ];
  const measured = [];
  for (const item of cases) {
    const { context, loginPage } = await openLoginContext(item.width, item.height);
    try {
      const card = loginPage.locator('[data-slot="login-card"]');
      assert(await visible(card), item.width + " 下登录卡片不可见");
      const box = await boxOf(card);
      const actual = Math.round(box.width);
      measured.push(item.width + "→" + actual);
      assert(
        Math.abs(box.width - item.expect) <= 2,
        item.width + " 下登录框宽度 " + actual + "px ≠ " + item.tier + "px（user story 32 三档 384/460/576）",
      );
      await shot(loginPage, "login-width-" + item.width);
    } finally {
      await context.close().catch(() => {});
    }
  }
  return "三档实测 " + measured.join("、") + "（±2px）";
}

async function assertLoginPasswordToggle(width) {
  const { context, loginPage } = await openLoginContext(width, 667);
  try {
    const password = loginPage.locator("#login-password");
    const toggle = loginPage.locator('[data-slot="login-password-toggle"]');
    assert(await visible(toggle), width + " 下密码显隐按钮不可见");
    assert((await password.getAttribute("type")) === "password", "密码框默认必须隐藏");
    assert((await toggle.getAttribute("aria-pressed")) === "false", "显隐按钮初始 aria-pressed 必须是 false");
    await toggle.click();
    await loginPage.waitForTimeout(150);
    assert((await password.getAttribute("type")) === "text", "点击显隐按钮后密码必须可见（type=text）");
    assert((await toggle.getAttribute("aria-pressed")) === "true", "显示态 aria-pressed 必须是 true");
    assert((await toggle.getAttribute("aria-label")) === "隐藏密码", "显示态可访问名必须是「隐藏密码」");
    await toggle.click();
    await loginPage.waitForTimeout(150);
    assert((await password.getAttribute("type")) === "password", "再次点击后密码必须重新隐藏");
    assert((await toggle.getAttribute("aria-pressed")) === "false", "隐藏态 aria-pressed 必须回到 false");
    await shot(loginPage, "login-password-toggle-" + width);
    return "密码显示/隐藏往返可用，aria-pressed 与可访问名随状态切换";
  } finally {
    await context.close().catch(() => {});
  }
}

/** 错误零位移（照票 14 手法）：提交前后逐像素量按钮/错误区矩形；同时断言字段标红、
 * aria-invalid、详情进通知中心（slipstream.notifications.v1 是通知中心的唯一数据源）。 */
async function assertLoginErrorZeroShift(width, height) {
  const { context, loginPage } = await openLoginContext(width, height);
  try {
    const rectsOf = () =>
      loginPage.evaluate(() => {
        const rect = (node) => {
          if (!node) return null;
          const box = node.getBoundingClientRect();
          return { x: box.x, y: box.y, w: box.width, h: box.height };
        };
        const area = document.querySelector('[data-slot="login-error"]');
        const input = document.querySelector("#login-username");
        return {
          button: rect(document.querySelector('button[type="submit"]')),
          area: rect(area),
          areaHeight: area ? getComputedStyle(area).height : "",
          borderColor: input ? getComputedStyle(input).borderColor : "",
          ariaInvalid: input ? input.getAttribute("aria-invalid") : "",
        };
      });
    await loginPage.fill("#login-username", ADMIN_CRED.user);
    await loginPage.fill("#login-password", "matrix-wrong-password-" + Date.now().toString(36));
    await loginPage.waitForTimeout(150);
    const before = await rectsOf();
    assert(before.ariaInvalid !== "true", "提交前输入框不应已标红（aria-invalid 提前置位）");
    assert(Math.round(parseFloat(before.areaHeight)) === 40, "错误区固定高度应为 40px（h-10），实际 " + before.areaHeight);
    await loginPage.click('button[type="submit"]');
    await loginPage.locator('[data-slot="login-error"] p').first().waitFor({ state: "visible", timeout: 10_000 });
    await loginPage.waitForTimeout(300);
    const after = await rectsOf();
    assert(after.ariaInvalid === "true", "登录失败后用户名输入框必须 aria-invalid=true（user story 49）");
    const rgb = (after.borderColor.match(/\d+/g) ?? []).map(Number);
    assert(
      rgb.length >= 3 && rgb[0] > rgb[1] && rgb[0] > rgb[2] && after.borderColor !== before.borderColor,
      "出错字段边框必须是红色系且相对正常态有变化（正常 " + before.borderColor + " → 失败 " + after.borderColor + "）",
    );
    const shift = (label, left, right) =>
      JSON.stringify(left) === JSON.stringify(right) ? "" : label + " " + JSON.stringify(left) + " → " + JSON.stringify(right) + "；";
    const shifts = shift("提交按钮", before.button, after.button) + shift("错误区", before.area, after.area);
    assert(shifts === "", width + " 登录失败后布局位移（按钮必须零位移）：" + shifts.trim());
    assertInViewport(
      { x: after.button.x, y: after.button.y, width: after.button.w, height: after.button.h },
      width,
      height,
      "错误出现后的提交按钮",
    );
    const notifications = await loginPage.evaluate(() => JSON.parse(localStorage.getItem("slipstream.notifications.v1") || "[]"));
    const entry = notifications.find((item) => item.kind === "error" && item.title === "登录失败");
    assert(entry, "登录失败必须写入通知中心历史（slipstream.notifications.v1 缺「登录失败」条目）");
    const inlineError = (await loginPage.locator('[data-slot="login-error"] p').first().innerText()).trim();
    assert(
      typeof entry.description === "string" && entry.description.includes(inlineError),
      "通知中心详情必须包含内联错误全文（内联：「" + inlineError + "」）",
    );
    await shot(loginPage, "login-error-zero-shift-" + width);
    return "按钮/错误区逐像素零位移，错误区恒 40px，字段红色系边框+aria-invalid，详情进通知中心";
  } finally {
    await context.close().catch(() => {});
  }
}

async function assertLoginLandscapeSubmit() {
  const { context, loginPage } = await openLoginContext(667, 375);
  try {
    const submit = loginPage.locator('button[type="submit"]');
    assert(await visible(submit), "667×375 横屏提交按钮不可见");
    const box = await boxOf(submit);
    assertInViewport(box, 667, 375, "横屏提交按钮");
    await assertClickableAtCenter(loginPage, submit, "横屏提交按钮");
    await shot(loginPage, "login-landscape-667x375");
    return "提交按钮 y=" + Math.round(box.y) + "…" + Math.round(box.y + box.height) + " 免滚可见可点（user story 33）";
  } finally {
    await context.close().catch(() => {});
  }
}

async function assertLoginFlowRegression() {
  const { context, loginPage } = await openLoginContext(768, 1024);
  try {
    // 失败流程：内联错误可见（固定区文案），不推挤布局。
    await loginPage.fill("#login-username", ADMIN_CRED.user);
    await loginPage.fill("#login-password", "matrix-not-the-password");
    await loginPage.click('button[type="submit"]');
    const inline = loginPage.locator('[data-slot="login-error"] p').first();
    await inline.waitFor({ state: "visible", timeout: 10_000 });
    assert((await inline.innerText()).trim().length > 0, "登录失败必须显示内联错误文案");
    // 成功流程：正确凭据后离开 /login 进入控制台。
    await loginPage.fill("#login-username", ADMIN_CRED.user);
    await loginPage.fill("#login-password", ADMIN_CRED.pass);
    await loginPage.click('button[type="submit"]');
    const deadline = Date.now() + 45_000;
    while (Date.now() < deadline) {
      if (!new URL(loginPage.url()).pathname.startsWith("/login")) break;
      await loginPage.waitForTimeout(200);
    }
    const landed = new URL(loginPage.url()).pathname;
    assert(!landed.startsWith("/login"), "登录成功后未离开 /login（超时）");
    await shot(loginPage, "login-flow-success");
    return "失败路径内联错误可见；成功路径进入控制台（" + landed + "）";
  } finally {
    await context.close().catch(() => {});
  }
}

async function assertCoarsePointer(page) {
  // 复用已登录 cookies，在独立的移动+触摸上下文里测，避免影响主矩阵的桌面指针环境。
  const storageState = await page.context().storageState();
  const touchContext = await browser.newContext({
    viewport: { width: 375, height: 667 },
    baseURL: baseUrl(),
    locale: "zh-CN",
    hasTouch: true,
    isMobile: true,
    storageState,
  });
  const touchPage = await touchContext.newPage();
  touchPage.setDefaultTimeout(PLAYWRIGHT_TIMEOUT);
  try {
    // hasTouch/isMobile 之外再用 CDP 明确覆盖 pointer 媒体特性（Blink 支持该特性名）。
    try {
      const cdp = await touchContext.newCDPSession(touchPage);
      await cdp.send("Emulation.setEmulatedMedia", {
        media: "screen",
        features: [{ name: "pointer", value: "coarse" }],
      });
    } catch {
      // 旧版 Chromium 不支持 features 时，hasTouch/isMobile 仍可能已给出 coarse。
    }
    await goto(touchPage, "/users");
    const metrics = await touchPage.evaluate(() => {
      const button = Array.from(document.querySelectorAll("main button")).find((node) => {
        const rect = node.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0 && getComputedStyle(node).visibility !== "hidden";
      });
      const cell = document.querySelector("main tbody td");
      const coarse = matchMedia("(pointer: coarse)").matches;
      return {
        coarse,
        button: button ? { width: button.getBoundingClientRect().width, height: button.getBoundingClientRect().height } : null,
        cell: cell ? cell.getBoundingClientRect().height : 0,
      };
    });
    assert(metrics.coarse, "hasTouch/isMobile + CDP 均未能模拟 (pointer: coarse)，触控断言无法生效");
    assert(metrics.button !== null, "用户页没有可测量按钮");
    assert(metrics.button.height >= 43.5, "粗指针按钮高度 <44px：" + metrics.button.height);
    assert(metrics.button.width >= 43.5, "粗指针按钮宽度 <44px：" + metrics.button.width);
    assert(metrics.cell >= 39.5, "粗指针表格行高 <40px：" + metrics.cell);
    await shot(touchPage, "375-coarse-pointer");
    return "粗指针按钮 " + Math.round(metrics.button.width) + "×" + Math.round(metrics.button.height) + "，行高 " + Math.round(metrics.cell);
  } finally {
    await touchContext.close().catch(() => {});
  }
}

/* ------------------------------------------------------------------ *
 * 3. 主流程
 * ------------------------------------------------------------------ */

function assertIsolationPort(url) {
  let parsed = null;
  try {
    parsed = new URL(url);
  } catch {
    throw new MatrixError("--base-url 不是合法 URL：" + url);
  }
  const port = parsed.port || (parsed.protocol === "https:" ? "443" : "80");
  if (port === "3700" || port === "3600") {
    throw new MatrixError("拒绝使用 3700/3600 运行矩阵：请用隔离端口（如 3777）或另起隔离站点");
  }
}

async function main() {
  assertIsolationPort(baseUrl());
  console.log("W6 响应式矩阵：" + baseUrl() + " → " + rel(OUT));
  const staticResult = staticAudit();
  await test("static.breakpoints", "静态断点审计（仅 Tailwind 默认断点、无裸 min/max）", () => {
    assert(staticResult.violations.length === 0, "发现断点违规：\n" + staticResult.violations.join("\n"));
    return "src 下无 --breakpoint-* 自定义 token、无 min-[…]/max-[…] 裸断点";
  });
  await test("static.tokens", "响应式容器 token 就位（chart 240/320/360 + table）", () => {
    assert(staticResult.missing.length === 0, "缺少响应式容器 token：\n" + staticResult.missing.join("\n"));
    return "chart 15rem(240)/20rem(320)/22.5rem(360) + chart-frame + table-responsive";
  });

  if (BASE_URL_FLAG) {
    console.log("使用外部站点：" + BASE_URL_FLAG + "（不启动隔离服务）");
  } else {
    console.log("启动隔离站点 127.0.0.1:" + PORT + "（临时 SQLite，不触碰 3700/3600）…");
    await startIsolatedServer();
    console.log("隔离站点就绪：" + baseUrl());
  }

  const playwright = await loadPlaywright();
  if (!playwright) {
    throw new MatrixError("找不到 playwright / playwright-core；先在 web 包安装依赖");
  }
  const launched = await launchBrowser(playwright, { channel: CHANNEL, headed: HEADED });
  browser = launched.browser;
  console.log("浏览器：" + JSON.stringify(launched.options));

  // 登录页：每个视口独立（未登录）上下文。
  for (const viewport of VIEWPORTS) {
    await test("login." + viewport.label, viewport.label + " 登录页提交按钮可见", async () => {
      const context = await browser.newContext({
        viewport: { width: viewport.width, height: viewport.height },
        baseURL: baseUrl(),
        locale: "zh-CN",
      });
      const page = await context.newPage();
      page.setDefaultTimeout(PLAYWRIGHT_TIMEOUT);
      try {
        // 登录页没有 main 容器，不走 settle 的 main 等待。
        await page.goto(baseUrl() + "/login", { waitUntil: "domcontentloaded", timeout: 30_000 });
        await page.waitForTimeout(500);
        const submit = page.locator('button[type="submit"]');
        assert(await visible(submit), viewport.label + " 登录页提交按钮不可见");
        const box = await boxOf(submit);
        assertInViewport(box, viewport.width, viewport.height, "登录页提交按钮");
        const doc = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth }));
        assert(doc.scrollWidth <= doc.innerWidth + 1, viewport.label + " 登录页水平溢出：" + doc.scrollWidth + " > " + doc.innerWidth);
        await shot(page, viewport.label + "-login");
        return "提交按钮 y=" + Math.round(box.y) + " … " + Math.round(box.y + box.height) + "（视口高 " + viewport.height + "）";
      } finally {
        await context.close();
      }
    });
  }

  // W6 ticket 12：登录页专项（未登录独立上下文，不污染主矩阵会话）。
  await test("login.theme.375", "375 登录页三态主题切换与持久化", () => assertLoginTheme(375, 667));
  await test("login.theme.667x375", "667×375 横屏登录页三态主题切换可见", () => assertLoginTheme(667, 375));
  await test("login.theme.768", "768 登录页三态主题切换与持久化", () => assertLoginTheme(768, 1024));
  await test("login.theme.1536", "1536 登录页三态主题切换与持久化", () => assertLoginTheme(1536, 864));
  await test("login.widths", "登录框三档宽度 384/460/576（640/768/1536 实测）", () => assertLoginWidths());
  await test("login.password-toggle", "375 登录页密码显隐切换与 aria-pressed", () => assertLoginPasswordToggle(375));
  await test("login.error-zero-shift", "375 登录失败错误区固定、按钮零位移、字段标红、详情进通知中心", () =>
    assertLoginErrorZeroShift(375, 667));
  await test("login.landscape", "667×375 横屏提交按钮免滚可见可点", () => assertLoginLandscapeSubmit());
  await test("login.flow.regression", "登录成功与失败流程回归", () => assertLoginFlowRegression());

  // 登录一次，后续只改视口；cookie 与 localStorage 在同一上下文内保持。
  const context = await browser.newContext({
    viewport: { width: VIEWPORTS[0].width, height: VIEWPORTS[0].height },
    baseURL: baseUrl(),
    locale: "zh-CN",
  });
  // W6 ticket 13：给通知中心播种一条确定性通知（store 启动时读 localStorage）。
  // 必须在 newPage 之前注册，init script 才作用于本上下文的每个导航。
  await context.addInitScript(() => {
    localStorage.setItem(
      "slipstream.notifications.v1",
      JSON.stringify([{
        id: "matrix-notification-1",
        kind: "warning",
        title: "矩阵通知：上游渠道 glm-5.3 连接超时的超长标题用于验证标题单行省略与行尾时间不被挤压换行",
        description: "矩阵通知正文：INTERNAL_ERROR 上游渠道连接超时，这段超长正文用于验证 375 视口下单行省略且 hover 可读完整详情，包含足够的字符让标题与正文都触发截断。",
        at: Date.now(),
        read: true,
      }]),
    );
  });
  const page = await context.newPage();
  page.setDefaultTimeout(PLAYWRIGHT_TIMEOUT);
  const consoleErrors = [];
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    const text = message.text();
    if (text.includes("Download the React DevTools") || text.includes("ResizeObserver loop")) return;
    if (text.includes("401") || text.includes("Unauthorized")) return;
    // 网络层资源消息不算 console 回归：错误治理（ticket 07）把 5xx 呈现为页面内联
    // 错误/通知中心，public-edit.regression 会真实触发一次模拟 500（与上方 401 排除同因）。
    if (/Failed to load resource/.test(text) && /status of 5\d\d/.test(text)) return;
    consoleErrors.push(text);
  });
  page.on("pageerror", (error) => consoleErrors.push("pageerror: " + String(error)));
  let fixtures = null;
  try {
    await login(page);
    fixtures = await seedFixtures(page);
    console.log("测试数据：user=" + fixtures.username + " upstream=" + fixtures.upstreamName);

    for (const viewport of VIEWPORTS) {
      const { label, width, height } = viewport;
      await page.setViewportSize({ width, height });
      await test("shell." + label, label + " 侧栏开合与主内容宽度", async () => {
        await goto(page, "/users");
        await assertSidebar(page, width, height);
        return width < 1024
          ? "汉堡开合正常，主内容 " + width + "px 不被常驻侧栏挤压"
          : "桌面侧栏常驻且 248↔72 折叠正常";
      });
      await test("topbar." + label, label + " 顶栏主题/通知/刷新/用户菜单可见可点", async () => {
        await goto(page, "/users");
        await assertTopbarCluster(page, width);
        return "四项操作均可见并完成一次真实点击";
      });
      await test("table." + label, label + " 表格横滚 + 冻结操作列可达", async () => {
        return await assertTable(page, width, height, fixtures);
      });
      await test("dialog." + label, label + " 弹窗不超出视口且内容可滚", async () => {
        return await assertDialog(page, width, height);
      });
      if (width === 375) {
        await test("dialog.375x400", "375×400 短视口弹窗可滚、不裁提交区", () => assertShortViewportDialog(page));
        await test("touch.375", "375 粗指针触控目标 ≥44px、行高 ≥40px", () => assertCoarsePointer(page));
        // W6 ticket 13：通知中心窄屏专项（占满可用宽度 + 时间行尾 + 单行省略 + hover 详情 + 清空可点）。
        await test("notification.375", "375 通知中心窄屏可操作与紧凑行布局", () => assertNotificationCenterNarrow(page));
      }
      if (width === 375 || width === 768) {
        await test("drawer." + label, label + " 上游模型抽屉不超出视口且内容可滚", () => assertDrawer(page, width, height));
        // W6 ticket 10：模型管理两张表的表格专项（横滚 + 冻结操作列 + 贴边 + 关闭置尾）。
        await test("models-table.upstream." + label, label + " 上游模型表横滚 + 操作列贴边可操作 + 关闭行置尾", () =>
          assertModelsTable(page, width, fixtures, "upstream"));
        await test("models-table.public." + label, label + " 公开模型表横滚 + 操作列贴边可操作", () =>
          assertModelsTable(page, width, fixtures, "public"));
        // W6 ticket 11：全站其余数据表的表格专项（横滚 + 冻结操作列 + 贴边 + 关闭置尾 + 显式排序尊重排序）。
        await test("rollout-table.client-keys." + label, label + " 连接密钥表横滚 + 贴边 + 关闭行置尾 + 显式排序尊重排序", () =>
          assertClientKeysRollout(page, width, fixtures));
        await test("rollout-table.upstreams." + label, label + " 上游渠道表横滚 + 贴边 + 关闭行置尾", () =>
          assertRolloutTable(page, width, fixtures, {
            key: "upstreams", path: "/upstreams", label: "上游渠道表", actionButton: "编辑",
            rowText: fixtures.rollout?.openUpstreamName,
            openRowText: fixtures.rollout?.openUpstreamName,
            closedRowText: fixtures.rollout?.closedUpstreamName,
          }));
        await test("rollout-table.users." + label, label + " 用户表列表视图关闭行置尾 + 贴边", () =>
          assertUsersRollout(page, width, fixtures));
        await test("rollout-table.logs." + label, label + " 日志表排序三态图标 + 横滚容器", () =>
          assertLogsRollout(page, width, fixtures));
        await test("rollout-table.audits." + label, label + " 审计表横滚 + 冻结操作列贴边", () =>
          assertRolloutTable(page, width, fixtures, {
            key: "audits", path: "/audits", label: "审计表", actionButton: "详情", rowText: "admin",
          }));
        await test("rollout-table.roles." + label, label + " 角色表横滚 + 冻结操作列贴边", () =>
          assertRolloutTable(page, width, fixtures, {
            key: "roles", path: "/roles", label: "角色表", actionButton: "查看权限",
            // 角色行内容窄，768 下本就放得下：只要求容器可横滚，不强制溢出。
            expectOverflow: false,
          }));
        await test("rollout-table.pricing." + label, label + " 价目表横滚 + 操作列贴边", () =>
          assertRolloutTable(page, width, fixtures, {
            key: "pricing", path: "/pricing", label: "价目表", actionButton: null,
            rowText: fixtures.upstreamModelName, seedModels: true,
          }));
        await test("rollout-table.config-revisions." + label, label + " 配置版本表横滚 + 冻结操作列贴边", () =>
          assertRolloutTable(page, width, fixtures, {
            key: "config-revisions", path: "/config-revisions", label: "配置版本表", actionButton: "详情",
            // 版本行内容窄：只要求容器可横滚；有行时验冻结/贴边，空表只验容器。
            expectOverflow: false,
          }));
      }
      // W6 ticket 14：公开模型编辑页专项（375/768 堆叠 + 保存入口可见；1536 桌面紧凑布局
      // + 变脏零位移）；保存/错误回滚回归只在 1536 跑一次（改名不回滚 fixtures，视口档末尾）。
      if (width === 375 || width === 768 || width === 1536) {
        await test("public-edit." + label, label + " 公开模型编辑页紧凑布局与脏标记零位移", () =>
          assertPublicModelEdit(page, width, fixtures));
        if (width === 1536) {
          await test("public-edit.regression", "公开模型保存与错误回滚回归（页头保存）", () =>
            assertPublicModelSaveRollback(page, fixtures));
        }
        // W6 ticket 15：成员编排专项——1536 全量行内编辑 + 大列表预算；375 堆叠 + chip 加入。
        if (width === 375 || width === 1536) {
          await test("member-board." + label, label + " 成员编排行内编辑与分组候选", () =>
            assertMemberBoard(page, width, fixtures));
        }
      }
      // W6 ticket 17：分流搜索专项（375 窄屏堆叠布局 + 1536 桌面轴右/搜索左，
      // 两档都断言入口、高度稳定、搜索高亮、仅显示链与清除恢复）。
      if (width === 375 || width === 1536) {
        await test("flow-search." + label, label + " 分流图搜索聚焦专项（入口/高度/轴右搜索左/仅显示链）", () =>
          assertFlowSearch(page, width, fixtures));
      }
    }
    await test("runtime.console", "五档交互无新增 console error / 未捕获异常", () => {
      assert(consoleErrors.length === 0, "console/page error：" + consoleErrors.slice(0, 5).join(" | "));
      return "console error 0 条";
    });
  } finally {
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
    browser = null;
  }
}

function writeReport() {
  const pass = results.filter((row) => row.status === "pass").length;
  const fail = results.filter((row) => row.status === "fail").length;
  const lines = [];
  lines.push("# W6 响应式矩阵报告（ticket 09）");
  lines.push("");
  lines.push("- 时间：" + new Date().toISOString());
  lines.push("- Base：" + baseUrl());
  lines.push("- 视口：" + VIEWPORTS.map((item) => item.width + "×" + item.height).join(" / "));
  lines.push("- 结果：PASS " + pass + " / FAIL " + fail + " / 共 " + results.length);
  lines.push("- 隔离站点日志：" + (serverLog ? "`" + rel(serverLog) + "`" : "未启动（--base-url）"));
  lines.push("");
  lines.push("| 检查 | 结果 | 说明 |");
  lines.push("| --- | --- | --- |");
  for (const row of results) {
    const detail = row.status === "fail" ? row.detail : row.detail || "";
    lines.push("| " + row.id + " | " + (row.status === "pass" ? "PASS" : "FAIL") + " | " + detail.replace(/\|/g, "/").replace(/\n/g, " ") + " |");
  }
  lines.push("");
  lines.push("## 证据");
  lines.push("");
  for (const row of results) {
    if (row.evidence.length === 0) continue;
    lines.push("- " + row.id + "：" + row.evidence.map((item) => "`" + item + "`").join(" "));
  }
  fs.writeFileSync(path.join(OUT, "report.md"), lines.join("\n"));
  fs.writeFileSync(
    path.join(OUT, "report.json"),
    JSON.stringify({ base: baseUrl(), viewports: VIEWPORTS, serverLog: serverLog ? rel(serverLog) : "", results }, null, 2),
  );
  return { pass, fail };
}

main()
  .then(() => {
    const { pass, fail } = writeReport();
    console.log("");
    console.log("PASS " + pass + " · FAIL " + fail + " · 证据 " + rel(OUT));
    process.exitCode = fail > 0 ? 1 : 0;
  })
  .catch((error) => {
    console.error("矩阵环境错误：" + String((error && error.stack) || error));
    if (serverLog) console.error("\n隔离站点日志尾部：\n" + tailServerLog());
    process.exitCode = 2;
  })
  .finally(() => {
    if (browser) void browser.close().catch(() => {});
    stopIsolatedServer();
  });
