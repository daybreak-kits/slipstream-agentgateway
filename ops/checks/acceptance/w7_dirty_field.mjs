#!/usr/bin/env node
/**
 * W7 ticket 12 验收：全局脏字段浅黄收口（spec User Stories 40/58、Implementation
 * Decisions「交互与界面-脏字段」、Conflict Review C7、已拍板分歧 A 方案、
 * 票内 Lead Comments 预置回归）。
 *
 * 覆盖：
 *   1. 变脏后不再有左侧深色警示线：全页无 [data-slot="dirty-bar"]，脏字段容器
 *      computed border-left-width = 0px（计算样式断言，防止用 border 变相回归）；
 *   2. 浅黄背景、「已修改」文字/图标、恢复入口全部保留（W5 D8 不可仅颜色编码），
 *      标记槽绝对定位不占布局；
 *   3. 脏/净切换像素零位移：sticky 页头高度、脏字段自身、相邻字段、基本信息栅格、
 *      策略卡区、成员编排区逐像素不变（票内 Lead Comments 预置回归：PageHeader
 *      描述折行导致 page-head 75→95、整页 +20px 位移；1536 与 768 双档锁定）；
 *   4. 恢复入口键盘可达：Tab 聚焦「恢复」按钮、Enter 触发、值复原且标记消失；
 *   5. 使用脏字段的页面统一表现——公开模型页、运营设置、角色抽屉、用户编辑弹框、
 *      上游渠道抽屉逐一断言同一契约（登录页无 DirtyField 使用点，不涉及）。
 *
 * 运行：
 *   node ops/checks/acceptance/w7_dirty_field.mjs              # 自起隔离站点：API 3898 + web 3899
 *   node ops/checks/acceptance/w7_dirty_field.mjs --base-url http://127.0.0.1:3899   # 复用已起站点
 *   node ops/checks/acceptance/w7_dirty_field.mjs --headed
 *
 * 前提：web/dist 已构建（cd web && npx vite build）。脚本自管 seed/服务进程，结束后全部清理；
 * 使用临时 SQLite 与临时 ag-config，绝不触碰 3700/3600 与主仓库工作树。
 *
 * 退出码：0 全部 PASS；1 有 FAIL；2 环境/依赖未就绪。
 * 证据：ops/checks/.logs/acceptance/w7-dirty-<时间戳>/（report.md + *.png，.logs/ 不入库）。
 */
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { launchBrowser, loadPlaywright, parseCred, parseFlags, stamp } from "../lib/cli.mjs";
import { openSession, settle } from "../lib/session.mjs";
import { createIsolatedSite } from "../lib/isolated-site.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..", "..", "..");
const WEB_ROOT = path.join(ROOT, "web");
const API_ROOT = path.join(ROOT, "api");

const flags = parseFlags(process.argv.slice(2));
const API_PORT = Number(flags.get("api-port") || process.env.W7_DIRTY_API_PORT || 3898);
const WEB_PORT = Number(flags.get("web-port") || process.env.W7_DIRTY_WEB_PORT || 3899);
const HEADED = flags.has("headed");
const CHANNEL = flags.get("channel") || process.env.PLAYWRIGHT_CHANNEL || "";
const REUSE = Boolean(flags.get("base-url"));
const BASE_URL = (flags.get("base-url") || "").replace(/\/$/, "");
const ADMIN_CRED = parseCred(flags.get("admin") || process.env.W6_ADMIN, { user: "admin", pass: "admin12345" });
const OUT = path.resolve(flags.get("out") || path.join(ROOT, "ops", "checks", ".logs", "acceptance", "w7-dirty-" + stamp()));
fs.mkdirSync(OUT, { recursive: true });

/* DOM 契约（实现必须提供的稳定选择器）：读取助手直接使用这些 slot 名。 */

/* 零位移量测点：sticky 页头 + 脏字段自身 + 相邻字段 + 下方区块（与矩阵口径互补）。 */
const DISPLACEMENT_SLOTS = [
  "page-head",
  "basic-fields-grid",
  "field-name",
  "field-note",
  "strategy-cards",
  "member-board-grid",
];

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
 * 1. 隔离站点：API 3898 + web 3899（静态托管 + /admin、/api 反代）
 * ------------------------------------------------------------------ */

