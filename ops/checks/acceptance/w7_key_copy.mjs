#!/usr/bin/env node
/**
 * W7 ticket 07 验收：连接密钥自助签发与安全复制（spec「交互与界面-密钥」/ User Story 45-48）。
 *
 * 覆盖 spec 必测矩阵里的密钥一行 + 复制一行：
 *   1. 客户新建密钥弹框不出现用户选择（固定为自己），admin 保留代签入口（选用户）；
 *   2. navigator.clipboard 为 undefined 时复制仍成功（textarea + execCommand 回退），
 *      且不出现未捕获异常；
 *   3. clipboard 存在但 writeText 被拒（NotAllowedError）时同样落入回退并成功；
 *   4. 三级回退全部失败时 toast 明确报错「复制失败」，不产生未捕获异常；
 *   5. 只在写入成功后提示「已复制」（成功文案只出现在回退成功的场景）。
 *
 * 运行：
 *   node ops/checks/acceptance/w7_key_copy.mjs               # 自起隔离站点：API 3892 + web 3893
 *   node ops/checks/acceptance/w7_key_copy.mjs --base-url http://127.0.0.1:3893
 *   node ops/checks/acceptance/w7_key_copy.mjs --headed
 *
 * 前提：web/dist 已构建（cd web && npx vite build）。脚本自管 seed/服务进程，结束后全部清理；
 * 使用临时 SQLite 与临时 ag-config，绝不触碰 3700/3600 与主仓库工作树。
 *
 * 退出码：0 全部 PASS；1 有 FAIL；2 环境/依赖未就绪。
 * 证据：ops/checks/.logs/acceptance/w7-key-copy-<时间戳>/（report.md + *.png，.logs/ 不入库）。
 */
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { launchBrowser, loadPlaywright, parseCred, parseFlags, stamp, waitLoginOutcome } from "../lib/cli.mjs";
import { openSession, settle } from "../lib/session.mjs";
import { createIsolatedSite } from "../lib/isolated-site.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..", "..", "..");
const WEB_ROOT = path.join(ROOT, "web");
const API_ROOT = path.join(ROOT, "api");

const flags = parseFlags(process.argv.slice(2));
const API_PORT = Number(flags.get("api-port") || process.env.W7_KEY_COPY_API_PORT || 3892);
const WEB_PORT = Number(flags.get("web-port") || process.env.W7_KEY_COPY_WEB_PORT || 3893);
const HEADED = flags.has("headed");
const CHANNEL = flags.get("channel") || process.env.PLAYWRIGHT_CHANNEL || "";
const REUSE = Boolean(flags.get("base-url"));
const BASE_URL = (flags.get("base-url") || "").replace(/\/$/, "");
const ADMIN_CRED = parseCred(flags.get("admin") || process.env.W7_ADMIN, { user: "admin", pass: "admin12345" });
const OUT = path.resolve(flags.get("out") || path.join(ROOT, "ops", "checks", ".logs", "acceptance", "w7-key-copy-" + stamp()));
fs.mkdirSync(OUT, { recursive: true });

const COPY_BTN = '[aria-label="复制密钥明文"]';

const results = [];
let currentEvidence = [];
let browser = null;
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
 * 1. 隔离站点：API 3892 + web 3893（静态托管 + /admin、/api 反代）
 * ------------------------------------------------------------------ */

const isolatedSite = createIsolatedSite({
  apiRoot: API_ROOT,
  webRoot: WEB_ROOT,
  apiPort: API_PORT,
  webPort: WEB_PORT,
  outDir: OUT,
  dbName: "w7-key-copy.db",
  secretKey: "w7-key-copy-acceptance-only",
  adminCred: ADMIN_CRED,
});

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

/** 等待含指定文案的 sonner toast 出现。 */
async function waitToast(page, text, timeoutMs = 4000) {
  const toast = page.locator('[data-sonner-toast]', { hasText: text }).first();
  await toast.waitFor({ state: "visible", timeout: timeoutMs });
  return true;
}

/* ------------------------------------------------------------------ *
 * 3. 验收项
 * ------------------------------------------------------------------ */

