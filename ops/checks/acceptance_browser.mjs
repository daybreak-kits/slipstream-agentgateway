#!/usr/bin/env node
/**
 * Slipstream 全站浏览器验收（ticket 20 前置）
 *
 * 覆盖（对应 docs/ACCEPTANCE.md「自动可执行」条目）：
 *   - 登录页品牌、错误密码、真实登录
 *   - 管理员登录后主导航 8+ 页面逐页加载、无错误边界/NaN/undefined、console 无 error
 *   - 策略 / 护栏 / MCP 页面可打开且可编辑入口存在
 *   - 上游详情五个 Tab（基本信息/密钥/模型/改写/健康）可切换
 *   - 模型管理两 Tab、设置页分组（未合并的 ticket 记为 PENDING，见下）
 *   - 模型试验 20 参数、会话复制/删除/重试、模型对话框
 *   - 普通用户看不到成本/管理员入口；直连 /cost 与 /admins 被前端拦截；后端 403；字段级权限缺失
 *   - 代理用户可进用户页、仍无成本
 *
 * 运行前提：
 *   1) 控制面 3700：cd api && python scripts/seed_demo.py && PYTHONPATH=src python -m uvicorn l06_api.app:create_app --factory --port 3700
 *   2) 管理台 5173：cd web && npm run dev（必须用 localhost，不要与 127.0.0.1 混用，否则 SameSite=Lax cookie 不带）
 *   3) 浏览器：优先 playwright；没有则 playwright-core + 本机 Edge/Chrome（--channel msedge|chrome 或 PLAYWRIGHT_CHROMIUM_EXECUTABLE）
 *
 * 用法：
 *   node ops/checks/acceptance_browser.mjs
 *   node ops/checks/acceptance_browser.mjs --base-url http://localhost:3700             # 单端口（默认）
 *   node ops/checks/acceptance_browser.mjs --base-url http://localhost:5173 --api-url http://localhost:3700  # Vite HMR 模式
 *   node ops/checks/acceptance_browser.mjs --channel msedge --headed
 *   node ops/checks/acceptance_browser.mjs --admin admin:admin12345 --user wangwu:admin12345 --agent lisi:admin12345
 *   node ops/checks/acceptance_browser.mjs --strict      # PENDING 也当失败（ticket 06/10/16 合入后用作发布门禁）
 *   node ops/checks/acceptance_browser.mjs --only login.brand,playground.params
 *
 * 退出码：0 全部通过（允许 PENDING）；1 有 FAIL；2 环境/依赖未就绪（未执行验收，不算通过）
 * 证据：ops/checks/.logs/acceptance/<时间戳>/report.json + report.md + *.png（.logs/ 已在 ops/checks/.gitignore 中，不入库）
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { launchBrowser, loadPlaywright, parseCred, parseFlags, stamp } from "./lib/cli.mjs";
import { openSession } from "./lib/session.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..", "..");

/* ------------------------------------------------------------------ *
 * 0. 参数与配置
 * ------------------------------------------------------------------ */

const flags = parseFlags(process.argv.slice(2));
const BASE_URL = (flags.get("base-url") || process.env.ACCEPTANCE_BASE_URL || "http://localhost:3700").replace(/\/$/, "");
const API_URL = (flags.get("api-url") || process.env.ACCEPTANCE_API_URL || "http://localhost:3700").replace(/\/$/, "");
const STRICT = flags.has("strict");
const HEADED = flags.has("headed");
const CHANNEL = flags.get("channel") || process.env.PLAYWRIGHT_CHANNEL || "";
const ONLY = flags.has("only") ? String(flags.get("only")).split(",").map((s) => s.trim()).filter(Boolean) : null;
const TEXT_IGNORE = flags.has("text-ignore") ? new RegExp(String(flags.get("text-ignore")), "g") : null;

const ADMIN_CRED = parseCred(flags.get("admin") || process.env.ACCEPTANCE_ADMIN, { user: "admin", pass: "admin12345" });
const USER_CRED = parseCred(flags.get("user") || process.env.ACCEPTANCE_USER, { user: "wangwu", pass: "admin12345" });
const AGENT_CRED = parseCred(flags.get("agent") || process.env.ACCEPTANCE_AGENT, { user: "lisi", pass: "admin12345" });

const OUT = path.resolve(flags.get("out") || path.join(ROOT, "ops", "checks", ".logs", "acceptance", stamp()));
fs.mkdirSync(OUT, { recursive: true });

const CONSOLE_IGNORE = [
  "Download the React DevTools",
  "ResizeObserver loop",
  ...(flags.has("console-ignore") ? String(flags.get("console-ignore")).split(",").filter(Boolean) : []),
];

/* ------------------------------------------------------------------ *
 * 1. 结果模型
 * ------------------------------------------------------------------ */

const results = [];
let currentEvidence = [];

class CheckError extends Error {}
class MissingError extends Error {}
class SkipError extends Error {}

function assert(condition, message) {
  if (!condition) throw new CheckError(message);
}

function assertIncludes(haystack, needle, label) {
  assert(haystack.includes(needle), (label || "文案") + "缺少「" + needle + "」");
}

async function test(id, title, fn, options) {
  const opts = options || {};
  if (ONLY && !ONLY.includes(id)) return;
  if (opts.skip) {
    results.push({ id, title, status: "skip", detail: opts.skip, evidence: [] });
    return;
  }
  currentEvidence = [];
  const started = Date.now();
  try {
    const detail = await fn();
    results.push({ id, title, status: "pass", detail: detail || "", evidence: currentEvidence, ms: Date.now() - started });
    console.log("PASS  " + id + "  " + title);
  } catch (error) {
    const isMissing = error instanceof MissingError;
    const isSkip = error instanceof SkipError;
    const status = isSkip ? "skip" : isMissing && opts.pending ? "pending" : "fail";
    const suffix = status === "pending" ? "（待 " + opts.pending + " 合入）" : "";
    results.push({
      id,
      title,
      status,
      detail: String(error.message || error) + suffix,
      evidence: currentEvidence,
      ms: Date.now() - started,
    });
    const mark = status === "pass" ? "PASS" : status === "fail" ? "FAIL" : status === "pending" ? "PENDING" : "SKIP";
    console.log(mark + "  " + id + "  " + title + " —— " + String(error.message || error) + suffix);
  } finally {
    currentEvidence = [];
  }
}

function summary() {
  const counts = { pass: 0, fail: 0, pending: 0, skip: 0 };
  for (const r of results) counts[r.status] = (counts[r.status] || 0) + 1;
  return counts;
}

/* ------------------------------------------------------------------ *
 * 2. 浏览器与页面辅助
 * ------------------------------------------------------------------ */

/**
 * 会话（登录 / 访问 / 断言 / 取证）全部在 lib/session.mjs，这里只给它本脚本的配置。
 * 截图通过 evidence 回调登记到当前用例的证据列表（test() 每条都会重置 currentEvidence）。
 */
const SESSION_OPTIONS = {
  base: BASE_URL,
  apiBase: API_URL,
  consoleIgnore: CONSOLE_IGNORE,
  textIgnore: TEXT_IGNORE,
  outDir: OUT,
  evidence: (file) => currentEvidence.push(file),
};







/* ------------------------------------------------------------------ *
 * 3. 预检
 * ------------------------------------------------------------------ */