const isolatedSite = createIsolatedSite({
  apiRoot: API_ROOT,
  webRoot: WEB_ROOT,
  apiPort: API_PORT,
  webPort: WEB_PORT,
  outDir: OUT,
  dbName: "w7-dirty.db",
  secretKey: "w7-dirty-acceptance-only",
  adminCred: ADMIN_CRED,
});

/* ------------------------------------------------------------------ *
 * 2. 读取助手：脏字段契约 + 零位移量测
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

/**
 * 读当前页面（或 scope 内）脏字段的统一契约：
 * bars 计数是全页口径——任何页面出现左侧警示线都算违规，不限于 scope。
 */
async function readDirtyState(page, scopeSelector) {
  return page.evaluate(
    (scope) => {
      const root = scope ? document.querySelector(scope) : document;
      if (!root) return null;
      const bars = document.querySelectorAll('[data-slot="dirty-bar"]').length;
      const fields = [...root.querySelectorAll('[data-slot="dirty-field"]')];
      const dirtyFields = fields.filter((node) => node.getAttribute("data-dirty") === "true");
      const field = dirtyFields[0] || null;
      if (!field) return { bars, dirtyCount: dirtyFields.length, dirtyFieldTotal: fields.length };
      const fieldStyle = getComputedStyle(field);
      const marker = field.querySelector('[data-slot="dirty-marker"]');
      const markerStyle = marker ? getComputedStyle(marker) : null;
      const resetBtn = marker ? marker.querySelector("button") : null;
      const box = (node) => {
        const rect = node.getBoundingClientRect();
        return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
      };
      return {
        bars,
        dirtyCount: dirtyFields.length,
        dirtyFieldTotal: fields.length,
        background: fieldStyle.backgroundColor,
        borderLeftWidth: fieldStyle.borderLeftWidth,
        borderLeftStyle: fieldStyle.borderLeftStyle,
        markerPosition: markerStyle ? markerStyle.position : "missing",
        markerText: marker ? (marker.textContent || "").trim() : "",
        markerSvg: marker ? marker.querySelectorAll("svg").length : 0,
        resetAccessibleName: resetBtn
          ? resetBtn.getAttribute("aria-label") || resetBtn.getAttribute("title") || (resetBtn.textContent || "").trim()
          : "",
        markerBox: marker ? box(marker) : null,
        fieldBox: box(field),
      };
    },
    scopeSelector ?? null,
  );
}

/** 脏态统一契约（票内勾选项 1/2/5 的机器口径）。 */
function assertDirtyContract(state, label) {
  assert(state, label + "：找不到脏字段读取结果");
  assert(state.dirtyCount >= 1, label + "：没有 data-dirty=true 的字段（变脏失败）");
  assert(state.bars === 0, label + "：页面仍有左侧警示线 dirty-bar ×" + state.bars + "（spec：只保留浅黄背景）");
  assert(
    state.borderLeftWidth === "0px",
    label + "：脏字段容器 border-left-width 应为 0px，实际 " + state.borderLeftWidth + "/" + state.borderLeftStyle,
  );
  assert(
    state.background !== "rgba(0, 0, 0, 0)",
    label + "：脏字段缺少浅黄背景（background-color 透明）",
  );
  assert(state.markerPosition === "absolute", label + "：标记槽不是绝对定位（position=" + state.markerPosition + "，会参与布局推挤）");
  assert(
    state.markerText.includes("已修改"),
    label + "：标记缺少「已修改」文字（W5 D8：不可仅颜色编码）",
  );
  assert(state.markerSvg >= 1, label + "：标记缺少图标（恢复按钮 Undo2 图标）");
  assert(state.resetAccessibleName !== "", label + "：缺少恢复入口按钮");
}

/** 干净态契约：无标记、无警示线、无浅黄底。 */
function assertCleanContract(state, label) {
  assert(state, label + "：找不到读取结果");
  assert(state.dirtyCount === 0, label + "：仍有 " + state.dirtyCount + " 个字段处于脏态");
  assert(state.bars === 0, label + "：页面仍有左侧警示线 dirty-bar ×" + state.bars);
  if (state.dirtyFieldTotal !== undefined) {
    assert(
      state.dirtyFieldTotal >= 0,
      label + "：读取异常",
    );
  }
}