/** 复制回退场景共用：起会话 →（可选）注入剪贴板覆盖脚本 → 登录 → 打开连接密钥页。 */
async function openKeysSession(base, clipboardOverride) {
  const session = await openSession(browser, { base, apiBase: base, role: "admin" });
  if (clipboardOverride) await session.context.addInitScript(clipboardOverride);
  const outcome = await session.login(ADMIN_CRED);
  assert(outcome.ok, "登录失败：" + outcome.message);
  await session.visit("/client-keys", "连接密钥");
  const copyBtn = session.page.locator(COPY_BTN).first();
  await copyBtn.waitFor({ state: "visible", timeout: 15000 });
  return session;
}

async function runCopyChecks(base) {
  // ---- 复制回退场景 1：navigator.clipboard 为 undefined（非安全上下文模拟） ----
  await test("copy.undefined.fallback", "clipboard 为 undefined 时回退 execCommand 复制成功", async () => {
    const session = await openKeysSession(base, () => {
      Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true });
    });
    try {
      const copyBtn = session.page.locator(COPY_BTN).first();
      await shot(session.page, "copy-undefined");
      await copyBtn.click();
      await waitToast(session.page, "密钥已复制");
      const errors = session.errorsSince({ console: 0, page: 0 });
      assert(errors.pageErrors.length === 0, "不得出现未捕获异常：" + errors.pageErrors.join(" | "));
      return "clipboard=undefined → 回退成功，toast「密钥已复制」";
    } finally {
      await session.close();
    }
  });

  // ---- 复制回退场景 2：clipboard 存在但 writeText 被拒（NotAllowedError） ----
  await test("copy.denied.fallback", "clipboard 存在但 writeText 被拒（NotAllowedError）时回退成功", async () => {
    const session = await openKeysSession(base, () => {
      Object.defineProperty(navigator, "clipboard", {
        value: { writeText: () => Promise.reject(new DOMException("denied", "NotAllowedError")) },
        configurable: true,
      });
    });
    try {
      const copyBtn = session.page.locator(COPY_BTN).first();
      await shot(session.page, "copy-denied");
      await copyBtn.click();
      await waitToast(session.page, "密钥已复制");
      const errors = session.errorsSince({ console: 0, page: 0 });
      assert(errors.pageErrors.length === 0, "不得出现未捕获异常：" + errors.pageErrors.join(" | "));
      return "writeText 被拒 → 回退成功，toast「密钥已复制」";
    } finally {
      await session.close();
    }
  });

  // ---- 三级回退全部失败：明确错误 toast，不产生未捕获异常 ----
  await test("copy.total-fail.error", "clipboard 缺失且 execCommand 失败时 toast 明确错误，无未捕获异常", async () => {
    const session = await openKeysSession(base, () => {
      Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true });
      document.execCommand = () => false;
    });
    try {
      const copyBtn = session.page.locator(COPY_BTN).first();
      await copyBtn.click();
      await waitToast(session.page, "复制失败");
      const errors = session.errorsSince({ console: 0, page: 0 });
      assert(errors.pageErrors.length === 0, "不得出现未捕获异常：" + errors.pageErrors.join(" | "));
      await shot(session.page, "copy-total-fail");
      return "两级都失败 → toast「复制失败」，无未捕获异常";
    } finally {
      await session.close();
    }
  });

  // ---- 客户新建密钥：无用户选择，固定为自己 ----
  await test("customer.issue.fixed-user", "客户新建密钥弹框不出现用户选择（固定为自己）", async () => {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      locale: "zh-CN",
      baseURL: base,
    });
    const page = await context.newPage();
    page.setDefaultTimeout(15000);
    try {
      await page.goto(base + "/login", { waitUntil: "domcontentloaded", timeout: 30000 });
      await page.waitForTimeout(300);
      await page.fill("#login-username", "wangwu");
      await page.fill("#login-password", "admin12345");
      await page.click('button[type="submit"]');
      const outcome = await waitLoginOutcome(page, { timeoutMs: 15000 });
      assert(outcome.ok, "客户登录失败：" + outcome.message);
      await page.goto(base + "/client-keys", { waitUntil: "domcontentloaded", timeout: 30000 });
      await settle(page, { quietMs: 500, requireControls: true, controlSelector: "table" });
      const newKey = page.getByRole("button", { name: "新建密钥" });
      await newKey.waitFor({ state: "visible", timeout: 15000 });
      await newKey.click();
      await page.waitForTimeout(400);
      const dialog = page.locator('[role="dialog"]').first();
      await dialog.waitFor({ state: "visible", timeout: 10000 });
      assert((await page.locator("#issue-user").count()) === 0, "客户弹框不应出现用户选择（#issue-user）");
      const fixed = page.locator("#issue-user-fixed");
      assert((await fixed.count()) === 1, "客户弹框必须固定显示归属用户（#issue-user-fixed）");
      const fixedText = (await fixed.innerText()).trim();
      assert(fixedText.includes("自己"), "固定归属用户文案必须含「自己」：" + fixedText);
      await shot(page, "customer-issue-fixed");
      return "客户弹框无用户选择，归属固定为 " + fixedText;
    } finally {
      await context.close();
    }
  });

  // ---- admin 新建密钥：保留代签入口（用户选择） ----
  await test("admin.issue.user-select", "管理员新建密钥保留代签入口（可选用户）", async () => {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      locale: "zh-CN",
      baseURL: base,
    });
    const page = await context.newPage();
    page.setDefaultTimeout(15000);
    try {
      await page.goto(base + "/login", { waitUntil: "domcontentloaded", timeout: 30000 });
      await page.waitForTimeout(300);
      await page.fill("#login-username", ADMIN_CRED.user);
      await page.fill("#login-password", ADMIN_CRED.pass);
      await page.click('button[type="submit"]');
      const outcome = await waitLoginOutcome(page, { timeoutMs: 15000 });
      assert(outcome.ok, "管理员登录失败：" + outcome.message);
      await page.goto(base + "/client-keys", { waitUntil: "domcontentloaded", timeout: 30000 });
      await settle(page, { quietMs: 500, requireControls: true, controlSelector: "table" });
      const newKey = page.getByRole("button", { name: "新建密钥" });
      await newKey.waitFor({ state: "visible", timeout: 15000 });
      await newKey.click();
      await page.waitForTimeout(400);
      const trigger = page.locator("#issue-user");
      await trigger.waitFor({ state: "visible", timeout: 10000 });
      const triggerText = (await trigger.innerText()).trim();
      assert(triggerText.includes("选择用户"), "代签下拉应显示占位「选择用户」：" + triggerText);
      await shot(page, "admin-issue-select");
      return "管理员弹框保留用户选择（#issue-user，占位「选择用户」）";
    } finally {
      await context.close();
    }
  });
}

