#!/usr/bin/env node
/**
 * W7 ticket 08 验收：统一悬浮详情 HoverInfo（spec「交互与界面-参数」/ User Story 37–39）。
 *
 * 覆盖 spec 必测矩阵里的 HoverInfo 一行：
 *   1. 鼠标 hover（约 250ms 延迟）打开；
 *   2. 键盘 Tab 聚焦打开；
 *   3. 触屏轻点打开；
 *   4. 三路打开的是同一份内容；
 *   5. 浮层 portal 到页面顶层（不被卡片/表格裁切），靠近视口边缘时自动翻转并留在视口内；
 *   6. 关闭后焦点回到触发元素（不丢焦点）。
 *
 * 运行：
 *   node ops/checks/acceptance/w7_hover_info.mjs              # 自起隔离站点：API 3885 + web 3886
 *   node ops/checks/acceptance/w7_hover_info.mjs --base-url http://127.0.0.1:3886   # 复用已起站点
 *   node ops/checks/acceptance/w7_hover_info.mjs --headed
 *
 * 前提：web/dist 已构建（cd web && npx vite build）。脚本自管 seed/服务进程，结束后全部清理；
 * 使用临时 SQLite 与临时 ag-config，绝不触碰 3700/3600 与主仓库工作树。
 *
 * 退出码：0 全部 PASS；1 有 FAIL；2 环境/依赖未就绪。
 * 证据：ops/checks/.logs/acceptance/w7-hover-<时间戳>/（report.md + *.png，.logs/ 不入库）。
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
const API_PORT = Number(flags.get("api-port") || process.env.W7_HOVER_API_PORT || 3885);
const WEB_PORT = Number(flags.get("web-port") || process.env.W7_HOVER_WEB_PORT || 3886);
const HEADED = flags.has("headed");
const CHANNEL = flags.get("channel") || process.env.PLAYWRIGHT_CHANNEL || "";
const REUSE = Boolean(flags.get("base-url"));
const BASE_URL = (flags.get("base-url") || "").replace(/\/$/, "");
const ADMIN_CRED = parseCred(flags.get("admin") || process.env.W6_ADMIN, { user: "admin", pass: "admin12345" });
const OUT = path.resolve(flags.get("out") || path.join(ROOT, "ops", "checks", ".logs", "acceptance", "w7-hover-" + stamp()));
fs.mkdirSync(OUT, { recursive: true });

const TRIGGER = '[data-hover-info="trigger"]';
const PANEL = '[data-slot="hover-info-panel"]';

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
 * 1. 隔离站点：API 3885 + web 3886（静态托管 + /admin、/api 反代）
 * ------------------------------------------------------------------ */