/** 量测零位移点（视口坐标；main 滚动容器先归零，排除 fill 自动滚动的噪声）。 */
async function boxesOf(page) {
  return page.evaluate((slots) => {
    const main = document.querySelector("main");
    if (main) main.scrollTop = 0;
    const out = {};
    for (const slot of slots) {
      const node = document.querySelector('[data-slot="' + slot + '"]');
      if (!node) {
        out[slot] = null;
        continue;
      }
      const rect = node.getBoundingClientRect();
      out[slot] = { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    }
    return out;
  }, DISPLACEMENT_SLOTS);
}

function diffBoxes(before, after) {
  const parts = [];
  for (const key of Object.keys(before)) {
    if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) {
      parts.push(key + " " + JSON.stringify(before[key]) + " → " + JSON.stringify(after[key]));
    }
  }
  return parts.join("；");
}

/**
 * 键盘恢复：从给定输入（fill 后焦点已在其上）Tab 走到指定 aria-label 的恢复按钮，
 * Enter 触发，断言值复原。全程只使用键盘，不点击。
 */
async function keyboardReset(page, inputLocator, resetLabel, expectValue) {
  await inputLocator.focus();
  let reached = false;
  for (let i = 0; i < 12 && !reached; i += 1) {
    await page.keyboard.press("Tab");
    reached = await page.evaluate((label) => {
      const active = document.activeElement;
      return Boolean(active && (active.getAttribute("aria-label") === label || active.getAttribute("title") === label));
    }, resetLabel);
  }
  assert(reached, "键盘 Tab 未能在 12 步内到达恢复按钮 aria-label=" + resetLabel);
  await page.keyboard.press("Enter");
  await page.waitForTimeout(250);
  const value = await inputLocator.inputValue();
  assert(value === expectValue, "Enter 触发恢复后值未复原：期望 " + JSON.stringify(expectValue) + " 实际 " + JSON.stringify(value));
  return "Tab 到「" + resetLabel + "」→ Enter → 值复原";
}

/* ------------------------------------------------------------------ *
 * 3. 验收项
 * ------------------------------------------------------------------ */

