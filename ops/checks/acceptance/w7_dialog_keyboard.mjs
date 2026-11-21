#!/usr/bin/env node
/**
 * W7 ticket 11 验收：弹框统一键盘行为（spec「交互与界面-弹框」/ User Story 41-44）。
 *
 * 覆盖 spec 必测矩阵里的弹框一行：
 *   1. form.enter.submit     表单型弹框里 Enter 触发主操作（只发一次请求）；
 *   2. form.enter.composing  输入法组合中的 Enter 不触发主操作，组合结束后恢复；
 *   3. form.escape.guard     Escape 取消；有未保存改动时先走「放弃修改？」脏数据保护；
 *   4. form.initial.focus    表单型弹框打开后焦点落在第一个输入框；
 *   5. dialog.tab.trap       Tab / Shift+Tab 不跑出弹框；
 *   6. confirm.danger.focus  危险确认默认焦点在「取消」，误按 Enter 不执行删除；
 *   7. dialog.focus.restore  弹框关闭后焦点回到触发按钮；
 *   8. submit.pending.once   提交中重复 Enter 只发一次请求（拦截计数）。
 *
 * 运行：
 *   node ops/checks/acceptance/w7_dialog_keyboard.mjs               # 自起隔离站点：API 3904 + web 3905
 *   node ops/checks/acceptance/w7_dialog_keyboard.mjs --base-url http://127.0.0.1:3905
 *   node ops/checks/acceptance/w7_dialog_keyboard.mjs --headed
 *
 * 前提：web/dist 已构建（cd web && npx vite build）。脚本自管 seed/服务进程，结束后全部清理；
 * 使用临时 SQLite 与临时 ag-config，绝不触碰 3700/3600 与主仓库工作树。
 *
 * 退出码：0 全部 PASS；1 有 FAIL；2 环境/依赖未就绪。
 * 证据：ops/checks/.logs/acceptance/w7-dialog-keyboard-<时间戳>/（report.md + *.png，.logs/ 不入库）。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { launchBrowser, loadPlaywright, parseCred, parseFlags, stamp } from "../lib/cli.mjs";
import { createIsolatedSite } from "../lib/isolated-site.mjs";
import { openSession, settle } from "../lib/session.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..", "..", "..");
const WEB_ROOT = path.join(ROOT, "web");
const API_ROOT = path.join(ROOT, "api");

const flags = parseFlags(process.argv.slice(2));
const API_PORT = Number(flags.get("api-port") || process.env.W7_DIALOG_API_PORT || 3904);
const WEB_PORT = Number(flags.get("web-port") || process.env.W7_DIALOG_WEB_PORT || 3905);
const HEADED = flags.has("headed");
const CHANNEL = flags.get("channel") || process.env.PLAYWRIGHT_CHANNEL || "";
const REUSE = Boolean(flags.get("base-url"));
const BASE_URL = (flags.get("base-url") || "").replace(/\/$/, "");
const ADMIN_CRED = parseCred(flags.get("admin") || process.env.W7_ADMIN, { user: "admin", pass: "admin12345" });
const OUT = path.resolve(flags.get("out") || path.join(ROOT, "ops", "checks", ".logs", "acceptance", "w7-dialog-keyboard-" + stamp()));
fs.mkdirSync(OUT, { recursive: true });

const DIALOG = '[role="dialog"]';
const ALERT_DIALOG = '[role="alertdialog"]';

const results = [];
let currentEvidence = [];
let browser = null;

class CheckError extends Error {}

function assert(condition, message) {
  if (!condition) throw new CheckError(message);
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
 * 1. 隔离站点：API 3904 + web 3905（静态托管 + /admin、/api 反代）
 * ------------------------------------------------------------------ */