/* ------------------------------------------------------------------ *
 * 4. 主流程
 * ------------------------------------------------------------------ */

async function main() {
  if (!REUSE && (API_PORT === 3700 || WEB_PORT === 3700)) {
    console.error("拒绝在 3700 上运行（隔离端口应为 3892/3893）");
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
      base = await isolatedSite.start();
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
    await runCopyChecks(base);
  } catch (error) {
    console.error(String((error && error.message) || error));
    results.push({ id: "run", name: "验收脚本执行", status: "fail", detail: String((error && error.message) || error), evidence: [] });
  } finally {
    if (browser) await browser.close().catch(() => {});
    isolatedSite.stop();
  }

  const failed = results.filter((row) => row.status === "fail");
  const report = [
    "# W7 ticket 07 · 连接密钥自助签发与安全复制 浏览器验收",
    "",
    "- 时间：" + new Date().toISOString(),
    "- 站点：" + base,
    "- 结果：" + (results.length - failed.length) + "/" + results.length + " 通过",
    "",
    ...results.map((row) => "- " + (row.status === "pass" ? "PASS " : "FAIL ") + row.id + "（" + row.ms + "ms）" + (row.detail ? " — " + row.detail : "")),
    "",
  ].join("\n");
  fs.writeFileSync(path.join(OUT, "report.md"), report, "utf8");
  console.log("报告：" + rel(path.join(OUT, "report.md")));
  if (failed.length > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(String((error && error.message) || error));
  process.exitCode = 2;
});