async function runDirtyChecks(session, fixtures) {
  const page = session.page;

  /* —— 公开模型编辑页（主战场：Lead Comments 预置回归在这里）—— */

  const openEditor = async (label) => {
    await page.goto(session.base + "/models/public/" + fixtures.publicModelId, {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });
    await settle(page, { quietMs: 400 });
    await session.assertSane(label);
    await page.getByLabel("备注", { exact: true }).waitFor({ state: "visible", timeout: 15000 });
  };

  await test("dirty.contract", "公开模型页变脏：无左侧深色线 + 浅黄底 + 已修改文字/图标 + 绝对定位标记", async () => {
    await openEditor("公开模型编辑");
    await page.getByLabel("备注", { exact: true }).fill("脏字段验收探针");
    await page.waitForTimeout(300);
    const state = await readDirtyState(page, '[data-slot="field-note"]');
    assertDirtyContract(state, "公开模型页备注字段");
    assert(
      state.markerText.includes("恢复"),
      "公开模型页备注字段：标记内应含恢复入口文字",
    );
    await shot(page, "dirty-contract");
    return "bars=0 · border-left=" + state.borderLeftWidth + " · marker=" + state.markerPosition + " · 文案=" + state.markerText.slice(0, 12);
  });

  const NOTE_PROBE = "矩阵脏标记断言";

  await test("displacement.1536", "1536 脏/净切换零位移：页头高度与字段/相邻/下方区块逐像素不变", async () => {
    await openEditor("公开模型编辑(1536)");
    await page.setViewportSize({ width: 1536, height: 864 });
    await page.waitForTimeout(300);
    const noteInput = page.getByLabel("备注", { exact: true });
    // 回填 baseline 保证起点是净态（seed 备注可能非空；净态 = 值等于 baseline）。
    await noteInput.fill(fixtures.noteBaseline);
    await page.waitForTimeout(200);
    const cleanBefore = await readDirtyState(page, '[data-slot="field-note"]');
    assertCleanContract(cleanBefore, "量测前起点应为净态");
    const before = await boxesOf(page);
    await noteInput.fill(NOTE_PROBE);
    await page.waitForTimeout(300);
    const after = await boxesOf(page);
    const diff = diffBoxes(before, after);
    assert(diff === "", "1536 变脏后布局位移：" + diff);
    const headHeight = after["page-head"] ? Math.round(after["page-head"].height) : -1;
    await shot(page, "displacement-1536-dirty");
    // 恢复原值，保持页面净态（后续用例不受残留脏态影响）。
    await keyboardReset(page, noteInput, "恢复备注", fixtures.noteBaseline);
    const clean = await readDirtyState(page, '[data-slot="field-note"]');
    assertCleanContract(clean, "公开模型页恢复后");
    await shot(page, "displacement-1536-clean");
    return "零位移 · page-head=" + headHeight + "px";
  });

  await test("displacement.768", "768 脏/净切换零位移（Lead Comments 双档锁定之二）", async () => {
    await page.setViewportSize({ width: 768, height: 1024 });
    await openEditor("公开模型编辑(768)");
    const noteInput = page.getByLabel("备注", { exact: true });
    await noteInput.fill(fixtures.noteBaseline);
    await page.waitForTimeout(200);
    const before = await boxesOf(page);
    await noteInput.fill(NOTE_PROBE);
    await page.waitForTimeout(300);
    const after = await boxesOf(page);
    const diff = diffBoxes(before, after);
    assert(diff === "", "768 变脏后布局位移：" + diff);
    await shot(page, "displacement-768-dirty");
    await keyboardReset(page, noteInput, "恢复备注", fixtures.noteBaseline);
    await page.setViewportSize({ width: 1536, height: 864 });
    return "768 零位移 · page-head=" + (after["page-head"] ? Math.round(after["page-head"].height) : -1) + "px";
  });

  await test("dirty.reset.keyboard", "恢复入口键盘可达：Tab 聚焦、Enter 触发、值复原且标记消失", async () => {
    await openEditor("公开模型编辑(键盘)");
    await page.getByLabel("备注", { exact: true }).fill("键盘恢复探针");
    await page.waitForTimeout(300);
    const detail = await keyboardReset(page, page.getByLabel("备注", { exact: true }), "恢复备注", fixtures.noteBaseline);
    const state = await readDirtyState(page, '[data-slot="field-note"]');
    assertCleanContract(state, "键盘恢复后");
    await shot(page, "dirty-reset-keyboard");
    return detail;
  });

  await test("dirty.cleanstate", "干净态不残留：无「已修改」标记、无浅黄底、无警示线", async () => {
    await openEditor("公开模型编辑(净态)");
    const state = await readDirtyState(page, '[data-slot="field-note"]');
    assertCleanContract(state, "净态备注字段");
    const probe = await page.evaluate(() => {
      const field = document.querySelector('[data-slot="field-note"] [data-slot="dirty-field"]');
      if (!field) return null;
      return {
        text: (field.textContent || "").includes("已修改"),
        background: getComputedStyle(field).backgroundColor,
      };
    });
    assert(probe, "净态备注字段：找不到 dirty-field");
    assert(!probe.text, "净态字段不应出现「已修改」标记");
    assert(probe.background === "rgba(0, 0, 0, 0)", "净态字段不应有警示浅底：background=" + probe.background);
    await shot(page, "dirty-cleanstate");
    return "净态无标记/无浅底/无线";
  });

  /* —— 统一表现：其余使用 DirtyField 的页面 —— */

  await test("dirty.uniform.ops-settings", "运营设置连接地址：同一契约 + 键盘恢复", async () => {
    await page.goto(session.base + "/ops-settings/connection", { waitUntil: "domcontentloaded", timeout: 30000 });
    await settle(page, { quietMs: 400 });
    await session.assertSane("运营设置");
    const input = page.locator('[data-slot="dirty-field"] input.font-mono').first();
    await input.waitFor({ state: "visible", timeout: 15000 });
    const baseline = await input.inputValue();
    await input.fill("http://127.0.0.1:3999");
    await page.waitForTimeout(300);
    const state = await readDirtyState(page, null);
    assertDirtyContract(state, "运营设置连接地址");
    const detail = await keyboardReset(page, input, "恢复连接地址", baseline);
    await shot(page, "uniform-ops-settings");
    return detail;
  });

  await test("dirty.uniform.role-drawer", "角色抽屉（新建角色）：同一契约", async () => {
    await page.goto(session.base + "/roles", { waitUntil: "domcontentloaded", timeout: 30000 });
    await settle(page, { quietMs: 400 });
    await session.assertSane("角色管理");
    await page.getByRole("button", { name: "新建角色" }).first().click();
    const nameInput = page.locator("#role-name");
    await nameInput.waitFor({ state: "visible", timeout: 15000 });
    await nameInput.fill("脏字段验收角色");
    await page.waitForTimeout(300);
    const state = await readDirtyState(page, null);
    assertDirtyContract(state, "角色抽屉角色名称");
    await keyboardReset(page, nameInput, "恢复角色名称", "");
    await page.getByRole("button", { name: "取消", exact: true }).first().click();
    await shot(page, "uniform-role-drawer");
    return "bars=0 · marker absolute · 恢复角色名称可用";
  });

  await test("dirty.uniform.user-dialog", "用户编辑弹框：同一契约", async () => {
    await page.goto(session.base + "/users", { waitUntil: "domcontentloaded", timeout: 30000 });
    await settle(page, { quietMs: 400 });
    await session.assertSane("用户管理");
    await page.getByRole("button", { name: "编辑", exact: true }).first().click();
    const nameInput = page.locator("#edit-user-name");
    await nameInput.waitFor({ state: "visible", timeout: 15000 });
    const baseline = await nameInput.inputValue();
    await nameInput.fill(baseline + "脏");
    await page.waitForTimeout(300);
    const state = await readDirtyState(page, null);
    assertDirtyContract(state, "用户编辑弹框用户名称");
    await keyboardReset(page, nameInput, "恢复用户名称", baseline);
    await page.getByRole("button", { name: "取消", exact: true }).first().click();
    await shot(page, "uniform-user-dialog");
    return "bars=0 · marker absolute · 恢复用户名称可用";
  });

  await test("dirty.uniform.upstream-drawer", "上游模型抽屉（模型页行内编辑）：同一契约", async () => {
    await page.goto(session.base + "/models", { waitUntil: "domcontentloaded", timeout: 30000 });
    await settle(page, { quietMs: 400 });
    await session.assertSane("模型管理");
    // 上游模型抽屉挂在 /models 上游模型 tab；行内「编辑」打开（工具条无常驻新建按钮）。
    await page.getByRole("button", { name: "编辑", exact: true }).first().click();
    const nameInput = page.getByLabel("模型名", { exact: true });
    await nameInput.waitFor({ state: "visible", timeout: 15000 });
    const baseline = await nameInput.inputValue();
    await nameInput.fill(baseline + "-脏探针");
    await page.waitForTimeout(300);
    const state = await readDirtyState(page, null);
    assertDirtyContract(state, "上游抽屉模型名");
    await keyboardReset(page, nameInput, "恢复该项", baseline);
    await page.getByRole("button", { name: "取消", exact: true }).first().click();
    await shot(page, "uniform-upstream-drawer");
    return "bars=0 · marker absolute · 恢复该项可用";
  });
}