const isolatedSite = createIsolatedSite({
  apiRoot: API_ROOT,
  webRoot: WEB_ROOT,
  apiPort: API_PORT,
  webPort: WEB_PORT,
  outDir: OUT,
  dbName: "w7-dialog-keyboard.db",
  secretKey: "w7-dialog-keyboard-acceptance-only",
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

/** 当前焦点元素的可见文案（判断焦点是否落在某个按钮/输入框上）。 */
async function activeText(page) {
  return await page.evaluate(() => {
    const el = document.activeElement;
    if (!el) return "";
    const label = el.getAttribute("aria-label") || el.getAttribute("placeholder") || el.id || "";
    return ((el.textContent || "") + " " + label).trim();
  });
}

/** 焦点是否还在弹框内。 */
async function focusInsideDialog(page) {
  return await page.evaluate(() => {
    const dialog = document.querySelector('[role="dialog"]');
    return Boolean(dialog && document.activeElement && dialog.contains(document.activeElement));
  });
}

/** 等含指定文案的 sonner toast 出现。 */
async function waitToast(page, text, timeoutMs = 5000) {
  const toast = page.locator("[data-sonner-toast]", { hasText: text }).first();
  await toast.waitFor({ state: "visible", timeout: timeoutMs });
  return true;
}

/** 打开用户管理页并进入「新建用户」弹框。 */
async function openCreateUserDialog(session) {
  await session.visit("/users", "用户管理");
  const trigger = session.page.getByRole("button", { name: "新建用户" });
  await trigger.waitFor({ state: "visible", timeout: 15000 });
  await trigger.click();
  // 创建弹框以 #create-user-name 识别：创建成功后还会出现一次性密码弹框，不能把两个弹框混为一谈。
  const dialog = session.page
    .locator('[role="dialog"]')
    .filter({ has: session.page.locator("#create-user-name") });
  await dialog.waitFor({ state: "visible", timeout: 10000 });
  await settle(session.page, { quietMs: 250 });
  return { trigger, dialog };
}

/* ------------------------------------------------------------------ *
 * 3. 验收项
 * ------------------------------------------------------------------ */

async function runChecks(base) {
  const session = await openSession(browser, { base, apiBase: base, role: "admin" });
  try {
    const outcome = await session.login(ADMIN_CRED);
    assert(outcome.ok, "登录失败：" + outcome.message);

    // ---- Enter 提交表单型弹框 ----
    await test("form.enter.submit", "表单型弹框里 Enter 触发主操作（只发一次请求）", async () => {
      let posts = 0;
      const count = (request) => {
        if (request.method() === "POST" && request.url().includes("/admin/users")) posts += 1;
      };
      session.page.on("request", count);
      try {
        const { dialog } = await openCreateUserDialog(session);
        await session.page.fill("#create-user-name", "kbd-check-a");
        await session.page.fill("#create-user-username", "kbd-check-a");
        await session.page.keyboard.press("Enter");
        await waitToast(session.page, "用户已创建");
        assert(posts === 1, "Enter 应只发一次 POST /admin/users，实际 " + posts + " 次");
        // 弹框有 200ms 退场动画：等隐藏而不是立刻数节点。
        await dialog.waitFor({ state: "hidden", timeout: 5000 });
        assert((await dialog.count()) === 0, "提交成功后「新建用户」弹框应关闭");
        // 关掉一次性密码弹框，恢复干净状态
        await session.page.keyboard.press("Escape");
        await session.page.waitForTimeout(400);
        await shot(session.page, "enter-submit");
        return "POST /admin/users × 1，弹框已关闭";
      } finally {
        session.page.off("request", count);
      }
    });

    // ---- 输入法组合中的 Enter 不触发主操作 ----
    await test("form.enter.composing", "输入法组合中的 Enter 不触发主操作，组合结束后恢复", async () => {
      let posts = 0;
      const count = (request) => {
        if (request.method() === "POST" && request.url().includes("/admin/users")) posts += 1;
      };
      session.page.on("request", count);
      try {
        await openCreateUserDialog(session);
        await session.page.fill("#create-user-name", "kbd-compose");
        await session.page.fill("#create-user-username", "kbd-compose");
        // 组合中：先 compositionstart，再发一个不带 isComposing 的 Enter（考察组合状态跟踪）
        await session.page.evaluate(() => {
          const input = document.querySelector("#create-user-name");
          input.focus();
          input.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true, data: "" }));
          input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", bubbles: true, cancelable: true }));
        });
        await session.page.waitForTimeout(500);
        assert(posts === 0, "输入法组合中的 Enter 不应提交，实际发出 " + posts + " 次请求");
        await shot(session.page, "enter-composing");
        // 组合结束后，Enter 恢复主操作
        await session.page.evaluate(() => {
          const input = document.querySelector("#create-user-name");
          input.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true, data: "你" }));
        });
        await session.page.keyboard.press("Enter");
        await session.page.waitForTimeout(900);
        assert(posts === 1, "组合结束后 Enter 应提交一次，实际 " + posts + " 次");
        // 关掉一次性密码弹框，恢复干净状态
        await session.page.keyboard.press("Escape");
        await session.page.waitForTimeout(400);
        return "组合中 0 次请求；组合结束后 1 次请求";
      } finally {
        session.page.off("request", count);
      }
    });

    // ---- Escape 取消 + 脏数据保护 ----
    await test("form.escape.guard", "Escape 取消弹框；有未保存改动时先走「放弃修改？」确认", async () => {
      const { dialog } = await openCreateUserDialog(session);
      await session.page.fill("#create-user-name", "键盘验收乙");
      await session.page.keyboard.press("Escape");
      await session.page.waitForTimeout(400);
      const guard = session.page.locator(ALERT_DIALOG).first();
      await guard.waitFor({ state: "visible", timeout: 5000 });
      const guardText = (await guard.innerText()).trim();
      assert(guardText.includes("放弃修改"), "Escape 应先弹「放弃修改？」确认，实际：" + guardText.slice(0, 80));
      assert(await dialog.isVisible(), "确认框出现时原弹框不应关闭");
      await shot(session.page, "escape-guard");
      // 确认放弃 → 原弹框关闭
      await guard.getByRole("button", { name: "放弃修改" }).click();
      await dialog.waitFor({ state: "hidden", timeout: 5000 });
      const stillOpen = (await dialog.count()) > 0 && (await dialog.isVisible());
      assert(!stillOpen, "确认放弃后原弹框应关闭");
      return "Escape → 「放弃修改？」确认 → 放弃后弹框关闭";
    });

    // ---- 表单型弹框默认焦点在第一个输入框 ----
    await test("form.initial.focus", "表单型弹框打开后焦点落在第一个输入框", async () => {
      await openCreateUserDialog(session);
      const focusedId = await session.page.evaluate(() => (document.activeElement ? document.activeElement.id : ""));
      assert(focusedId === "create-user-name", "焦点应落在第一个输入框 #create-user-name，实际：" + focusedId);
      await shot(session.page, "initial-focus");
      return "activeElement=#create-user-name";
    });

    // ---- Tab / Shift+Tab 焦点陷阱 ----
    await test("dialog.tab.trap", "Tab / Shift+Tab 不跑出弹框", async () => {
      await openCreateUserDialog(session);
      for (let i = 0; i < 14; i += 1) {
        await session.page.keyboard.press("Tab");
        assert(await focusInsideDialog(session.page), "第 " + (i + 1) + " 次 Tab 后焦点跑出了弹框");
      }
      for (let i = 0; i < 6; i += 1) {
        await session.page.keyboard.press("Shift+Tab");
        assert(await focusInsideDialog(session.page), "第 " + (i + 1) + " 次 Shift+Tab 后焦点跑出了弹框");
      }
      await shot(session.page, "tab-trap");
      return "20 次 Tab/Shift+Tab 后焦点始终在弹框内";
    });

    // ---- 危险确认默认焦点在取消 ----
    await test("confirm.danger.focus", "危险确认默认焦点在「取消」，误按 Enter 不执行删除", async () => {
      await session.visit("/client-keys", "连接密钥");
      await settle(session.page, { quietMs: 400, requireControls: true, controlSelector: "table" });
      let deletes = 0;
      const count = (request) => {
        if (request.method() === "DELETE" && request.url().includes("/admin/api-keys")) deletes += 1;
      };
      session.page.on("request", count);
      try {
        const deleteBtn = session.page.getByRole("button", { name: "删除" }).first();
        await deleteBtn.waitFor({ state: "visible", timeout: 15000 });
        await deleteBtn.click();
        const confirm = session.page.locator(ALERT_DIALOG).first();
        await confirm.waitFor({ state: "visible", timeout: 5000 });
        const focused = await activeText(session.page);
        assert(focused.includes("取消"), "危险确认的焦点应在「取消」，实际：" + focused);
        await shot(session.page, "danger-confirm");
        // 焦点在取消上时按 Enter = 取消确认，不应发出删除请求
        await session.page.keyboard.press("Enter");
        await session.page.waitForTimeout(600);
        assert(deletes === 0, "误按 Enter 不应发出删除请求，实际 " + deletes + " 次");
        return "焦点=取消；Enter 未发出删除请求";
      } finally {
        session.page.off("request", count);
      }
    });

    // ---- 关闭后焦点回到触发按钮 ----
    await test("dialog.focus.restore", "弹框关闭后焦点回到触发按钮", async () => {
      const { trigger, dialog } = await openCreateUserDialog(session);
      await session.page.keyboard.press("Escape");
      await session.page.waitForTimeout(500);
      const closed = (await dialog.count()) === 0 || !(await dialog.isVisible());
      assert(closed, "Escape 应关闭弹框");
      const focused = await activeText(session.page);
      assert(focused.includes("新建用户"), "关闭后焦点应回到触发按钮「新建用户」，实际：" + focused);
      await shot(session.page, "focus-restore");
      return "activeElement=新建用户";
    });

    // ---- 提交中重复 Enter 只发一次请求 ----
    await test("submit.pending.once", "提交中重复 Enter 只发一次请求", async () => {
      let posts = 0;
      // 拦截并拖住响应：让 pending 窗口可观测
      await session.page.route("**/admin/users", async (route) => {
        if (route.request().method() === "POST") {
          posts += 1;
          await new Promise((resolve) => setTimeout(resolve, 1200));
        }
        await route.continue();
      });
      try {
        await openCreateUserDialog(session);
        await session.page.fill("#create-user-name", "键盘验收丙");
        await session.page.keyboard.press("Enter");
        await session.page.waitForTimeout(300);
        await session.page.keyboard.press("Enter");
        await session.page.keyboard.press("Enter");
        await session.page.waitForTimeout(300);
        assert(posts === 1, "提交中重复 Enter 只应发一次请求，实际 " + posts + " 次");
        await shot(session.page, "pending-once");
        return "pending 窗口内 3 次 Enter → POST × 1";
      } finally {
        await session.page.unroute("**/admin/users");
      }
    });
  } finally {
    await session.close();
  }
}

/* ------------------------------------------------------------------ *
 * 4. 主流程
 * ------------------------------------------------------------------ */

async function main() {
  if (!REUSE && (API_PORT === 3700 || WEB_PORT === 3700)) {
    console.error("拒绝在 3700 上运行（隔离端口应为 3904/3905）");
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
    await runChecks(base);
  } catch (error) {
    console.error(String((error && error.message) || error));
    results.push({ id: "run", name: "验收脚本执行", status: "fail", detail: String((error && error.message) || error), evidence: [] });
  } finally {
    if (browser) await browser.close().catch(() => {});
    isolatedSite.stop();
  }

  const failed = results.filter((row) => row.status === "fail");
  const report = [
    "# W7 ticket 11 · 弹框统一键盘行为 浏览器验收",
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
