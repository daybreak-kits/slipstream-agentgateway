/**
 * ops/checks 共享工具：参数解析、时间戳、账号、Playwright 启动、登录、console 采集。
 *
 * acceptance_browser.mjs 与 interaction_audit.mjs 共用同一套实现，避免两份
 * CLI/登录/console 过滤逻辑随修改漂移（见 docs/ACCEPTANCE.md 退出码约定）。
 */
import path from "node:path";
import { createRequire } from "node:module";

/** 仓库根不保留 node_modules：浏览器检查依赖 web 包声明的 playwright-core。 */
const webRequire = createRequire(new URL("../../../web/package.json", import.meta.url));

export function parseFlags(argv = process.argv.slice(2)) {
  const flags = new Map();
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) continue;
    const body = token.slice(2);
    const eq = body.indexOf("=");
    if (eq >= 0) flags.set(body.slice(0, eq), body.slice(eq + 1));
    else if (i + 1 < argv.length && !argv[i + 1].startsWith("--")) flags.set(body, argv[i + 1]);
    else flags.set(body, "true");
  }
  return flags;
}

export function stamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + "-" + pad(d.getHours()) + pad(d.getMinutes()) + pad(d.getSeconds());
}

/** 解析 --admin user:pass；只有用户名时沿用 fallback.pass。 */
export function parseCred(raw, fallback) {
  const text = String(raw || "").trim();
  if (!text) return fallback;
  const idx = text.indexOf(":");
  if (idx < 0) return { user: text, pass: fallback.pass };
  return { user: text.slice(0, idx), pass: text.slice(idx + 1) };
}

/** 演示种子账号：acceptance 与 interaction_audit 默认值保持一致。 */
export const DEFAULT_CREDS = {
  admin: { user: "admin", pass: "admin12345" },
  user: { user: "wangwu", pass: "admin12345" },
  agent: { user: "lisi", pass: "admin12345" },
};

export async function loadPlaywright() {
  for (const name of ["playwright", "playwright-core"]) {
    try {
      const mod = await import(name);
      if (mod && mod.chromium) return { chromium: mod.chromium, module: name };
    } catch {
      // 仓库根没有 node_modules 时，回退到 web 包声明的依赖
    }
    try {
      const mod = webRequire(name);
      if (mod && mod.chromium) return { chromium: mod.chromium, module: name };
    } catch {
      // 继续尝试下一个包
    }
  }
  return null;
}

/** 启动浏览器：优先显式 --channel，其次依赖自带 chromium，再退回本机 Edge/Chrome。 */
export async function launchBrowser(playwright, { channel = "", headed = false, executablePath = "" } = {}) {
  const attempts = [];
  if (channel) attempts.push({ channel });
  if (playwright.module === "playwright") attempts.push({});
  attempts.push({ channel: "msedge" }, { channel: "chrome" }, {});
  if (executablePath) attempts.push({ executablePath });
  const errors = [];
  for (const extra of attempts) {
    try {
      const options = { headless: !headed, args: ["--disable-dev-shm-usage"], ...extra };
      const browser = await playwright.chromium.launch(options);
      return { browser, options };
    } catch (error) {
      errors.push(JSON.stringify(extra) + " -> " + String(error.message || error).split("\n")[0].slice(0, 200));
    }
  }
  throw new Error("浏览器启动失败：" + errors.join(" | "));
}

/**
 * 采集 console error / 未捕获异常。两个脚本共用同一条排除规则：
 * React DevTools 提示、ResizeObserver 循环告警、未登录时 /admin/auth/me 的 401。
 */
export function attachConsoleCollector(page, { ignore = [], allowUnauthorized = false } = {}) {
  const consoleErrors = [];
  const pageErrors = [];
  page.on("console", (msg) => {
    if (msg.type() !== "error") return;
    const text = msg.text();
    if (ignore.some((item) => text.includes(item))) return;
    const location = typeof msg.location === "function" ? msg.location() : null;
    const url = location && location.url ? location.url : "";
    if (url.includes("/admin/auth/me") && text.includes("401")) return;
    // 登录页在未登录状态探测 /admin/auth/me，Chromium 的通用资源 401 文案不带 URL。
    if (allowUnauthorized && /401|Unauthorized/.test(text)) return;
    consoleErrors.push(text);
  });
  page.on("pageerror", (error) => pageErrors.push(String((error && error.message) || error)));
  return { consoleErrors, pageErrors };
}

export async function submitLogin(page, cred) {
  await page.fill("#login-username", cred.user);
  await page.fill("#login-password", cred.pass);
  await page.click('button[type="submit"]');
}

/** 等登录结果：离开 /login 即成功；停留在登录页且有错误文案即失败。 */
export async function waitLoginOutcome(page, { timeoutMs = 12000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const url = new URL(page.url());
    if (!url.pathname.startsWith("/login")) return { ok: true };
    const err = page.locator("p.text-danger-text");
    if ((await err.count()) > 0) {
      const message = (await err.first().innerText()).trim();
      if (message) return { ok: false, message };
    }
    await page.waitForTimeout(200);
  }
  return { ok: false, message: "登录超时 " + Math.round(timeoutMs / 1000) + "s（检查 API 3700、种子账号与 CORS/cookie）" };
}

/** 打开 /login 提交账号并等待结果；baseUrl 为空时使用 Playwright context 的 baseURL。 */
export async function login(page, cred, { baseUrl = "", timeoutMs = 12000 } = {}) {
  await page.goto(baseUrl.replace(/\/$/, "") + "/login", { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(300);
  await submitLogin(page, cred);
  return await waitLoginOutcome(page, { timeoutMs });
}

