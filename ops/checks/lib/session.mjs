/**
 * ops/checks：一个「已登录的浏览器会话」= 上下文 + 登录 + 访问 + 断言 + 取证。
 *
 * 验收（acceptance_browser.mjs）与后续检查脚本共用这一份实现，避免每个脚本各自
 * 重写 openSession / gotoLogin / submitLogin / loginAs / ensureAuthed / settle /
 * mainText / assertPageSane / navLinks / apiGet / visit。
 *
 *   const s = await openSession(browser, { role: "admin", base, apiBase, outDir });
 *   await s.visit("/models");       // 自愈登录 -> goto -> settle -> 健康断言 -> console 差分
 *   await s.assertSane("模型管理");  // 只断言当前页
 *   await s.shot("models");         // 截图并登记证据（evidence 回调）
 *   s.errorsSince(mark);            // console / pageerror 差分
 *   await s.apiGet("/admin/health");
 *
 * 登录原语仍由 lib/cli.mjs 提供（submitLogin / waitLoginOutcome）；这里只做编排。
 * 业务断言（25 条验收场景）留在 acceptance_browser.mjs：它们是产品契约，不是基建。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  attachConsoleCollector,
  stamp,
  submitLogin as fillLogin,
  waitLoginOutcome as awaitLoginOutcome,
} from "./cli.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** 仓库根目录：ops/checks/lib -> ../../.. */
export const REPO_ROOT = path.resolve(HERE, "..", "..", "..");

/** 两个脚本共用的 console 排除规则（React DevTools 提示、ResizeObserver 循环告警）。 */
export const DEFAULT_CONSOLE_IGNORE = ["Download the React DevTools", "ResizeObserver loop"];

const DEFAULT_BASE = "http://localhost:3700";
const DEFAULT_TIMEOUT_MS = 15000;
const LOGIN_TIMEOUT_MS = 12000;

/** 会话层的断言错误：与业务脚本自己的错误类型互不影响，统一按「失败」计。 */
export class SessionError extends Error {
  constructor(message) {
    super(message);
    this.name = "SessionError";
  }
}

export function safeSlug(value) {
  return String(value).replace(/[^A-Za-z0-9]+/g, "-").replace(/^-+|-+$/g, "").toLowerCase() || "root";
}

/** 按 --text-ignore 清掉已知的干扰文案（错误边界/NaN/undefined 断言前用）。 */
export function cleanedText(text, textIgnore) {
  return textIgnore ? String(text).replace(textIgnore, "") : String(text);
}

export function tailConsole(list, label) {
  return list.slice(-3).map((line) => "[" + label + "] " + line.slice(0, 300)).join(" | ");
}

/** mark 既接受 mark() 的对象，也接受旧的「console 下标」数字，便于脚本渐进迁移。 */
function markToIndexes(mark) {
  if (mark && typeof mark === "object") {
    return { console: Number(mark.console) || 0, page: Number(mark.page) || 0 };
  }
  return { console: Number(mark) || 0, page: 0 };
}

/** 页面内探测：骨架屏数量 + 可见可操作控件数量（交互审计的加载态判定）。 */
function probeMain(selector) {
  const main = document.querySelector("main");
  if (!main) return { skeletons: 1, controls: 0 };
  const skeletons = main.querySelectorAll(".animate-pulse, [aria-busy='true']").length;
  let controls = 0;
  for (const node of Array.from(main.querySelectorAll(selector))) {
    if (node.getAttribute("aria-hidden") === "true" || node.closest('[aria-hidden="true"]')) continue;
    const style = getComputedStyle(node);
    if (style.visibility === "hidden" || style.display === "none") continue;
    const rect = node.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) controls += 1;
  }
  return { skeletons, controls };
}

/**
 * 等页面稳定。默认口径（验收）：networkidle + 300ms 静默 + main 可见。
 * requireControls=true 时（交互审计）再等到骨架屏消失且出现可操作控件，最多 10s，
 * 避免把冷启动/权限校验中的加载态当成「没有控件」。evaluate 可注入带超时兜底的实现。
 */