async function preflight() {
  const problems = [];
  try {
    const health = await fetch(API_URL + "/admin/health", { signal: AbortSignal.timeout(5000) });
    if (!health.ok) problems.push("控制面 /admin/health 返回 " + health.status + "（" + API_URL + "）");
  } catch (error) {
    problems.push("控制面不可达 " + API_URL + "：" + String(error.message || error));
  }
  try {
    const web = await fetch(BASE_URL + "/login", { signal: AbortSignal.timeout(5000) });
    if (!web.ok) problems.push("管理台 /login 返回 " + web.status + "（" + BASE_URL + "）");
  } catch (error) {
    problems.push("管理台不可达 " + BASE_URL + "：" + String(error.message || error));
  }
  return problems;
}

/* ------------------------------------------------------------------ *
 * 4. 主流程
 * ------------------------------------------------------------------ */

const meta = {
  startedAt: new Date().toISOString(),
  baseUrl: BASE_URL,
  apiUrl: API_URL,
  strict: STRICT,
  node: process.version,
  playwright: null,
  browser: null,
  artifacts: path.relative(ROOT, OUT).replace(/\\/g, "/"),
};

function writeReport(infraError) {
  const counts = summary();
  const report = { meta, infraError: infraError || null, summary: counts, results };
  fs.writeFileSync(path.join(OUT, "report.json"), JSON.stringify(report, null, 2));
  const lines = [];
  lines.push("# Slipstream 浏览器验收报告");
  lines.push("");
  lines.push("- 时间：" + meta.startedAt + " → " + new Date().toISOString());
  lines.push("- 管理台：" + BASE_URL + " · 控制面：" + API_URL);
  lines.push("- 浏览器：" + (meta.playwright || "未加载") + " · " + (meta.browser || "-"));
  lines.push("- 结果： PASS " + counts.pass + " / FAIL " + counts.fail + " / PENDING " + counts.pending + " / SKIP " + counts.skip);
  if (infraError) lines.push("- 未执行原因：" + infraError);
  lines.push("");
  lines.push("| 检查 | 状态 | 说明 |");
  lines.push("|---|---|---|");
  for (const r of results) {
    lines.push("| " + r.id + " | " + r.status.toUpperCase() + " | " + String(r.detail || "").replace(/\|/g, "\\|").slice(0, 300) + " |");
  }
  lines.push("");
  lines.push("证据（截图与 JSON 均在 " + meta.artifacts + "/）：");
  for (const r of results) for (const file of r.evidence || []) lines.push("- " + file);
  fs.writeFileSync(path.join(OUT, "report.md"), lines.join("\n") + "\n");
  console.log("");
  console.log("报告：" + path.relative(ROOT, OUT).replace(/\\/g, "/") + "/report.md");
  console.log("证据目录：" + path.relative(ROOT, OUT).replace(/\\/g, "/") + "/");
}