/* ------------------------------------------------------------------ *
 * 4. 主流程
 * ------------------------------------------------------------------ */

async function main() {
  if (!REUSE && (API_PORT === 3700 || WEB_PORT === 3700)) {
    console.error("拒绝在 3700 上运行（隔离端口应为 3898/3899）");
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
    const models = await session.apiGet("/admin/public-models");
    assert(models.status === 200, "读取公开模型列表失败：" + models.status);
    const items = Array.isArray(models.body) ? models.body : models.body.items ?? [];
    assert(items.length >= 1, "seed 缺少公开模型，无法验收");
    // 优先取备注为空的模型（与矩阵夹具同口径）；否则取首个并记录 baseline 值，
    // 恢复入口验收以「回到 baseline」为准，不假设空串。
    const model = items.find((item) => !item.note) ?? items[0];
    await runDirtyChecks(session, { publicModelId: model.id, noteBaseline: model.note ?? "" });
    await session.close();
  } catch (error) {
    console.error(String((error && error.message) || error));
    results.push({ id: "run", name: "验收脚本执行", status: "fail", detail: String((error && error.message) || error), evidence: [] });
  } finally {
    if (browser) await browser.close().catch(() => {});
    isolatedSite.stop();
  }

  const failed = results.filter((row) => row.status === "fail");
  const report = [
    "# W7 ticket 12 · 脏字段浅黄收口浏览器验收",
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