export async function settle(page, options = {}) {
  const {
    timeoutMs = 8000,
    quietMs = 300,
    mainTimeoutMs = 6000,
    requireControls = false,
    controlSelector = "",
    skeletonTimeoutMs = 10000,
    pollMs = 300,
    evaluate = null,
  } = options || {};
  await page.waitForLoadState("networkidle", { timeout: timeoutMs }).catch(() => {});
  if (quietMs > 0) await page.waitForTimeout(quietMs);
  await page.locator("main").first().waitFor({ state: "visible", timeout: mainTimeoutMs }).catch(() => {});
  if (!requireControls) return;
  const run = evaluate || ((fn, arg) => page.evaluate(fn, arg));
  const deadline = Date.now() + skeletonTimeoutMs;
  while (Date.now() < deadline) {
    const state = await Promise.resolve(run(probeMain, controlSelector)).catch(() => ({ skeletons: 0, controls: 1 }));
    if (state && state.skeletons === 0 && state.controls > 0) return;
    await page.waitForTimeout(pollMs);
  }
}

export async function mainText(page) {
  return await page.locator("main").first().innerText().catch(() => "");
}

/** 页面健康断言：错误边界、NaN/undefined、白屏、权限校验卡住。返回清理后的正文。 */
export async function assertPageSane(page, label, options = {}) {
  const name = label || "页面";
  const text = cleanedText(await mainText(page), options.textIgnore);
  if (text.includes("页面渲染失败")) throw new SessionError(name + "：命中错误边界「页面渲染失败」");
  if (/\bNaN\b/.test(text)) throw new SessionError(name + "：页面出现 NaN");
  if (/\bundefined\b/.test(text)) throw new SessionError(name + "：页面出现 undefined");
  if (text.trim().length <= 10) throw new SessionError(name + "：内容区为空（可能白屏）");
  if ((await page.locator("text=正在校验权限").count()) !== 0) throw new SessionError(name + "：权限校验卡住（me 接口未返回）");
  return text;
}

/** console error 差分（自 fromIndex 起）+ 未捕获异常（沿用历史口径：总量为 0）。 */
export function assertNoNewErrors(session, fromIndex, label) {
  const name = label || "页面";
  const fresh = session.consoleErrors.slice(markToIndexes(fromIndex).console);
  if (fresh.length > 0) throw new SessionError(name + "：console error " + fresh.length + " 条：" + tailConsole(fresh, name));
  if (session.pageErrors.length > 0) throw new SessionError(name + "：未捕获异常：" + session.pageErrors.join(" | "));
}

export async function navLinks(page) {
  return await page.locator('nav[aria-label="主导航"] a').evaluateAll((els) =>
    els.map((el) => ({ href: el.getAttribute("href") || "", label: (el.textContent || "").trim() })),
  );
}

/** 打开 /login 提交账号并等待结果。 */
export async function loginAs(session, cred) {
  await session.gotoLogin();
  await session.submitLogin(cred);
  const outcome = await session.waitLoginOutcome();
  if (outcome.ok) {
    session.cred = cred;
    session.authed = true;
  }
  return outcome;
}

/**
 * --only 局部运行可能先执行依赖登录态的检查（如 playground.params）：
 * 导航前自愈式登录一次，避免把「未登录导致的重定向/空内容」误报成页面白屏。
 */
export async function ensureAuthed(session) {
  if (session.authed) return;
  if (!session.cred) return;
  const me = await session.apiGet("/admin/auth/me");
  if (me.status === 200) {
    session.authed = true;
    return;
  }
  const outcome = await loginAs(session, session.cred);
  if (!outcome.ok) throw new SessionError("自动登录失败：" + outcome.message);
  session.authed = true;
}

/**
 * 打开一个会话。
 * @param {import("playwright").Browser | any} browser
 * @param {string | {
 *   role?: string, who?: string,
 *   base?: string, baseUrl?: string, apiBase?: string, apiUrl?: string,
 *   outDir?: string, evidence?: (relPath: string, name: string) => void,
 *   consoleIgnore?: string[], textIgnore?: RegExp | null,
 *   viewport?: { width: number, height: number }, locale?: string,
 *   defaultTimeout?: number, allowUnauthorized?: boolean, contextOptions?: object,
 * }} [options] 传字符串等价于 { role }
 */