async function main() {
  console.log("# Slipstream 浏览器验收");
  console.log("管理台 " + BASE_URL + " · 控制面 " + API_URL + " · 证据 " + meta.artifacts);
  console.log("");

  const playwright = await loadPlaywright();
  if (!playwright) {
    const message = [
      "未找到 playwright / playwright-core。",
      "  方案 A（本仓零依赖，推荐）：cd web && npm i -D playwright-core && node ops/checks/acceptance_browser.mjs --channel msedge",
      "  方案 B：cd web && npm i -D playwright && npx playwright install chromium",
      "  方案 C：用 browser MCP（Playwright MCP）按 docs/ACCEPTANCE.md 的「浏览器 MCP 手测路径」逐条执行，证据存 ops/checks/.logs/acceptance/<时间戳>/",
    ].join("\n");
    meta.playwright = "missing";
    writeReport(message);
    console.error(message);
    process.exit(2);
  }
  meta.playwright = playwright.module;

  const problems = await preflight();
  if (problems.length > 0) {
    const message = [
      "服务未就绪，跳过浏览器验收：",
      ...problems.map((p) => "  - " + p),
      "  启动顺序：cd api && python scripts/seed_demo.py && PYTHONPATH=src python -m uvicorn l06_api.app:create_app --factory --host 127.0.0.1 --port 3700",
      "            cd web && npm run build  # 构建后由控制面 3700 同源托管，访问 http://localhost:3700",
    ].join("\n");
    writeReport(message);
    console.error(message);
    process.exit(2);
  }

  let browser;
  try {
    const launched = await launchBrowser(playwright, { channel: CHANNEL, headed: HEADED, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || "" });
    browser = launched.browser;
    meta.browser = JSON.stringify(launched.options);
  } catch (error) {
    const message = String(error.message || error) + "\n  检查 Edge/Chrome 是否安装；或用 --channel msedge / PLAYWRIGHT_CHROMIUM_EXECUTABLE 指定可执行文件。";
    writeReport(message);
    console.error(message);
    process.exit(2);
  }

  const admin = await openSession(browser, { role: "admin", ...SESSION_OPTIONS });
  admin.cred = ADMIN_CRED;

  /* ---------- 登录页 ---------- */
  await test("login.brand", "登录页品牌（title/logo/驭流+Slipstream）", async () => {
    const before = admin.consoleErrors.length;
    await admin.gotoLogin();
    const title = await admin.page.title();
    assertIncludes(title, "驭流", "页面 title");
    assertIncludes(title, "Slipstream", "页面 title");
    const logo = admin.page.locator('img[src*="logo-v10-contrast.svg"]');
    // dev server 首屏要等 Vite 编译 + React 挂载，先等选择器出现再断言
    await admin.page.waitForSelector('img[src*="logo-v10-contrast.svg"]', { state: "visible", timeout: 15000 }).catch(() => {});
    assert((await logo.count()) > 0, "登录页缺少 logo-v10-contrast.svg");
    assert(await logo.first().isVisible(), "登录页 logo 不可见");
    const text = await admin.page.locator("body").innerText();
    assertIncludes(text, "驭流", "登录页文案");
    assertIncludes(text, "Slipstream", "登录页文案");
    admin.assertNoNewErrors(before, "登录页");
    await admin.shot("login-brand");
    return "title=" + title;
  });

  await test("login.wrong-password", "错误密码显示后端错误信息且停留在登录页", async () => {
    await admin.gotoLogin();
    const wrong = { user: ADMIN_CRED.user, pass: "definitely-wrong-" + Date.now() };
    await admin.submitLogin(wrong);
    const outcome = await admin.waitLoginOutcome();
    assert(!outcome.ok, "错误密码竟然登录成功");
    assert(/用户名或密码错误|登录失败|401/.test(outcome.message), "错误提示不符合预期：" + outcome.message);
    assert(new URL(admin.page.url()).pathname.startsWith("/login"), "错误密码后离开了 /login");
    assert(admin.pageErrors.length === 0, "错误密码流程出现未捕获异常：" + admin.pageErrors.join(" | "));
    await admin.shot("login-wrong-password");
    return "提示：" + outcome.message;
  });

  await test("api.health", "控制面 /admin/health 可用", async () => {
    const health = await admin.apiGet("/admin/health");
    assert(health.status === 200, "健康检查返回 " + health.status);
    return JSON.stringify(health.body).slice(0, 200);
  });

  await test("login.admin", "管理员真实登录成功并拿到全部权限", async () => {
    const before = admin.consoleErrors.length;
    const outcome = await admin.login(ADMIN_CRED);
    if (!outcome.ok) throw new CheckError("管理员登录失败：" + outcome.message + "（先跑 seed_demo.py）");
    await admin.settle();
    const me = await admin.apiGet("/admin/auth/me");
    assert(me.status === 200, "/admin/auth/me 返回 " + me.status);
    const permissions = (me.body && me.body.permissions) || [];
    assert(permissions.includes("billing:cost"), "管理员缺少 billing:cost 权限");
    assert(permissions.includes("admins:read"), "管理员缺少 admins:read 权限");
    admin.assertNoNewErrors(before, "登录后首页");
    await admin.shot("login-admin-home");
    return "权限 " + permissions.length + " 项 · 角色 " + (me.body && me.body.role);
  });

  /* ---------- 主导航 ---------- */
  let adminLinks = [];

  await test("admin.nav", "管理员主导航渲染 8+ 个页面入口", async () => {
    await admin.ensureAuthed();
    adminLinks = await admin.navLinks();
    assert(adminLinks.length >= 8, "侧栏只渲染了 " + adminLinks.length + " 个导航项，要求 ≥ 8");
    for (const link of adminLinks) {
      assert(link.href.startsWith("/"), "导航项 href 异常：" + JSON.stringify(link));
      assert(link.label.length > 0, "导航项缺少文案：" + link.href);
    }
    return adminLinks.map((l) => l.label + "(" + l.href + ")").join(" ");
  });

  await test("shell.command-palette", "Ctrl+K 全局搜索可打开、搜索并 Esc 关闭", async () => {
    await admin.ensureAuthed();
    await admin.visit("/", "全局概览");
    const from = admin.consoleErrors.length;
    await admin.page.keyboard.press("Control+k");
    const dialog = admin.page.getByRole("dialog");
    await dialog.waitFor({ state: "visible", timeout: 8000 });
    const input = dialog.getByPlaceholder(/搜索上游/);
    await input.waitFor({ state: "visible", timeout: 5000 });
    await input.fill("glm");
    await admin.page.waitForTimeout(900);
    const text = await dialog.innerText();
    assert(!text.includes("正在加载"), "全局搜索仍在加载");
    assert(!text.includes("没有匹配的结果"), "搜索 glm 没有匹配结果");
    assert(text.includes("共 ") && text.includes("条"), "全局搜索缺少结果计数");
    await admin.shot("shell-command-palette");
    await admin.page.keyboard.press("Escape");
    await admin.page.waitForTimeout(400);
    assert((await admin.page.getByRole("dialog").count()) === 0, "Esc 未能关闭全局搜索");
    admin.assertNoNewErrors(from, "全局搜索");
    return "Ctrl+K 打开搜索，glm 有命中，Esc 关闭";
  });

  await test("shell.theme-toggle", "顶栏主题切换在浅色/深色/跟随系统间生效", async () => {
    await admin.ensureAuthed();
    await admin.visit("/", "全局概览");
    const html = admin.page.locator("html");
    const before = (await html.getAttribute("class")) ?? "";
    await admin.page.getByRole("radio", { name: "深色", exact: true }).first().click();
    await admin.page.waitForTimeout(300);
    assert(((await html.getAttribute("class")) ?? "").includes("dark"), "切到深色后 <html> 没有 dark class");
    await admin.page.getByRole("radio", { name: "浅色", exact: true }).first().click();
    await admin.page.waitForTimeout(300);
    assert(!((await html.getAttribute("class")) ?? "").includes("dark"), "切到浅色后 <html> 仍是 dark");
    await admin.shot("shell-theme-light");
    await admin.page.getByRole("radio", { name: "深色", exact: true }).first().click();
    await admin.page.waitForTimeout(300);
    await admin.shot("shell-theme-dark");
    await admin.page.getByRole("radio", { name: "跟随系统", exact: true }).first().click();
    await admin.page.waitForTimeout(300);
    const after = (await html.getAttribute("class")) ?? "";
    assert(before.includes("dark") === after.includes("dark"), "恢复跟随系统后主题与初始不一致");
    return "浅色/深色/跟随系统 均可切换";
  });

  await test("dashboard.kpis", "看板 KPI：数字口径、八卡图标语义与轻盈分类配色", async () => {
    await admin.ensureAuthed();
    const from = admin.consoleErrors.length;
    await admin.visit("/dashboard", "数据看板");
    await admin.page.locator("main").getByText("请求量", { exact: true }).first().waitFor({ state: "visible", timeout: 15000 });

    // 指标 → 期望图标（形状即语义）：缓存用 Database、P50 用 Gauge、成本用 CircleDollarSign，
    // 费用 Receipt / 请求 Activity / 词元 Layers / RPM Timer / TPM Zap，八卡八形。
    const EXPECTED = [
      ["请求量", "activity"],
      ["词元", "layers"],
      ["缓存", "database"],
      ["费用", "receipt"],
      ["成本 · 毛利率", "circle-dollar-sign"],
      ["P50 延迟", "gauge"],
      ["RPM 请求/分", "timer"],
      ["TPM 词元/分", "zap"],
    ];
    const cards = await admin.page.evaluate((labels) => {
      const iconName = (svg) => {
        const classes = (svg.getAttribute("class") || "").split(/\s+/);
        const primary = classes.find((name) => name.startsWith("lucide-"));
        return primary ? primary.slice("lucide-".length) : "";
      };
      return labels.map((label) => {
        const leaves = Array.from(document.querySelectorAll("main *")).filter(
          (el) => el.children.length === 0 && (el.textContent || "").trim() === label,
        );
        const card = leaves[0]?.closest('[data-slot="card"]');
        if (!card) return { label, missing: true };
        const svg = card.querySelector("svg.lucide");
        const badge = svg?.closest("span");
        return {
          label,
          missing: false,
          icon: svg ? iconName(svg) : "",
          iconClass: (svg?.getAttribute("class") || "") + " " + (badge?.getAttribute("class") || ""),
          bg: badge ? getComputedStyle(badge).backgroundColor : "",
          value: (card.querySelector(".tnum")?.textContent || "").trim(),
        };
      });
    }, EXPECTED.map(([label]) => label));

    // ① 八卡都在，且每卡同时有图标形状 + 文字标签（双重编码，不只靠颜色区分）。
    for (const [label] of EXPECTED) {
      assert(cards.some((card) => card.label === label && !card.missing), "看板缺少 KPI 卡：" + label);
      assert(cards.find((card) => card.label === label).icon !== "", label + " 缺少图标形状");
    }

    // ② 图标语义：八卡八形，形状与指标一一对应。
    const iconNames = cards.map((card) => card.icon);
    assert(new Set(iconNames).size === 8, "八卡图标形状必须互不相同，实际：" + iconNames.join("、"));
    for (const [label, icon] of EXPECTED) {
      const card = cards.find((item) => item.label === label);
      assert(card.icon === icon, label + " 图标应为 " + icon + "，实际：" + card.icon);
    }

    // ③ 轻盈分类配色：至少 5 种可区分图标底色；缓存与 P50 不同色；最多一张卡用 primary。
    const backgrounds = cards.map((card) => card.bg);
    assert(new Set(backgrounds).size >= 5, "KPI 图标底色至少 5 种可区分色，实际 " + new Set(backgrounds).size + " 种");
    const cacheBg = cards.find((card) => card.label === "缓存").bg;
    const p50Bg = cards.find((card) => card.label === "P50 延迟").bg;
    assert(cacheBg !== p50Bg, "缓存与 P50 图标底色不能相同（不得再共用 info 灰）");
    const primaryCards = cards.filter((card) => /bg-primary\/15|text-primary\b/.test(card.iconClass));
    assert(primaryCards.length <= 1, "KPI 图标最多一张卡用 primary，不能再四张卡共用");
    for (const card of cards) assert(!/text-info\b/.test(card.iconClass), card.label + " 图标不得再用 info 灰");

    // ④ 数字口径：计数/词元/TPM 千分位整数、RPM 两位、金额两位、延迟秒两位。
    const COUNT_RE = /^-?\d{1,3}(?:,\d{3})*$/;
    const RPM_RE = /^\d{1,3}(?:,\d{3})*\.\d{2}$/;
    const MONEY_RE = /^-?[¥$€]?\d{1,3}(?:,\d{3})*\.\d{2}$/;
    const valueOf = (label) => cards.find((card) => card.label === label).value;
    for (const label of ["请求量", "词元", "TPM 词元/分"]) {
      assert(COUNT_RE.test(valueOf(label)), label + " 必须是千分位整数，实际：" + valueOf(label));
    }
    assert(RPM_RE.test(valueOf("RPM 请求/分")), "RPM 必须两位小数，实际：" + valueOf("RPM 请求/分"));
    for (const label of ["费用", "成本 · 毛利率"]) {
      assert(MONEY_RE.test(valueOf(label)), label + " 必须两位小数金额，实际：" + valueOf(label));
    }
    const cacheValue = valueOf("缓存");
    assert(cacheValue === "无缓存" || COUNT_RE.test(cacheValue), "缓存必须千分位整数或「无缓存」，实际：" + cacheValue);
    const p50 = valueOf("P50 延迟");
    assert(
      /^\d+\.\d{2}s$/.test(p50) || p50 === "—" || p50.startsWith("样本不足"),
      "P50 延迟必须两位小数秒或占位，实际：" + p50,
    );

    await admin.shot("dashboard-kpis");
    admin.assertNoNewErrors(from, "看板 KPI");
    return "八卡数字口径 + 8 个图标形状 + " + new Set(backgrounds).size + " 种分类底色";
  });

  await test("dashboard.tabs", "看板三标签（柱形/面积/分流）与热力图 7D/30D/365D 可切换", async () => {
    await admin.ensureAuthed();
    const from = admin.consoleErrors.length;
    await admin.visit("/dashboard", "数据看板");
    const tablist = admin.page.getByRole("tablist", { name: "图表类型" });
    assert((await tablist.count()) > 0, "看板缺少图表类型 tablist");
    for (const label of ["柱形图", "面积图", "分流图"]) {
      await admin.page.getByRole("tab", { name: label }).first().click();
      await admin.page.waitForTimeout(900);
      await admin.assertSane("看板/" + label);
      await admin.shot("dashboard-" + label);
    }
    for (const label of ["7D", "30D", "365D"]) {
      await admin.page.getByText(label, { exact: true }).first().click();
      await admin.page.waitForTimeout(700);
      await admin.assertSane("看板/热力图 " + label);
    }
    await admin.shot("dashboard-heatmap-365d");
    admin.assertNoNewErrors(from, "看板切换");
    return "柱形图/面积图/分流图 + 7D/30D/365D 全部可切换";
  });

  await test("pricing.edit", "价目管理成本列可内联编辑并保存（验证后还原）", async () => {
    await admin.ensureAuthed();
    const from = admin.consoleErrors.length;
    await admin.visit("/pricing", "价目管理");
    const inputs = admin.page.locator('input[aria-label$="输入成本单价"]');
    assert((await inputs.count()) > 0, "价目表没有可编辑的成本单价输入框");
    const input = inputs.first();
    const original = await input.inputValue();
    assert(original !== "", "首个模型没有成本价，无法验证编辑保存");
    const bumped = (Number(original) + 1).toFixed(6);
    await input.fill(bumped);
    await input.press("Enter");
    await admin.page.getByText("价目已保存").first().waitFor({ state: "visible", timeout: 10000 });
    await admin.shot("pricing-edit-saved");
    await input.fill(original);
    await input.press("Enter");
    await admin.page.waitForTimeout(1500);
    admin.assertNoNewErrors(from, "价目编辑");
    await admin.page.reload({ waitUntil: "domcontentloaded" });
    await admin.settle();
    const restored = await admin.page.locator('input[aria-label$="输入成本单价"]').first().inputValue();
    assert(Number(restored) === Number(original), "成本价未还原：" + restored + " != " + original);
    await admin.shot("pricing-edit-restored");
    return "成本单价可编辑保存并已还原为 " + original;
  });

  await test("admin.pages", "主导航每个页面可加载且 console 无 error", async () => {
    await admin.ensureAuthed();
    if (adminLinks.length === 0) adminLinks = await admin.navLinks();
    assert(adminLinks.length > 0, "导航尚未采集");
    const failures = [];
    for (const link of adminLinks) {
      const from = admin.consoleErrors.length;
      try {
        const response = await admin.page.goto(BASE_URL + link.href, { waitUntil: "domcontentloaded", timeout: 30000 });
        await admin.settle();
        assert(response && response.status() < 400, "HTTP " + (response ? response.status() : "?"));
        await admin.assertSane(link.label || link.href);
        admin.assertNoNewErrors(from, link.label || link.href);
        await admin.shot("admin-page-" + (link.label || link.href));
      } catch (error) {
        failures.push((link.label || link.href) + " " + link.href + "：" + String(error.message || error));
        await admin.shot("FAIL-admin-page-" + (link.label || link.href));
      }
    }
    assert(failures.length === 0, "页面失败 " + failures.length + " 个：" + failures.join("；"));
    return "巡检 " + adminLinks.length + " 个页面，全部通过";
  });

  await test("admin.governance", "策略/护栏/MCP 页面可打开且有编辑入口", async () => {
    const expectations = [
      { path: "/policies", label: "策略", markers: ["编辑", "原始 JSON"], screenshot: "admin-policies" },
      { path: "/guardrails", label: "护栏", markers: ["添加护栏", "编辑", "正则"], screenshot: "admin-guardrails" },
      { path: "/mcp", label: "MCP", markers: ["新增服务器", "新增", "编辑"], screenshot: "admin-mcp" },
    ];
    const missing = [];
    for (const item of expectations) {
      const visited = await admin.visit(item.path, item.label);
      if (!item.markers.some((marker) => visited.text.includes(marker))) {
        missing.push(item.label + "（找不到 " + item.markers.join(" / ") + "）");
      }
      await admin.shot(item.screenshot);
    }
    assert(missing.length === 0, "治理页面缺少可编辑入口：" + missing.join("；"));
    return "策略/护栏/MCP 均可打开且可编辑";
  });

  /** 上游列表数据：有的接口回裸数组，有的回 {items}。 */
  async function listUpstreams() {
    const upstreams = await admin.apiGet("/admin/upstreams");
    assert(upstreams.status === 200, "/admin/upstreams 返回 " + upstreams.status);
    const items = Array.isArray(upstreams.body) ? upstreams.body : (upstreams.body && upstreams.body.items) || [];
    assert(items.length > 0, "没有上游数据（先跑 seed_demo.py）");
    return items;
  }

  await test("upstream.detail-tabs", "上游详情四 Tab（连接与模型/路由与模型/请求与响应/其他设置）可切换", async () => {
    const items = await listUpstreams();
    const upstream = items[0];
    const visited = await admin.visit("/upstreams/" + upstream.id, "上游详情");
    for (const label of ["连接与模型", "路由与模型", "请求与响应", "其他设置"]) {
      assertIncludes(visited.text, label, "上游详情 Tab");
    }
    for (const label of ["路由与模型", "请求与响应", "其他设置", "连接与模型"]) {
      const button = admin.page.getByRole("tab", { name: label, exact: true }).first();
      assert((await button.count()) > 0, "找不到 Tab 按钮：" + label);
      await button.click();
      await admin.page.waitForTimeout(300);
      await admin.assertSane("上游详情/" + label);
      await admin.shot("upstream-tab-" + label);
    }
    return "上游 " + (upstream.name || upstream.id) + " 四个 Tab 存在且可切换";
  });

  await test("upstream.test-jump", "列表「测试」只跳转详情「路由与模型」，不再发 test-connection、不再全局 pending", async () => {
    const items = await listUpstreams();
    const target = items.find((item) => (item.model_count ?? 0) > 0) || items[0];
    await admin.visit("/upstreams", "上游渠道");
    const testRequests = [];
    const onRequest = (request) => {
      if (request.url().includes("/test-connection")) testRequests.push(request.url());
    };
    admin.page.on("request", onRequest);
    try {
      const row = admin.page.locator("tbody tr", { hasText: target.name }).first();
      assert((await row.count()) > 0, "列表找不到上游行：" + target.name);
      const testButton = row.getByRole("button", { name: "测试", exact: true }).first();
      assert((await testButton.count()) > 0, "上游行内缺少「测试」按钮");
      await testButton.click();
      // 旧实现先发请求并禁灰所有行；新实现立即跳转并带 ?tab=routing。
      await admin.page.waitForURL(/\/upstreams\/[^/]+\?tab=routing/, { timeout: 10000 });
    } finally {
      admin.page.off("request", onRequest);
    }
    assert(testRequests.length === 0, "列表页「测试」仍在发 test-connection：" + testRequests.join("、"));
    await admin.settle();
    const activeTab = admin.page.locator('[role="tab"][aria-selected="true"]').first();
    const activeText = await activeTab.innerText();
    assert(activeText.includes("路由与模型"), "跳转后未定位到「路由与模型」Tab，当前：" + activeText);
    await admin.assertSane("上游详情/路由与模型（跳转）");
    await admin.shot("upstream-test-jump");
    return "行内测试跳转到 " + admin.page.url().replace(BASE_URL, "") + "，无 test-connection 请求";
  });

  await test("upstream.route-model-test", "路由与模型：单模型测试 + 全部测试可取消 + 密钥选择 + 失败行会话内展示", async () => {
    const items = await listUpstreams();
    // 优先本地假上游（seed 里 127.0.0.1:8000 会快速连接失败），失败行几秒内可见；
    // 否则退回任意有模型的上游（真实上游/假 key 也会很快 401）。
    const withModels = items.filter((item) => (item.model_count ?? 0) > 0);
    assert(withModels.length > 0, "没有带模型的上游（先跑 seed_demo.py）");
    const target = withModels.find((item) => String(item.base_url || "").includes("127.0.0.1")) || withModels[0];

    await admin.visit("/upstreams/" + target.id + "?tab=routing", "上游详情/路由与模型");
    const activeText = await admin.page.locator('[role="tab"][aria-selected="true"]').first().innerText();
    assert(activeText.includes("路由与模型"), "?tab=routing 未定位到「路由与模型」Tab");

    // 密钥选择：默认项必须存在（真实上游密钥下拉按实际密钥行列出）。
    const keyTrigger = admin.page.getByRole("combobox", { name: "选择测试密钥" }).first();
    assert((await keyTrigger.count()) > 0, "缺少密钥选择入口（aria-label=选择测试密钥）");
    await keyTrigger.click();
    const defaultOption = admin.page.getByRole("option", { name: "默认（第一把）" }).first();
    await defaultOption.waitFor({ state: "visible", timeout: 5000 }).catch(() => {});
    assert((await defaultOption.count()) > 0, "密钥选择缺少「默认（第一把）」");
    await admin.page.keyboard.press("Escape");

    // 单模型测试：行内「测试」→ 测试结果列出现 连通/失败/超时/连接失败（会话内徽章）。
    const probeCell = admin.page.locator("tbody tr").first().locator("td").nth(4);
    const rowTestButton = admin.page.locator("tbody tr").first().getByRole("button", { name: "测试", exact: true }).first();
    assert((await rowTestButton.count()) > 0, "模型行内缺少「测试」按钮");
    await rowTestButton.click();
    const deadline = Date.now() + 30000;
    let probeText = "";
    while (Date.now() < deadline) {
      probeText = await probeCell.innerText().catch(() => "");
      if (/连通|失败|超时|连接失败/.test(probeText)) break;
      await admin.page.waitForTimeout(300);
    }
    assert(/连通|失败|超时|连接失败/.test(probeText), "单模型测试未出现会话内结果徽章，当前：" + probeText);
    await admin.shot("upstream-model-probe-single");

    // 全部测试：串行进度 + 取消入口；取消后保留部分结果并标明「已取消」。
    const allButton = admin.page.getByRole("button", { name: "全部测试", exact: true }).first();
    assert((await allButton.count()) > 0, "缺少「全部测试」按钮");
    await allButton.click();
    const cancelButton = admin.page.getByRole("button", { name: /取消测试/ }).first();
    await cancelButton.waitFor({ state: "visible", timeout: 8000 }).catch(() => {});
    assert((await cancelButton.count()) > 0, "全部测试没有运行中进度/取消入口");
    await cancelButton.click();
    const cancelled = admin.page.getByText(/已取消/).first();
    await cancelled.waitFor({ state: "visible", timeout: 10000 }).catch(() => {});
    assert((await cancelled.count()) > 0, "取消后没有「已取消」标记");
    await admin.assertSane("上游详情/路由与模型（已取消）");
    await admin.shot("upstream-model-probe-cancelled");

    // 清空结果：会话内结果可清空。
    const clearButton = admin.page.getByRole("button", { name: "清空结果", exact: true }).first();
    assert((await clearButton.count()) > 0, "缺少「清空结果」按钮");
    await clearButton.click();
    await admin.page.waitForTimeout(300);
    const clearedText = await probeCell.innerText().catch(() => "");
    assert(!/连通|失败|超时|连接失败/.test(clearedText), "清空结果后仍残留探测徽章：" + clearedText);
    return "单模型结果=" + probeText.replace(/\s+/g, " ").trim() + "；全部测试可取消、结果可清空";
  });

  await test("models.two-tabs", "模型管理用「上游模型/公开模型」两个 Tab 承载", async () => {
    const visited = await admin.visit("/models", "模型管理");
    const tabs = await admin.page.getByRole("tab").evaluateAll((els) => els.map((el) => (el.textContent || "").trim()));
    assert(tabs.includes("上游模型") && tabs.includes("公开模型"), "模型管理页没有两个 Tab；当前按钮文案：" + tabs.slice(0, 30).join("/"));
    assertIncludes(visited.text, "上游模型", "模型管理页");
    await admin.page.getByRole("tab", { name: "公开模型", exact: true }).first().click();
    await admin.page.waitForTimeout(400);
    await admin.assertSane("模型管理/公开模型");
    await admin.shot("admin-model-management-tabs");
    return "上游模型 / 公开模型 双 Tab 存在且可切换";
  });

  await test("models.upstreamDrawer", "上游模型编辑：100vh 抽屉、固定底栏、滚动、冷却互斥与小屏全宽", async () => {
    await admin.ensureAuthed();
    const from = admin.consoleErrors.length;
    const modelsRes = await admin.apiGet("/admin/upstream-models?page_size=200");
    assert(modelsRes.status === 200, "/admin/upstream-models 返回 " + modelsRes.status);
    const models = Array.isArray(modelsRes.body) ? modelsRes.body : (modelsRes.body && modelsRes.body.items) || [];
    assert(models.length > 0, "没有上游模型数据（先跑 seed_demo.py）");
    const model = models[0];
    const MARK = "ticket11-acceptance-" + Date.now();
    const cleanup = async () => {
      // 释放行冷却 + 删除本用例创建的周期规则（备注带 MARK），保证验收幂等。
      try {
        await admin.page.request.patch(admin.apiBase + "/admin/upstream-models/" + model.id, { data: { cooldown_until_ms: 0 } });
        const rulesRes = await admin.apiGet("/admin/availability-rules?page_size=200");
        const rules = Array.isArray(rulesRes.body) ? rulesRes.body : [];
        for (const rule of rules) {
          if (rule.scope === "upstream_model" && rule.scope_id === model.id && String(rule.note || "").includes(MARK)) {
            await admin.page.request.delete(admin.apiBase + "/admin/availability-rules/" + rule.id);
          }
        }
      } catch {
        // 清理失败不改变验收结论
      }
      await admin.page.setViewportSize({ width: 1440, height: 900 });
    };
    try {
      await admin.visit("/models", "模型管理");
      const row = admin.page.locator("tr", { hasText: model.name }).first();
      await row.waitFor({ state: "visible", timeout: 15000 });
      await row.getByRole("button", { name: "编辑", exact: true }).click();
      const drawer = admin.page.locator('[data-slot="upstream-model-drawer"]');
      await drawer.waitFor({ state: "visible", timeout: 8000 });
      // Sheet 有 slide-in 动画（500ms）：等几何稳定后再量 100vh / 宽度 / 贴边。
      await admin.page.waitForTimeout(800);
      const viewport = admin.page.viewportSize();

      // ① 大屏：右侧满高 100vh、宽 760–860px、贴右边缘；四个分组齐全。
      const box = await drawer.boundingBox();
      assert(box, "抽屉没有可见区域");
      assert(Math.abs(box.height - viewport.height) <= 2, "抽屉必须满高（100vh），实际 " + JSON.stringify(box));
      assert(box.width >= 760 && box.width <= 861, "大屏抽屉宽应在 760–860px，实际 " + box.width);
      assert(Math.abs(box.x + box.width - viewport.width) <= 1, "抽屉必须贴右边缘，实际 x=" + box.x);
      const drawerText = await drawer.innerText();
      for (const label of ["基本信息", "能力与参数", "价格", "状态与冷却"]) assertIncludes(drawerText, label, "抽屉分组");
      await admin.shot("models-upstream-drawer-large");

      // ② 内容区滚动、底部「取消 / 保存」固定：滚动前后保存按钮视口位置不变。
      const save = drawer.getByRole("button", { name: "保存", exact: true });
      assert((await save.count()) === 1, "抽屉必须有唯一「保存」主按钮");
      const before = await save.boundingBox();
      const scroller = drawer.locator(".overflow-y-auto").first();
      const metrics = await scroller.evaluate((el) => ({ scrollHeight: el.scrollHeight, clientHeight: el.clientHeight }));
      assert(metrics.scrollHeight > metrics.clientHeight, "抽屉内容必须可滚动（不了一屏时不该挤扁底栏），实际 " + JSON.stringify(metrics));
      await scroller.evaluate((el) => { el.scrollTop = el.scrollHeight; });
      await admin.page.waitForTimeout(250);
      const after = await save.boundingBox();
      assert(before && after && Math.abs(before.y - after.y) <= 1, "滚动后底部按钮必须固定，before=" + JSON.stringify(before) + " after=" + JSON.stringify(after));
      assert(after.y + after.height >= viewport.height - 80 && after.y + after.height <= viewport.height - 2, "底部按钮必须贴着视口底部，实际 " + JSON.stringify(after));
      await admin.shot("models-upstream-drawer-scrolled");

      // ③ 09 脏标记：字段改动 → 已修改点 + 未保存摘要 + 保存变主按钮；恢复全部后清零并中性禁用。
      await scroller.evaluate((el) => { el.scrollTop = 0; });
      const nameInput = drawer.locator("input.font-mono").first();
      const originalName = await nameInput.inputValue();
      await nameInput.fill(originalName + "-dirty");
      await drawer.getByText("已修改", { exact: true }).first().waitFor({ state: "visible", timeout: 5000 });
      assertIncludes(await drawer.innerText(), "未保存 1 项", "未保存摘要");
      assert(!(await save.isDisabled()), "有未保存修改时保存按钮必须可用（主按钮）");
      await drawer.getByRole("button", { name: "恢复全部", exact: true }).click();
      await admin.page.waitForTimeout(200);
      assert((await nameInput.inputValue()) === originalName, "恢复全部必须回填基线值");
      assert(await save.isDisabled(), "干净状态下保存按钮必须中性禁用");

      // ④ 冷却互斥：设单次冷却 → 周期模式禁用 + 互斥说明（含截止）→ 唯一解除。
      await drawer.locator('[data-mode="single"]').click();
      await drawer.getByRole("button", { name: "1 小时", exact: true }).click();
      await drawer.getByRole("button", { name: "设置冷却", exact: true }).click();
      await drawer.getByText("冷却中", { exact: true }).waitFor({ state: "visible", timeout: 10000 });
      assert(await drawer.locator('[data-mode="periodic"]').isDisabled(), "单次冷却生效时周期模式必须禁用");
      const coolingText = await drawer.innerText();
      assertIncludes(coolingText, "单次冷却生效期间不能创建或改期周期冷却", "互斥说明");
      assertIncludes(coolingText, "当前单次冷却至", "互斥说明含截止时间");
      const release = drawer.locator('[data-slot="cooldown-release"]');
      assert((await release.count()) === 1, "冷却中必须恰好一个「解除」入口");
      await release.click();
      await drawer.getByText("无冷却", { exact: true }).waitFor({ state: "visible", timeout: 10000 });

      // ⑤ 周期窗口（UI 建 00:00–00:00 全天窗口）→ 单次模式禁用 + 阻塞规则与窗口结束时间；解除只跳过当前窗口。
      await drawer.locator('[data-mode="periodic"]').click();
      await drawer.locator('input[type="time"]').nth(0).fill("00:00");
      await drawer.locator('input[type="time"]').nth(1).fill("00:00");
      await drawer.getByPlaceholder("如：每日凌晨例行维护").fill(MARK);
      await drawer.getByRole("button", { name: "设置周期冷却", exact: true }).click();
      await drawer.getByText("已有周期冷却", { exact: true }).waitFor({ state: "visible", timeout: 10000 });
      await drawer.getByText("冷却中", { exact: true }).waitFor({ state: "visible", timeout: 10000 });
      assert(await drawer.locator('[data-mode="single"]').isDisabled(), "周期窗口生效时单次模式必须禁用");
      const windowText = await drawer.innerText();
      assertIncludes(windowText, "周期冷却窗口生效期间不能设置单次冷却", "互斥说明");
      assertIncludes(windowText, "窗口至", "互斥说明含窗口结束时间");
      assertIncludes(windowText, "00:00–00:00", "互斥说明含阻塞规则摘要");
      await admin.shot("models-upstream-drawer-cooldown-conflict");
      await drawer.locator('[data-slot="cooldown-release"]').click();
      await drawer.getByText("无冷却", { exact: true }).waitFor({ state: "visible", timeout: 10000 });
      // 删除周期规则（需要显式确认），删除后单次模式恢复可用。
      await drawer.getByRole("button", { name: "删除规则", exact: true }).click();
      const confirm = admin.page.getByRole("alertdialog");
      await confirm.waitFor({ state: "visible", timeout: 5000 });
      await confirm.getByRole("button", { name: "删除规则", exact: true }).click();
      await admin.page.waitForTimeout(600);
      assert(!(await drawer.locator('[data-mode="single"]').isDisabled()), "删除周期规则后单次模式应恢复可用");

      // ⑥ 小屏（390×844）：窄屏全屏（宽=视口宽、高=100vh）。
      await admin.page.setViewportSize({ width: 390, height: 844 });
      await admin.page.waitForTimeout(400);
      const small = await drawer.boundingBox();
      assert(small && Math.abs(small.width - 390) <= 2, "窄屏抽屉必须全宽，实际 " + JSON.stringify(small));
      assert(Math.abs(small.height - 844) <= 2, "窄屏抽屉必须满高，实际 " + JSON.stringify(small));
      await admin.shot("models-upstream-drawer-small");

      // ⑦ 未保存离开提示：周期草稿未提交时点「取消」先确认。
      await drawer.getByRole("button", { name: "取消", exact: true }).click();
      const discard = admin.page.getByRole("alertdialog");
      await discard.waitFor({ state: "visible", timeout: 5000 });
      await discard.getByRole("button", { name: "放弃修改", exact: true }).click();
      await drawer.waitFor({ state: "hidden", timeout: 5000 });
      admin.assertNoNewErrors(from, "上游模型抽屉");
      return "大屏 820×900 满高贴右、内容滚动底栏固定、脏标记/恢复、单次与周期互斥+唯一解除、小屏 390 全宽、未保存离开确认";
    } finally {
      await cleanup();
    }
  });

  /* ---------- 模型试验 ---------- */
  const PLAYGROUND_PARAMS = [
    "system prompt", "API 密钥", "流式", "temperature", "top_p", "top_k",
    "frequency_penalty", "presence_penalty", "seed", "max_tokens", "max_completion_tokens",
    "stop", "n", "response_format", "logprobs", "top_logprobs", "user", "思考档位",
    "额外请求字段",
  ];

  await test("playground.params", "模型试验 20 项参数齐全", async () => {
    await admin.visit("/playground", "模型试验");
    // 「高级」分组默认折叠（params-panel.tsx ParamGroup defaultOpen=false），先展开再读 innerText
    const advanced = admin.page.getByRole("button", { name: /^高级/ }).first();
    if ((await advanced.count()) > 0) {
      await advanced.click();
      await admin.page.waitForTimeout(250);
    }
    const text = await admin.page.locator("main").first().innerText();
    const lower = text.toLowerCase();
    const missing = PLAYGROUND_PARAMS.filter((param) => !lower.includes(param.toLowerCase()));
    assert(missing.length === 0, "参数面板缺少 " + missing.length + " 项：" + missing.join("、"));
    // 第 20 项是模型选择入口：按钮文案在有选中模型时会变成模型名，用 title 定位
    const modelTrigger = admin.page.locator('button[title="选择对外模型与思考等级"]').first();
    assert((await modelTrigger.count()) > 0, "缺少模型选择入口（button[title=\"选择对外模型与思考等级\"]）");
    await admin.shot("playground-params");
    return PLAYGROUND_PARAMS.length + " 项参数 + 模型选择入口 = " + (PLAYGROUND_PARAMS.length + 1) + " 项";
  });

  await test("playground.actions", "会话复制/删除/重试按钮存在", async () => {
    await admin.visit("/playground", "模型试验");
    const missing = [];
    for (const label of ["复制会话", "删除会话", "重试最近一轮"]) {
      const count = await admin.page.locator('[aria-label="' + label + '"]').count();
      if (count === 0) missing.push(label);
    }
    assert(missing.length === 0, "缺少会话操作按钮：" + missing.join("、"));
    await admin.shot("playground-session-actions");
    return "复制/删除/重试按钮均在 DOM 中";
  });

  await test("playground.model-dialog", "模型选择对话框可打开且可搜索", async () => {
    await admin.visit("/playground", "模型试验");
    const trigger = admin.page.locator('button[title="选择对外模型与思考等级"]').first();
    assert((await trigger.count()) > 0, "找不到模型选择入口（button[title=\"选择对外模型与思考等级\"]）");
    await trigger.click();
    const dialog = admin.page.locator('[role="dialog"]').last();
    await dialog.waitFor({ state: "visible", timeout: 5000 });
    const text = await dialog.innerText();
    assert(/搜索|模型/.test(text), "模型对话框没有搜索框或模型列表");
    const search = dialog.locator('input[placeholder*="搜索"]');
    assert((await search.count()) > 0, "模型对话框缺少搜索输入框");
    await admin.shot("playground-model-dialog");
    await admin.page.keyboard.press("Escape");
    await dialog.waitFor({ state: "hidden", timeout: 4000 }).catch(() => {});
    return "对话框可打开并可搜索";
  });

  /* ---------- 设置 ---------- */
  await test("settings.groups", "运营设置·系统参数分组齐全", async () => {
    const visited = await admin.visit("/ops-settings/system", "运营设置·系统参数");
    const missing = ["计量与货币", "时区与时间", "日志与留存", "默认限流参数", "运行信息"].filter((g) => !visited.text.includes(g));
    assert(missing.length === 0, "运营设置缺少分组：" + missing.join("、"));
    await admin.shot("settings-groups");
    return "4 个可编辑分组 + 运行信息均在";
  });

  await test("settings.ia", "设置拆分为「用户设置 / 运营设置」并含连接地址", async () => {
    const visited = await admin.visit("/settings", "设置");
    const missing = ["用户设置", "运营设置", "连接地址"].filter((keyword) => !visited.text.includes(keyword));
    if (missing.length > 0) {
      throw new MissingError("设置页缺少：" + missing.join("、") + "（当前仍是旧的系统设置分组）");
    }
    await admin.shot("settings-ia");
    return "用户设置/运营设置/连接地址 均存在";
  });

  /* ---------- 信息架构（spec 目标态） ---------- */
  await test("nav.spec-labels", "导航术语为 模型试验/上游管理/连接密钥/价目管理（公开模型为模型管理 Tab）", async () => {
    await admin.ensureAuthed();
    const links = await admin.navLinks();
    const labels = links.map((l) => l.label);
    const required = ["模型试验", "上游管理", "连接密钥", "价目管理"];
    const missing = required.filter((label) => !labels.includes(label));
    assert(missing.length === 0, "导航缺少：" + missing.join("、") + "；当前为 " + labels.join("/"));
    for (const old of ["游乐场", "客户端密钥", "上游"]) {
      assert(!labels.includes(old), "导航仍用旧术语：" + old);
    }
    return "术语与 spec 一致；公开模型在模型管理 Tab";
  });

  await test("availability.removed", "可用性不再作为独立导航页", async () => {
    await admin.ensureAuthed();
    const links = await admin.navLinks();
    const hit = links.find((l) => l.href === "/availability" || l.label === "可用性");
    if (hit) throw new MissingError("侧栏仍有「可用性」入口：" + hit.href + "（应并入模型管理的关闭/启用/冷却/解除）");
    return "无独立可用性入口";
  });

  /* ---------- 普通用户 ---------- */
  const user = await openSession(browser, { role: "user", ...SESSION_OPTIONS });
  user.cred = USER_CRED;
  let userLoggedIn = false;

  await test("user.nav-hidden", "普通用户看不到成本/管理员/用户管理入口", async () => {
    const outcome = await user.login(USER_CRED);
    if (!outcome.ok) throw new SkipError("普通用户 " + USER_CRED.user + " 登录失败：" + outcome.message + "（seed 提供 wangwu/admin12345，可用 --user 覆盖）");
    userLoggedIn = true;
    await user.settle();
    const links = await user.navLinks();
    const hrefs = links.map((l) => l.href);
    const forbidden = ["/cost", "/admins", "/users"].filter((href) => hrefs.includes(href));
    assert(forbidden.length === 0, "普通用户侧栏出现受限入口：" + forbidden.join("、"));
    assert(hrefs.includes("/revenue") || hrefs.includes("/settings"), "普通用户没有「营收（用户）」入口，billing:spend 应可见");
    await user.shot("user-nav");
    return "可见导航：" + links.map((l) => l.label).join("/");
  });

  await test("user.cost-forbidden", "普通用户看不到运营成本，/admins 被前端拦截", async () => {
    if (!userLoggedIn) {
      const outcome = await user.login(USER_CRED);
      userLoggedIn = outcome.ok;
    }
    await user.ensureAuthed();
    assert(userLoggedIn, "普通用户未登录，跳过");
    // /cost 已并入 /bills：普通用户访问应被重定向到账单页，且页面不出现运营成本
    {
      const from = user.consoleErrors.length;
      await user.page.goto(BASE_URL + "/cost", { waitUntil: "domcontentloaded" });
      await user.settle();
      const path = new URL(user.page.url()).pathname;
      assert(path.startsWith("/bills"), "/cost 未重定向到账单页，实际 " + path);
      const text = await user.mainText();
      assert(!text.includes("成本（运营）"), "普通用户在账单页看到了「成本（运营）」");
      user.assertNoNewErrors(from, "/cost");
      await user.shot("user-cost-redirect");
    }
    {
      const from = user.consoleErrors.length;
      await user.page.goto(BASE_URL + "/admins", { waitUntil: "domcontentloaded" });
      await user.settle();
      const text = await user.mainText();
      assert(text.includes("没有访问权限"), "/admins 未显示「没有访问权限」");
      user.assertNoNewErrors(from, "/admins");
      await user.shot("user-forbidden-admins");
    }
    return "运营成本不可见 · /admins 显示没有访问权限";
  });

  await test("user.api-permissions", "普通用户后端无 billing:cost，成本接口 403", async () => {
    await user.ensureAuthed();
    assert(userLoggedIn, "普通用户未登录，跳过");
    const me = await user.apiGet("/admin/auth/me");
    assert(me.status === 200, "/admin/auth/me 返回 " + me.status);
    const permissions = (me.body && me.body.permissions) || [];
    assert(!permissions.includes("billing:cost"), "普通用户 permissions 含 billing:cost：" + permissions.join(","));
    assert(permissions.includes("billing:spend"), "普通用户缺少 billing:spend");
    assert(!permissions.includes("users:read"), "普通用户 permissions 含 users:read");
    const cost = await user.apiGet("/admin/cost/entries");
    assert(cost.status === 403, "普通用户访问 /admin/cost/entries 返回 " + cost.status + "，应 403");
    const revenue = await user.apiGet("/admin/charge/entries");
    assert(revenue.status === 200, "普通用户访问 /admin/charge/entries 返回 " + revenue.status + "，应 200");
    return "permissions " + permissions.length + " 项 · cost 403 · charge 200";
  });

  const agent = await openSession(browser, { role: "agent", ...SESSION_OPTIONS });
  agent.cred = AGENT_CRED;
  await test("agent.permissions", "代理用户可管用户但看不到成本", async () => {
    const outcome = await agent.login(AGENT_CRED);
    if (!outcome.ok) throw new SkipError("代理用户 " + AGENT_CRED.user + " 登录失败：" + outcome.message + "（seed 提供 lisi/admin12345，可用 --agent 覆盖）");
    await agent.settle();
    const me = await agent.apiGet("/admin/auth/me");
    const permissions = (me.body && me.body.permissions) || [];
    assert(permissions.includes("users:create"), "代理用户缺少 users:create");
    assert(permissions.includes("billing:subtree"), "代理用户缺少 billing:subtree");
    assert(!permissions.includes("billing:cost"), "代理用户不应有 billing:cost");
    const links = await agent.navLinks();
    const hrefs = links.map((l) => l.href);
    assert(hrefs.includes("/users"), "代理用户侧栏缺少「用户」入口");
    assert(!hrefs.includes("/cost"), "代理用户侧栏不应出现「成本（运营）」");
    await agent.shot("agent-nav");
    return "users:create + billing:subtree，无 billing:cost";
  });

  await test("api.switches", "策略/护栏/MCP 接口可读（真实可编辑的数据源）", async () => {
    await admin.ensureAuthed();
    for (const apiPath of ["/admin/policies", "/admin/guardrails", "/admin/mcp-servers"]) {
      const response = await admin.apiGet(apiPath);
      assert(response.status === 200, apiPath + " 返回 " + response.status);
    }
    return "policies / guardrails / mcp-servers 均 200";
  });

  await browser.close();

  const counts = summary();
  writeReport(null);
  console.log("");
  console.log("==================================================");
  console.log("PASS " + counts.pass + " · FAIL " + counts.fail + " · PENDING " + counts.pending + " · SKIP " + counts.skip);
  if (counts.fail > 0) {
    console.log("失败清单：");
    for (const r of results.filter((item) => item.status === "fail")) {
      console.log("  ✗ " + r.id + " " + r.title);
      console.log("    " + r.detail);
      for (const file of r.evidence) console.log("    证据：" + file);
    }
  }
  if (counts.pending > 0 && !STRICT) console.log("PENDING 是已知未合并 ticket 的目标态检查；发布前用 --strict 复查。");
  const failed = counts.fail > 0 || (STRICT && (counts.pending > 0 || counts.skip > 0));
  process.exit(failed ? 1 : 0);
}

main().catch((error) => {
  console.error("验收脚本异常：" + (error && error.stack ? error.stack : error));
  try {
    writeReport(String(error && error.message ? error.message : error));
  } catch {
    // 报告写失败也要保持非零退出
  }
  process.exit(2);
});