const isolatedSite = createIsolatedSite({
  apiRoot: API_ROOT,
  webRoot: WEB_ROOT,
  apiPort: API_PORT,
  webPort: WEB_PORT,
  outDir: OUT,
  dbName: "w7-hover.db",
  secretKey: "w7-hover-acceptance-only",
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

/** 浮层当前的位置/内容快照（含是否 portal 到 body）。 */
function readPanel(page) {
  return page.evaluate((selector) => {
    const el = document.querySelector(selector);
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    return {
      parentTag: el.parentElement ? el.parentElement.tagName : "",
      parentSlot: el.parentElement ? el.parentElement.getAttribute("data-slot") || "" : "",
      side: el.getAttribute("data-side") || "",
      role: el.getAttribute("role") || "",
      text: (el.textContent || "").trim(),
      box: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      viewport: { width: window.innerWidth, height: window.innerHeight },
    };
  }, PANEL);
}

function assertInsideViewport(panel, label) {
  assert(panel, label + "：浮层不存在");
  const { box, viewport } = panel;
  assert(box.x >= -0.5, label + "：浮层左缘出屏 x=" + box.x);
  assert(box.y >= -0.5, label + "：浮层上缘出屏 y=" + box.y);
  assert(box.x + box.width <= viewport.width + 0.5, label + "：浮层右缘出屏 right=" + (box.x + box.width));
  assert(box.y + box.height <= viewport.height + 0.5, label + "：浮层下缘出屏 bottom=" + (box.y + box.height));
}

/* ------------------------------------------------------------------ *
 * 3. 验收项
 * ------------------------------------------------------------------ */

async function runHoverChecks(session) {
  const page = session.page;

  await test("hover.delay", "鼠标 hover 约 250ms 后打开浮层（此前不打开）", async () => {
    await page.goto(session.base + "/dashboard", { waitUntil: "domcontentloaded", timeout: 30000 });
    await settle(page, { quietMs: 400 });
    await session.assertSane("数据看板");
    const trigger = page.locator(TRIGGER).first();
    await trigger.waitFor({ state: "visible", timeout: 15000 });
    await page.mouse.move(0, 0);
    await trigger.hover();
    await page.waitForTimeout(120);
    const early = await page.locator(PANEL).count();
    await page.waitForTimeout(500);
    const late = await page.locator(PANEL).count();
    assert(early === 0, "hover 后 120ms 不应已打开（延时未到），实际已打开");
    assert(late === 1, "hover 后应打开浮层，实际 " + late);
    await shot(page, "hover-open");
    return "120ms 未打开 / 620ms 已打开";
  });

  await test("hover.portal", "浮层 portal 到页面顶层且完整落在视口内（不被卡片裁切）", async () => {
    const panel = await readPanel(page);
    assert(panel, "浮层不存在");
    assert(panel.parentTag === "BODY", "浮层必须 portal 到 body（当前挂在 " + panel.parentTag + "）");
    assert(panel.role === "tooltip", "浮层必须是 role=tooltip，当前 " + panel.role);
    assertInsideViewport(panel, "浮层位置");
    const triggerText = (await page.locator(TRIGGER).first().innerText()).trim();
    assert(panel.text === triggerText, "浮层内容必须与触发元素一致：" + panel.text + " vs " + triggerText);
    return "parent=body · " + JSON.stringify(panel.box);
  });

  await test("focus.tab", "键盘 Tab 聚焦触发元素即打开同一内容", async () => {
    await page.mouse.move(0, 0);
    await page.waitForTimeout(300);
    assert((await page.locator(PANEL).count()) === 0, "移开鼠标后浮层应收起");
    let focused = false;
    for (let i = 0; i < 80 && !focused; i += 1) {
      await page.keyboard.press("Tab");
      focused = await page.evaluate((selector) => {
        const active = document.activeElement;
        return Boolean(active && active.matches(selector));
      }, TRIGGER);
    }
    assert(focused, "Tab 必须能走到悬浮触发元素");
    await page.waitForTimeout(200);
    const panel = await readPanel(page);
    assert(panel, "键盘聚焦后浮层必须打开");
    assertInsideViewport(panel, "键盘聚焦浮层");
    await shot(page, "focus-open");
    return "Tab 聚焦即打开";
  });

  await test("focus.restore", "Escape 关闭浮层后焦点仍留在触发元素上", async () => {
    await page.keyboard.press("Escape");
    await page.waitForTimeout(250);
    assert((await page.locator(PANEL).count()) === 0, "Escape 必须关闭浮层");
    const stillFocused = await page.evaluate((selector) => {
      const active = document.activeElement;
      return Boolean(active && active.matches(selector));
    }, TRIGGER);
    assert(stillFocused, "关闭后焦点必须回到触发元素（不得丢焦点）");
    return "焦点仍在触发元素";
  });

  await test("viewport.flip", "触发元素贴视口上缘时浮层自动翻到下方且不出屏", async () => {
    await page.mouse.move(0, 0);
    // 把触发元素顶到滚动容器上沿（上方只剩顶栏高度），制造"上方放不下"的碰撞。
    const top = await page.evaluate((selector) => {
      const el = document.querySelector(selector);
      if (!el) return null;
      let node = el.parentElement;
      while (node) {
        const style = getComputedStyle(node);
        if (/(auto|scroll)/.test(style.overflowY) && node.scrollHeight > node.clientHeight) {
          node.scrollTop += el.getBoundingClientRect().top - node.getBoundingClientRect().top;
          break;
        }
        node = node.parentElement;
      }
      if (node === null) window.scrollBy(0, el.getBoundingClientRect().top);
      return el.getBoundingClientRect().top;
    }, TRIGGER);
    assert(top !== null, "找不到悬浮触发元素");
    assert(top < 80, "触发元素必须被顶到滚动容器上沿（当前 top=" + Math.round(top) + "），否则测不到碰撞");
    // 撑高浮层（模拟参数详情这类长面板），确保上方空间真的放不下。
    await page.addStyleTag({ content: '[data-slot="hover-info-panel"] { height: 240px; }' });
    await page.waitForTimeout(250);
    const trigger = page.locator(TRIGGER).first();
    await trigger.hover();
    await page.waitForTimeout(600);
    const panel = await readPanel(page);
    assert(panel, "浮层不存在");
    assert(panel.side === "bottom", "上方放不下时必须翻到下方，实际 data-side=" + panel.side);
    assertInsideViewport(panel, "翻转后浮层");
    await shot(page, "viewport-flip");
    return "data-side=bottom · " + JSON.stringify(panel.box);
  });

  await test("viewport.collapse", "矮视口下浮层收拢（限高滚动）并完整留在视口内", async () => {
    const previous = page.viewportSize();
    await page.setViewportSize({ width: 375, height: 220 });
    await page.waitForTimeout(300);
    // 撑到远超视口高度：浮层必须限高收拢，而不是溢出屏幕。
    await page.addStyleTag({ content: '[data-slot="hover-info-panel"] { height: 900px; }' });
    const trigger = page.locator(TRIGGER).first();
    await trigger.scrollIntoViewIfNeeded();
    await trigger.hover();
    await page.waitForTimeout(600);
    const panel = await readPanel(page);
    assert(panel, "浮层不存在");
    assertInsideViewport(panel, "矮视口浮层");
    assert(
      panel.box.height <= panel.viewport.height,
      "浮层高度必须收拢到视口内，实际 " + panel.box.height + " > " + panel.viewport.height,
    );
    await shot(page, "viewport-collapse");
    await page.setViewportSize(previous);
    return "浮层 " + Math.round(panel.box.height) + "px ≤ 视口 " + panel.viewport.height + "px";
  });
}

async function runTouchCheck(base) {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    locale: "zh-CN",
    hasTouch: true,
    baseURL: base,
  });
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  try {
    await test("touch.tap", "触屏轻点触发元素打开同一内容", async () => {
      await page.goto(base + "/login", { waitUntil: "domcontentloaded", timeout: 30000 });
      await page.waitForTimeout(400);
      await page.fill("#login-username", ADMIN_CRED.user);
      await page.fill("#login-password", ADMIN_CRED.pass);
      await page.click('button[type="submit"]');
      const outcome = await waitLoginOutcome(page, { timeoutMs: 15000 });
      assert(outcome.ok, "触屏上下文登录失败：" + outcome.message);
      await page.goto(base + "/dashboard", { waitUntil: "domcontentloaded", timeout: 30000 });
      await settle(page, { quietMs: 400 });
      const trigger = page.locator(TRIGGER).first();
      await trigger.waitFor({ state: "visible", timeout: 15000 });
      await trigger.tap();
      await page.waitForTimeout(500);
      const panel = await readPanel(page);
      assert(panel, "触屏轻点后浮层必须打开");
      assert(panel.parentTag === "BODY", "触屏浮层同样必须 portal 到 body");
      assertInsideViewport(panel, "触屏浮层");
      const triggerText = (await trigger.innerText()).trim();
      assert(panel.text === triggerText, "触屏打开的内容必须与鼠标/键盘一致");
      await shot(page, "touch-open");
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
    console.error("拒绝在 3700 上运行（隔离端口应为 3885/3886）");
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
    const session = await openSession(browser, { base, apiBase: base, role: "admin" });
    const outcome = await session.login(ADMIN_CRED);
    assert(outcome.ok, "登录失败：" + outcome.message);
    await runHoverChecks(session);
    await session.close();
    await runTouchCheck(base);
  } catch (error) {
    console.error(String((error && error.message) || error));
    results.push({ id: "run", name: "验收脚本执行", status: "fail", detail: String((error && error.message) || error), evidence: [] });
  } finally {
    if (browser) await browser.close().catch(() => {});
    isolatedSite.stop();
  }

  const failed = results.filter((row) => row.status === "fail");
  const report = [
    "# W7 ticket 08 · HoverInfo 浏览器验收",
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