export async function openSession(browser, options = {}) {
  const opts = typeof options === "string" ? { role: options } : options || {};
  const role = opts.role || opts.who || "admin";
  const base = String(opts.base || opts.baseUrl || process.env.ACCEPTANCE_BASE_URL || DEFAULT_BASE).replace(/\/$/, "");
  const apiBase = String(opts.apiBase || opts.apiUrl || process.env.ACCEPTANCE_API_URL || base).replace(/\/$/, "");
  const outDir = opts.outDir || opts.out || path.join(REPO_ROOT, "ops", "checks", ".logs", "session", stamp());
  const consoleIgnore = opts.consoleIgnore || DEFAULT_CONSOLE_IGNORE;
  const textIgnore = opts.textIgnore || null;
  const evidence = typeof opts.evidence === "function" ? opts.evidence : null;
  const viewport = opts.viewport || { width: 1440, height: 900 };
  const locale = opts.locale || "zh-CN";
  const defaultTimeout = opts.defaultTimeout || DEFAULT_TIMEOUT_MS;

  const context = await browser.newContext({
    viewport,
    locale,
    baseURL: base,
    ...(opts.contextOptions || {}),
  });
  const page = await context.newPage();
  page.setDefaultTimeout(defaultTimeout);
  const { consoleErrors, pageErrors } = attachConsoleCollector(page, {
    ignore: [...consoleIgnore],
    allowUnauthorized: Boolean(opts.allowUnauthorized),
  });

  async function gotoLogin() {
    await page.goto(base + "/login", { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(300);
  }

  async function submitLogin(cred) {
    await fillLogin(page, cred);
  }

  async function waitLoginOutcome(timeoutMs = LOGIN_TIMEOUT_MS) {
    return awaitLoginOutcome(page, { timeoutMs });
  }

  async function login(cred) {
    await gotoLogin();
    await submitLogin(cred);
    const outcome = await waitLoginOutcome();
    if (outcome.ok) {
      session.cred = cred;
      session.authed = true;
    }
    return outcome;
  }

  async function ensureAuthedHere() {
    return ensureAuthed(session);
  }

  async function apiGet(apiPath) {
    const response = await page.request.get(apiBase + apiPath, { headers: { Accept: "application/json" } });
    const body = await response.json().catch(() => null);
    return { status: response.status(), body };
  }

  function mark() {
    return { console: consoleErrors.length, page: pageErrors.length };
  }

  function errorsSince(fromMark) {
    const from = markToIndexes(fromMark);
    return { consoleErrors: consoleErrors.slice(from.console), pageErrors: pageErrors.slice(from.page) };
  }

  async function visit(target, label) {
    await ensureAuthedHere();
    const name = label || target;
    const from = consoleErrors.length;
    const response = await page.goto(base + target, { waitUntil: "domcontentloaded", timeout: 30000 });
    await settle(page, { quietMs: 300 });
    const text = await assertPageSane(page, name, { textIgnore });
    assertNoNewErrors(session, from, name);
    return { text, status: response ? response.status() : 0 };
  }

  async function assertSane(label) {
    return await assertPageSane(page, label, { textIgnore });
  }

  async function shot(name, shotOptions = {}) {
    const dir = shotOptions.outDir || outDir;
    const file = path.join(dir, safeSlug(name) + ".png");
    try {
      fs.mkdirSync(dir, { recursive: true });
      await page.screenshot({ path: file, fullPage: shotOptions.fullPage !== false });
      const rel = path.relative(REPO_ROOT, file).replace(/\\/g, "/");
      if (evidence) evidence(rel, name);
      return rel;
    } catch {
      // 截图失败不改变验收结论
      return "";
    }
  }

  const session = {
    role,
    who: role,
    base,
    apiBase,
    page,
    context,
    consoleErrors,
    pageErrors,
    cred: null,
    authed: false,
    gotoLogin,
    submitLogin,
    waitLoginOutcome,
    login,
    ensureAuthed: ensureAuthedHere,
    settle: () => settle(page, { quietMs: 300 }),
    mainText: () => mainText(page),
    visit,
    assertSane,
    mark,
    errorsSince,
    assertNoNewErrors: (from, label) => assertNoNewErrors(session, from, label),
    shot,
    apiGet,
    navLinks: () => navLinks(page),
    close: () => context.close(),
  };
  return session;
}
