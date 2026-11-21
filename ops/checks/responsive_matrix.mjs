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
 *   5. 弹窗宽度/高度受视口约束、内容可滚、footer 竖排有间距；
 *      375/768 额外打开上游模型抽屉，断言左右边缘都在视口内、内容区可滚；
 *   6. 375 短视口（375×400）弹窗可滚，提交出口仍可达；
 *   7. 375 用 CDP 模拟粗指针，断言按钮触控目标 ≥44px、表格行高 ≥40px；
 *   8. 静态断点审计：只允许 Tailwind 默认断点，禁止 --breakpoint-* 自定义 token
 *      与 min-[…]/max-[…] 裸断点；图表/表格响应式容器 token 必须在位。
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
  return { userName: user.name, username: user.username, upstreamName, upstreamId: (await upstream.json()).id };
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
  await makeModel(wide + "a", true);
  await makeModel(wide + "b", true);
  const closedModel = await makeModel(wide + "closed", false);
  const publicModel = await page.request.post(baseUrl() + "/admin/public-models", {
    data: { name: "matrixpublicmodel" + Date.now().toString(36) + "withaverylongunbreakablenameforoverflow", routing_mode: "failover", enabled: false },
  });
  if (!publicModel.ok()) {
    throw new MatrixError("创建矩阵公开模型失败 HTTP " + publicModel.status() + "：" + (await publicModel.text()).slice(0, 300));
  }
  fixtures.upstreamModelName = wide;
  fixtures.closedUpstreamModelName = closedModel.name;
  fixtures.publicModelName = (await publicModel.json()).name;
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

  // 登录一次，后续只改视口；cookie 与 localStorage 在同一上下文内保持。
  const context = await browser.newContext({
    viewport: { width: VIEWPORTS[0].width, height: VIEWPORTS[0].height },
    baseURL: baseUrl(),
    locale: "zh-CN",
  });
  const page = await context.newPage();
  page.setDefaultTimeout(PLAYWRIGHT_TIMEOUT);
  const consoleErrors = [];
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    const text = message.text();
    if (text.includes("Download the React DevTools") || text.includes("ResizeObserver loop")) return;
    if (text.includes("401") || text.includes("Unauthorized")) return;
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
      }
      if (width === 375 || width === 768) {
        await test("drawer." + label, label + " 上游模型抽屉不超出视口且内容可滚", () => assertDrawer(page, width, height));
        // W6 ticket 10：模型管理两张表的表格专项（横滚 + 冻结操作列 + 贴边 + 关闭置尾）。
        await test("models-table.upstream." + label, label + " 上游模型表横滚 + 操作列贴边可操作 + 关闭行置尾", () =>
          assertModelsTable(page, width, fixtures, "upstream"));
        await test("models-table.public." + label, label + " 公开模型表横滚 + 操作列贴边可操作", () =>
          assertModelsTable(page, width, fixtures, "public"));
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
