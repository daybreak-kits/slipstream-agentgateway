#!/usr/bin/env node
/**
 * Slipstream 全站交互审计（unslop 交互轮）
 *
 * 目标：对每个页面 main 区域里所有可见控件逐一操作，检查：
 *   1. 点击后是否报错（console、未捕获异常、错误边界、5xx）
 *   2. 对话框能否打开与关闭，必填字段空提交是否有校验提示
 *   3. 危险操作（删除/停用/退出等）是否二次确认
 *   4. 控件是否可达、有可读名称、禁用态是否合理
 *   5. 提交类操作是否给出成功/失败提示
 *   6. Tab / 选择器切换后内容是否真的变化
 *   7. 面板/筛选切换后新出现的控件是否也要操作（动态重扫 + 身份重定位）
 *
 * 行为边界：会打开弹窗后取消（不提交表单）、开关类控件来回切换恢复原状；
 * 不会点危险操作的确认按钮。审计后如需干净数据请重跑 seed_demo.py。
 * 结果写入 ops/checks/.logs/interaction/<时间戳>/（.logs/ 不入库）。
 *
 * 退出码：0 无硬失败（--strict 时任何问题都算失败）；1 有硬失败（console/pageerror/
 * fatal/layout/interaction/http）；2 环境未就绪（服务不可达/浏览器缺失/登录失败）。
 *
 * 用法：
 *   node ops/checks/interaction_audit.mjs
 *   node ops/checks/interaction_audit.mjs --headed --channel msedge
 *   node ops/checks/interaction_audit.mjs --only /models,/logs
 *   node ops/checks/interaction_audit.mjs --strict            # 任何问题都返回 1
 *   node ops/checks/interaction_audit.mjs --max-controls 200 # 每页最多操作的控件数
 *
 * 前提：控制面 3700 + Vite 5173（localhost，不要 127.0.0.1）已运行。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { attachConsoleCollector, launchBrowser, loadPlaywright, login, parseCred, parseFlags, stamp, DEFAULT_CREDS } from "./lib/cli.mjs";
import { auditPages, labelForPath, loadRouteTable } from "./lib/routes.mjs";
import { settle as settleShared } from "./lib/session.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..", "..");
const flags = parseFlags(process.argv.slice(2));
const BASE = (flags.get("base-url") || process.env.AUDIT_BASE_URL || "http://localhost:3700").replace(/\/$/, "");
const API = (flags.get("api-url") || process.env.AUDIT_API_URL || "http://localhost:3700").replace(/\/$/, "");
const HEADED = flags.has("headed");
const STRICT = flags.has("strict");
const CHANNEL = flags.get("channel") || process.env.PLAYWRIGHT_CHANNEL || "msedge";
const ONLY = flags.has("only") ? String(flags.get("only")).split(",").map((s) => s.trim()).filter(Boolean) : null;
const MAX_CONTROLS = Math.max(1, Number(flags.get("max-controls") || 400));
const ADMIN = parseCred(flags.get("admin") || process.env.AUDIT_ADMIN, DEFAULT_CREDS.admin);
const CONSOLE_IGNORE = [
  "Download the React DevTools",
  "ResizeObserver loop",
  ...(flags.has("console-ignore") ? String(flags.get("console-ignore")).split(",").filter(Boolean) : []),
];

const OUT = path.join(ROOT, "ops", "checks", ".logs", "interaction", stamp());
fs.mkdirSync(OUT, { recursive: true });

const issues = [];
const pages = [];
const dialogs = [];
const mutations = [];
const skipped = [];
const stats = { controls: 0, exercised: 0, disabled: 0, disappeared: 0 };
/** 硬失败类别：出现任意一条即以退出码 1 结束（与 acceptance_browser.mjs 一致）。 */
const HARD_KINDS = ["console", "pageerror", "fatal", "layout", "interaction", "http"];
let auditSeq = 0;

function addIssue(pageLabel, kind, detail, control) {
  issues.push({ page: pageLabel, kind, detail, control: control || "" });
  console.log("  ISSUE [" + kind + "] " + detail + (control ? " <- " + control : ""));
}

function safeName(value) {
  return String(value).replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").toLowerCase() || "page";
}

/* ------------------------------------------------------------------ *
 * 页面清单：由 web/src/routes.ts 生成的 routes.json 派生
 * （cd web && npm run routes:json）。审计操作配置仍留在本文件，但路径不再手抄。
 * ------------------------------------------------------------------ */

/** @type {{ routes: Array<Record<string, any>> } | null} */
let ROUTE_TABLE = null;
/** @type {Array<[string, string]>} [path, label] */
let PAGES = [];

function loadPages() {
  ROUTE_TABLE = loadRouteTable();
  PAGES = auditPages(ROUTE_TABLE);
  if (ONLY) PAGES = PAGES.filter((p) => ONLY.some((o) => p[0] === o || p[1].includes(o)));
}

const CONTROL_SELECTOR = [
  "main button",
  "main a[href]",
  "main input",
  "main select",
  "main textarea",
  "main [role=tab]",
  "main [role=switch]",
  "main [role=checkbox]",
  "main [role=radio]",
  "main [role=combobox]",
  "main [role=button]",
].join(",");

const DESTRUCTIVE = /删除|移除|清空|吊销|撤销|停用|禁用|封禁|退出登录|重置密码|下线/;
// 只改本地草稿/本地会话、不立即落库的「删除」不算破坏性操作（点错也能放弃/重新添加）：
//   「删除本条」= 上游详情路由/请求头规则编辑器删掉一行草稿（点「保存全部」才落库）
//   「删除这条消息」= playground 本地会话里删一条消息（本地状态）
const DRAFT_ONLY_DELETE = /^(删除本条|删除这条消息|删除护栏|移除)$/;
const isDestructive = (label) => DESTRUCTIVE.test(label) && !DRAFT_ONLY_DELETE.test(label);
const CANCEL_WORDS = /取消|关闭|返回|否$|中止|再想想/;

/* ------------------------------------------------------------------ *
 * 浏览器
 * ------------------------------------------------------------------ */

/** 交互审计要等「骨架屏消失 + 出现可操作控件」；实现与验收共用 lib/session.mjs 的 settle。 */
async function settle(page) {
  await settleShared(page, {
    quietMs: 0,
    mainTimeoutMs: 8000,
    requireControls: true,
    controlSelector: CONTROL_SELECTOR,
    evaluate: (fn, arg) => evalGuarded(page, fn, arg),
  });
}

function shortError(error) {
  return String((error && error.message) || error).split("\n")[0].slice(0, 180);
}

/** 页面 raw evaluate 的兜底超时：主线程死循环时 page.evaluate 会永不返回，
 * 这里 8s 主动失败，避免整轮审计被一个卡死页面拖住。 */
const EVAL_TIMEOUT_MS = 8000;
function pageHung(message) {
  const error = new Error(message || "页面主线程 8s 无响应（疑似死循环）");
  error.pageHung = true;
  return error;
}
async function evalGuarded(page, fn, arg) {
  let timer;
  try {
    return await Promise.race([
      page.evaluate(fn, arg),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(pageHung()), EVAL_TIMEOUT_MS);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
/** .catch 里放行 pageHung，避免吞掉卡死信号后继续等。 */
function ignoreDomError(error) {
  if (error && error.pageHung) throw error;
  return null;
}

/** 普通点击失败时用 force 重试：toast / 动画层可能暂时遮挡控件。 */
async function robustClick(page, pageLabel, loc, label, refind = null, timeout = 2800) {
  try {
    await loc.click({ timeout });
    return true;
  } catch (error) {
    // toast 动画/弹出层收起会短暂遮挡：稍等后重试一次普通点击，成功就不算问题
    await page.waitForTimeout(450);
    try {
      await loc.click({ timeout: 1800 });
      return true;
    } catch (secondError) {
      const occluder = await loc
        .evaluate((el) => {
          const r = el.getBoundingClientRect();
          const stack = document
            .elementsFromPoint(Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2))
            .slice(0, 3)
            .map((n) => n.tagName + "." + String(n.className).slice(0, 60));
          return stack.join(" > ");
        })
        .catch(() => "eval-error");
      try {
        await loc.click({ timeout: 2000, force: true });
        addIssue(pageLabel, "occluded", "「" + label + "」两次普通点击超时，force 可用；命中栈: " + occluder + "；playwright: " + shortError(secondError).slice(0, 120), label);
        return true;
      } catch (retryError) {
        // React 重渲染可能把控件换掉：按身份找回后再试一次；找不回说明随页面状态卸载了，不算缺陷。
        if (refind) {
          const fresh = await refind().catch(() => null);
          if (!fresh) return true;
          try {
            await fresh.click({ timeout: 2000, force: true });
            return true;
          } catch (movedError) {
            addIssue(pageLabel, "interaction", "点击失败：" + shortError(movedError), label);
            return false;
          }
        }
        addIssue(pageLabel, "interaction", "点击失败：" + shortError(retryError), label);
        return false;
      }
    }
  }
}

/** 输入失败先用 force 重试；仍失败且给了 refind 时按身份重新定位再试一次。
 * 表格单元格常因父级状态更新被 React 重建，旧 locator 会永远等不到节点。 */
async function robustFill(page, pageLabel, loc, label, value, refind) {
  let failure = await loc.fill(value, { timeout: 2500 }).then(() => null, (error) => error);
  if (!failure) return { ok: true, loc };
  if (refind) {
    const fresh = await refind().catch(() => null);
    if (fresh) {
      const retryFailure = await fresh.fill(value, { timeout: 2500 }).then(() => null, (error) => error);
      if (!retryFailure) return { ok: true, loc: fresh };
      loc = fresh;
    }
  }
  const forcedFailure = await loc.fill(value, { timeout: 2000, force: true }).then(() => null, (error) => error);
  if (!forcedFailure) {
    addIssue(pageLabel, "occluded", "「" + label + "」普通输入超时，force 输入可用（可能被浮层暂时遮挡）", label);
    return { ok: true, loc };
  }
  const freshAfter = refind ? await refind().catch(() => null) : null;
  if (refind && !freshAfter) {
    // 控件在输入过程中被页面卸载（编辑态结束、面板切换）：不是交互缺陷，记为跳过。
    return { ok: true, loc, gone: true };
  }
  const probeTarget = freshAfter || loc;
  // 操作期间控件可能因异步状态（如流式响应）变成禁用：这不是交互缺陷，记为跳过。
  const disabledNow = await probeTarget.isDisabled({ timeout: 1000 }).catch(() => false);
  if (disabledNow) return { ok: true, loc: probeTarget, disabled: true };
  addIssue(pageLabel, "interaction", "输入失败：" + shortError(forcedFailure), label);
  return { ok: false, loc };
}

/* ------------------------------------------------------------------ *
 * 控件描述与操作
 * ------------------------------------------------------------------ */

async function readControl(loc, timeout = 2500) {
  // 控件可能在前面操作后被卸载：evaluate 必须显式限时，否则要等默认 15s 才抛。
  return loc.evaluate((node) => {
    const tag = node.tagName.toLowerCase();
    const text = (node.innerText || node.textContent || "").replace(/\s+/g, " ").trim();
    return {
      tag,
      role: node.getAttribute("role") || "",
      type: (node.getAttribute("type") || "").toLowerCase(),
      ariaLabel: node.getAttribute("aria-label") || node.getAttribute("title") || "",
      placeholder: node.getAttribute("placeholder") || "",
      text: text.slice(0, 70),
      labelText: (node.closest("label") || (node.id ? document.querySelector('label[for="' + node.id + '"]') : null))?.innerText?.replace(/\s+/g, " ").trim().slice(0, 60) || "",
      html: node.outerHTML.replace(/\s+/g, " ").slice(0, 200),
      href: node.getAttribute("href") || "",
      name: node.getAttribute("name") || node.id || "",
      disabled: node.disabled === true || node.getAttribute("aria-disabled") === "true",
      readOnly: node.readOnly === true,
      hasPopup: node.getAttribute("aria-haspopup") || "",
      checked: node.checked === true || node.getAttribute("aria-checked") === "true",
      selected: node.getAttribute("aria-selected") === "true",
      hidden: node.getAttribute("aria-hidden") === "true" || Boolean(node.closest('[aria-hidden="true"]')),
      tagName: node.tagName,
    };
  }, undefined, { timeout });
}

function controlLabel(info) {
  return info.ariaLabel || info.placeholder || info.text || info.name || info.href || info.role || "未命名控件";
}

function firstLineText(text) {
  return String(text || "").split("\n")[0].replace(/\s+/g, " ").trim().slice(0, 40);
}

/** 结构 + 首行文本 = 重渲染后仍能认出的控件身份（金额/比例等动态数字变化不影响身份）。 */
function identityOf(info) {
  return [info.tag, info.role, info.type, info.ariaLabel, info.placeholder, info.name, info.href, firstLineText(info.text)].join("|");
}

let retagSeq = 0;
/**
 * React 重渲染替换节点后原标记会丢：按「结构 + 首行文本 + 第 n 次出现」重新定位并打新标记。
 * 只给命中的那一个节点打标记，不影响本页其它待操作控件的 id。
 */
async function locateByIdentity(page, identity, occurrence) {
  const id = "q" + (retagSeq += 1);
  const ok = await evalGuarded(page, ({ selector, wanted, nth, id: newId }) => {
    const textOf = (node) => (node.innerText || node.textContent || "").replace(/\s+/g, " ").trim();
    const keyOf = (node) => [
      node.tagName.toLowerCase(),
      node.getAttribute("role") || "",
      (node.getAttribute("type") || "").toLowerCase(),
      node.getAttribute("aria-label") || node.getAttribute("title") || "",
      node.getAttribute("placeholder") || "",
      node.getAttribute("name") || node.id || "",
      node.getAttribute("href") || "",
      textOf(node).split("\n")[0].replace(/\s+/g, " ").trim().slice(0, 40),
    ].join("|");
    const matches = [];
    for (const node of Array.from(document.querySelectorAll(selector))) {
      if (node.getAttribute("aria-hidden") === "true" || node.closest('[aria-hidden="true"]')) continue;
      const style = getComputedStyle(node);
      if (style.visibility === "hidden" || style.display === "none") continue;
      const rect = node.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;
      if (keyOf(node) === wanted) matches.push(node);
    }
    if (matches.length === 0) return false;
    const target = matches[Math.min(nth, matches.length - 1)];
    target.setAttribute("data-audit-id", newId);
    return true;
  }, { selector: CONTROL_SELECTOR, wanted: identity, nth: occurrence, id });
  return ok ? page.locator('[data-audit-id="' + id + '"]') : null;
}

/** 点击后按「结构 + 首行文本 + 第 n 次出现」重查节点并读实时状态：
 * React 常在点击后替换节点，读旧 locator 会得到 null/旧值，造成「Tab 点击未选中」这类假阳性。 */
async function stateByIdentity(page, identity, occurrence) {
  return evalGuarded(page, ({ selector, wanted, nth }) => {
    const textOf = (node) => (node.innerText || node.textContent || "").replace(/\s+/g, " ").trim();
    const keyOf = (node) => [
      node.tagName.toLowerCase(),
      node.getAttribute("role") || "",
      (node.getAttribute("type") || "").toLowerCase(),
      node.getAttribute("aria-label") || node.getAttribute("title") || "",
      node.getAttribute("placeholder") || "",
      node.getAttribute("name") || node.id || "",
      node.getAttribute("href") || "",
      textOf(node).split("\n")[0].replace(/\s+/g, " ").trim().slice(0, 40),
    ].join("|");
    const matches = [];
    for (const node of Array.from(document.querySelectorAll(selector))) {
      if (node.getAttribute("aria-hidden") === "true" || node.closest('[aria-hidden="true"]')) continue;
      const style = getComputedStyle(node);
      if (style.visibility === "hidden" || style.display === "none") continue;
      const rect = node.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;
      if (keyOf(node) === wanted) matches.push(node);
    }
    if (matches.length === 0) return null;
    const node = matches[Math.min(nth, matches.length - 1)];
    return {
      selected: node.getAttribute("aria-selected") === "true",
      checkedAttr: node.getAttribute("aria-checked"),
      pressedAttr: node.getAttribute("aria-pressed"),
      nativeChecked: node.checked === true,
      disabled: node.disabled === true || node.getAttribute("aria-disabled") === "true",
    };
  }, { selector: CONTROL_SELECTOR, wanted: identity, nth: occurrence });
}

/** 点击后的状态更新可能是异步的（React 批处理/图表重渲染），轮询到期望状态或超时为止。 */
async function waitState(page, identity, occurrence, test, timeout = 2500, interval = 150) {
  const deadline = Date.now() + timeout;
  let state = null;
  do {
    state = await stateByIdentity(page, identity, occurrence).catch(ignoreDomError);
    if (state && test(state)) return state;
    await page.waitForTimeout(interval);
  } while (Date.now() < deadline);
  return state;
}

/** 把当前可见控件并入待操作队列；返回新增数量。 */
async function enqueueControls(page, pending, queued) {
  const found = await collectControls(page);
  const seen = new Map();
  let added = 0;
  for (const item of found) {
    const base = identityOf(item.info);
    const nth = seen.get(base) || 0;
    seen.set(base, nth + 1);
    const marker = base + "#" + nth;
    if (queued.has(marker)) continue;
    // 「确认/确定」是行内二次确认的第二步：审计点它等于真的执行删除/提交，跳过不点。
    if (/^(确认|确定)/.test(controlLabel(item.info))) continue;
    queued.add(marker);
    pending.push({ info: item.info, identity: base, occurrence: nth, y: item.info.y || 0 });
    added += 1;
  }
  return added;
}

async function closeOverlay(page, pageLabel, opener) {
  const overlay = page.locator('[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]').last();
  if ((await overlay.count()) === 0) return null;
  if (!(await overlay.isVisible().catch(() => false))) return null;

  const role = await overlay.getAttribute("role").catch(() => "");
  if (role === "listbox" || role === "menu") {
    await page.keyboard.press("Escape");
    await page.waitForTimeout(250);
    return null;
  }
  const title = await overlay.locator("h2,h3,[role=heading]").first().innerText().catch(() => "");
  const buttons = await overlay.locator("button").allInnerTexts().catch(() => []);
  const inputs = overlay.locator("input:not([type=hidden]):not([type=file])");
  const inputCount = await inputs.count().catch(() => 0);

  const record = { page: pageLabel, opener, role: role || "", title: (title || "").replace(/\s+/g, " ").slice(0, 60), buttons: buttons.map((b) => b.trim()).filter(Boolean).slice(0, 10), inputs: inputCount };
  dialogs.push(record);

  // 对话框里能安全试一下输入：填值再取消，不提交
  if (role === "dialog" || role === "alertdialog") {
    for (let i = 0; i < Math.min(inputCount, 6); i += 1) {
      const inp = inputs.nth(i);
      const info = await readControl(inp).catch(() => null);
      if (!info || info.disabled || info.type === "password" || info.readOnly) continue;
      const original = await inp.inputValue().catch(() => "");
      if (info.type === "number") await inp.fill("1").catch(() => {});
      else if (info.type === "email") await inp.fill("audit@example.com").catch(() => {});
      else if (info.type === "url") await inp.fill("https://example.com").catch(() => {});
      else await inp.fill("交互审计").catch(() => {});
      await page.waitForTimeout(60);
      await inp.fill(original).catch(() => {});
    }
  }

  // 空提交校验：只对含 required 输入的表单弹窗点一次主按钮，然后关闭
  if ((role === "dialog") && inputCount > 0) {
    const required = await overlay.locator("input[required], textarea[required], select[required]").count().catch(() => 0);
    const submit = overlay.locator('button[type="submit"], button:has-text("保存"), button:has-text("创建"), button:has-text("提交")').first();
    if (required > 0 && (await submit.count()) > 0) {
      await submit.click({ timeout: 1500 }).catch(() => {});
      await page.waitForTimeout(350);
      const errText = await overlay.locator('[role="alert"], .text-danger-text, [data-slot="form-message"]').first().innerText().catch(() => "");
      record.validation = Boolean(errText);
      if (!errText) addIssue(pageLabel, "validation", "弹窗「" + record.title + "」必填项为空提交后无可见校验提示", opener);
    }
  }

  // 关闭：优先取消类按钮，其次 Esc
  let closed = false;
  for (const name of buttons) {
    if (!CANCEL_WORDS.test(name.replace(/\s+/g, ""))) continue;
    const btn = overlay.getByRole("button", { name, exact: false }).first();
    if ((await btn.count()) > 0) {
      await btn.click({ timeout: 1500 }).catch(() => {});
      closed = true;
      break;
    }
  }
  if (!closed) await page.keyboard.press("Escape");
  await page.waitForTimeout(320);
  for (let attempt = 0; attempt < 3 && (await overlay.isVisible().catch(() => false)); attempt += 1) {
    await page.keyboard.press("Escape");
    await page.waitForTimeout(220);
  }
  // AlertDialog 之类不响应 Esc 的弹层，再点一次取消类按钮兜底
  if (await overlay.isVisible().catch(() => false)) {
    for (const name of buttons) {
      if (!CANCEL_WORDS.test(name.replace(/\s+/g, ""))) continue;
      const btn = overlay.getByRole("button", { name, exact: false }).first();
      if ((await btn.count()) > 0) {
        await btn.click({ timeout: 1500 }).catch(() => {});
        break;
      }
    }
    await page.waitForTimeout(300);
  }
  if (await overlay.isVisible().catch(() => false)) {
    addIssue(pageLabel, "dialog", "「" + (record.title || opener) + "」弹出层无法关闭（无取消按钮且 Esc 无效）", opener);
  }
  record.closed = !(await overlay.isVisible().catch(() => false));
  return record;
}

async function exerciseInput(page, pageLabel, loc, info, slot) {
  if (info.disabled || info.readOnly) return;
  if (!slot) return;
  // 单元格重渲染会换掉输入框节点：每次读写前都允许按身份重新定位。
  const refind = () => locateByIdentity(page, slot.identity, slot.occurrence).catch(ignoreDomError);
  const type = info.type || "text";
  if (["checkbox", "radio", "hidden", "file", "password", "submit", "button", "range", "color", "date", "datetime-local", "time", "month", "week"].includes(type)) {
    if (type === "checkbox" || type === "radio") {
      const before = info.checked;
      await robustClick(page, pageLabel, loc, controlLabel(info), refind);
      await page.waitForTimeout(150);
      const fresh = await refind();
      const after = fresh ? await fresh.isChecked().catch(() => before) : before;
      if (after !== before && fresh) await robustClick(page, pageLabel, fresh, controlLabel(info), refind);
    }
    return;
  }
  let original = await loc.inputValue({ timeout: 2500 }).catch(() => null);
  if (original === null) {
    const fresh = await refind();
    if (fresh) {
      loc = fresh;
      original = await loc.inputValue({ timeout: 2500 }).catch(() => "");
    } else {
      original = "";
    }
  }
  const probe = type === "number" ? "1" : type === "email" ? "audit@example.com" : type === "url" ? "https://example.com" : "交互审计";
  const clicked = await robustClick(page, pageLabel, loc, controlLabel(info), refind);
  if (!clicked) return;
  const probed = await robustFill(page, pageLabel, loc, controlLabel(info), probe, refind);
  if (probed.disabled) {
    skipped.push({ page: pageLabel, control: controlLabel(info), reason: "操作时已禁用（异步状态变化，如流式响应中）" });
    return;
  }
  if (probed.gone) {
    skipped.push({ page: pageLabel, control: controlLabel(info), reason: "输入过程中控件被页面卸载（编辑态/面板切换）" });
    return;
  }
  loc = probed.loc || loc;
  await page.waitForTimeout(120);
  await page.keyboard.press("Escape").catch(() => {});
  const restored = await robustFill(page, pageLabel, loc, controlLabel(info), original, refind);
  loc = restored.loc || loc;
  await page.evaluate(() => { const active = document.activeElement; if (active && typeof active.blur === "function") active.blur(); }).catch(ignoreDomError);
}

async function exerciseSelect(page, pageLabel, loc, info) {
  if (info.disabled) return;
  await robustClick(page, pageLabel, loc, controlLabel(info));
  await page.waitForTimeout(220);
  const options = page.locator('[role="option"]:visible');
  const count = await options.count().catch(() => 0);
  if (count === 0) {
    addIssue(pageLabel, "interaction", "选择器展开后没有可选项", controlLabel(info));
    await page.keyboard.press("Escape").catch(() => {});
    return;
  }
  const target = options.nth(count > 1 ? 1 : 0);
  await robustClick(page, pageLabel, target, controlLabel(info) + " 选项");
  await page.waitForTimeout(220);
}

/** 轮询等待行内「确认/确定」按钮出现（React 状态更新有一拍延迟；页面繁忙时单次读取可能拿不到）。 */
async function waitVisibleConfirmIncrease(page, beforeCount, timeout = 2000) {
  const deadline = Date.now() + timeout;
  let labels = [];
  while (Date.now() < deadline) {
    labels = await visibleConfirmLabels(page);
    if (labels.length > beforeCount) return labels;
    await page.waitForTimeout(150);
  }
  return labels;
}

/** 可见的「确认/确定」类按钮文本，用于识别行内二次确认（非弹窗，例如删除会话）。 */
async function visibleConfirmLabels(page) {
  return evalGuarded(page, () => {
    const labels = [];
    for (const node of Array.from(document.querySelectorAll("button, [role='button'], a"))) {
      const text = (node.getAttribute("aria-label") || node.getAttribute("title") || node.innerText || "").trim();
      if (!text || !/^(确认|确定)/.test(text)) continue;
      const rect = node.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) labels.push(text);
    }
    return labels;
  }).catch(() => []);
}

async function exerciseButton(page, pageLabel, loc, info, sessionState, slot) {
  const label = controlLabel(info);
  const refind = slot ? () => locateByIdentity(page, slot.identity, slot.occurrence).catch(ignoreDomError) : null;
  const beforeUrl = page.url();
  const beforeErrors = sessionState.consoleErrors.length;
  const confirmBefore = isDestructive(label) ? await visibleConfirmLabels(page) : [];
  // 原生 window.confirm 也是二次确认：无头模式必须自己接住，否则会一直挂着。
  let nativeDialog = false;
  const onNativeDialog = (dialog) => {
    nativeDialog = true;
    dialog.dismiss().catch(() => {});
  };
  page.on("dialog", onNativeDialog);
  try {
    await loc.click({ timeout: 3500 });
  } catch (error) {
    // React 重渲染可能把节点换掉：先按身份找回，再 force 点一次，仍失败才算不可交互。
    const moved = refind ? await refind() : null;
    if (moved) loc = moved;
    try {
      await loc.click({ timeout: 2500, force: true });
      addIssue(pageLabel, "occluded", "控件「" + label + "」普通点击超时，force 点击可用（可能被临时遮挡）", label);
    } catch (retryError) {
      page.off("dialog", onNativeDialog);
      // 点击期间控件随页面状态卸载（面板/编辑态切换）：不算交互缺陷。
      const gone = refind ? !(await refind()) : false;
      if (gone) return;
      addIssue(pageLabel, "interaction", "点击失败（不可交互？）：" + shortError(retryError), label);
      return;
    }
  }
  await page.waitForTimeout(450);
  page.off("dialog", onNativeDialog);

  const overlay = await closeOverlay(page, pageLabel, label);
  // 行内二次确认（如 playground「删除会话」点一下换成「确认删除」图标按钮）不是弹窗，同样算有确认步骤。
  const confirmAfter = isDestructive(label) ? await waitVisibleConfirmIncrease(page, confirmBefore.length) : [];
  const inlineConfirm = confirmAfter.length > confirmBefore.length;
  if (isDestructive(label) && nativeDialog) {
    // 原生 confirm 已弹过（已 dismiss），算有二次确认。
  } else if (overlay) {
    if (isDestructive(label) && overlay.role === "dialog") {
      // 有二次确认，符合预期
    } else if (isDestructive(label) && !overlay.role) {
      addIssue(pageLabel, "safety", "危险操作「" + label + "」没有二次确认弹窗", label);
    }
  } else if (isDestructive(label) && !inlineConfirm) {
    addIssue(pageLabel, "safety", "危险操作「" + label + "」点击后无确认弹窗（可能直接执行）", label);
  }

  const toastText = await page.locator("[data-sonner-toast]").last().innerText({ timeout: 300 }).catch(() => "");
  if (toastText && /失败|错误|异常|不可用/.test(toastText)) {
    addIssue(pageLabel, "toast", "操作「" + label + "」提示异常：" + toastText.replace(/\s+/g, " ").slice(0, 80), label);
  }

  const freshErrors = sessionState.consoleErrors.slice(beforeErrors);
  // 422 是审计主动提交不完整表单触发的服务端校验，页面已用 toast 提示：记为软问题 validation，
  // 其余 console error 才算硬失败。
  const expected422 = freshErrors.filter((e) => /status of 422/.test(e));
  const realErrors = freshErrors.filter((e) => !/status of 422/.test(e));
  if (realErrors.length > 0) {
    addIssue(pageLabel, "console", "点击「" + label + "」后 console error：" + realErrors.slice(-2).join(" | ").slice(0, 160), label);
  }
  if (expected422.length > 0 && toastText) {
    addIssue(pageLabel, "validation", "点击「" + label + "」提交不完整表单，后端返回 422（页面已提示）", label);
  }

  if (page.url() !== beforeUrl) {
    addIssue(pageLabel, "navigation", "点击「" + label + "」发生跳转 -> " + new URL(page.url()).pathname, label);
    sessionState.navigated = true;
  }
}

async function exerciseControl(page, pageLabel, loc, info, slot, sessionState) {
  const label = controlLabel(info);
  const refind = () => locateByIdentity(page, slot.identity, slot.occurrence).catch(ignoreDomError);
  // 前面的操作可能改变依赖状态（例如选了状态码后「仅有错误」变禁用），操作前重新读一次，禁用就跳过
  let fresh = await readControl(loc).catch(() => null);
  if (!fresh) {
    // 旧节点已被 React 换掉：按身份重定位后再读一次。
    const moved = await locateByIdentity(page, slot.identity, slot.occurrence).catch(ignoreDomError);
    if (moved) {
      loc = moved;
      fresh = await readControl(loc).catch(() => null);
    }
  }
  if (fresh && (fresh.disabled || fresh.readOnly)) {
    sessionState.skippedDisabled = (sessionState.skippedDisabled || 0) + 1;
    return;
  }
  if (!info.ariaLabel && !info.placeholder && !info.text && !info.labelText && !info.name && !info.href && info.tag !== "select") {
    addIssue(pageLabel, "a11y", "控件没有可读名称（aria-label/文本/placeholder 都为空）：" + (info.html || "").slice(0, 160), info.tag + " role=" + (info.role || "-"));
  }

  if (info.tag === "input") return exerciseInput(page, pageLabel, loc, info, slot);
  if (info.tag === "textarea") return exerciseInput(page, pageLabel, loc, info, slot);
  if (info.tag === "select") {
    const options = await loc.locator("option").count().catch(() => 0);
    if (options <= 1) addIssue(pageLabel, "interaction", "原生选择器只有 " + options + " 个选项", label);
    const original = await loc.inputValue().catch(() => "");
    const values = await loc.locator("option").evaluateAll((els) => els.map((el) => el.value));
    const next = values.find((v) => v !== original);
    if (next !== undefined) {
      await loc.selectOption(next).catch(() => {});
      await page.waitForTimeout(120);
      await loc.selectOption(original).catch(() => {});
    }
    return;
  }
  if (info.role === "tab") {
    if (info.disabled) return;
    await loc.click({ timeout: 2500 }).catch((e) => addIssue(pageLabel, "interaction", "Tab 切换失败：" + shortError(e), label));
    await page.waitForTimeout(350);
    // 点击后 React 常替换节点且状态更新可能异步：按身份轮询实时 aria-selected。
    const state = await waitState(page, slot.identity, slot.occurrence, (s) => s.selected === true);
    const selected = state ? state.selected : info.selected === true;
    if (!selected) addIssue(pageLabel, "interaction", "Tab「" + label + "」点击后未选中", label);
    return;
  }
  if (info.role === "combobox" || info.hasPopup === "listbox") {
    await exerciseSelect(page, pageLabel, loc, info);
    return;
  }
  if (info.role === "switch" || info.role === "checkbox" || info.role === "radio") {
    const before = info.checked;
    await robustClick(page, pageLabel, loc, label, refind);
    await page.waitForTimeout(180);
    const valueOf = (state) => (state === null ? null : state.checkedAttr !== null ? state.checkedAttr === "true" : state.pressedAttr !== null ? state.pressedAttr === "true" : state.nativeChecked);
    // 点击后节点可能被替换、状态更新也可能异步：轮询到「与点击前不同」或超时。
    const changed = await waitState(page, slot.identity, slot.occurrence, (s) => valueOf(s) !== null && valueOf(s) !== before, 2500);
    const now = valueOf(changed);
    // 开关与复选本来就能来回切；只有单选组「未激活项点了没反应」才是问题。
    if (info.role === "radio" && now === false) addIssue(pageLabel, "interaction", "单选项「" + label + "」点击后没有激活", label);
    if (now !== null && now !== before) {
      const flipLoc = await locateByIdentity(page, slot.identity, slot.occurrence).catch(ignoreDomError);
      if (flipLoc) await robustClick(page, pageLabel, flipLoc, label, refind);
      // 尽量把开关/复选恢复到原状态，避免审计留下副作用。
      await waitState(page, slot.identity, slot.occurrence, (s) => valueOf(s) === before, 2500);
    }
    return;
  }
  if (info.tag === "a") {
    if (!info.href || info.href === "#" || info.href.startsWith("javascript")) return;
    if (info.href.startsWith("http") && !info.href.startsWith(BASE)) {
      addIssue(pageLabel, "link", "外部链接：" + info.href, label);
      return;
    }
    // 链接不逐一点击：页面清单已覆盖全部导航目标；这里只校验 href 可解析
    const target = new URL(info.href, page.url());
    if (target.origin !== new URL(BASE).origin) addIssue(pageLabel, "link", "跨站链接：" + info.href, label);
    return;
  }
  // button / role=button
  if (info.tag === "button" || info.role === "button") return exerciseButton(page, pageLabel, loc, info, sessionState, slot);
}

/* ------------------------------------------------------------------ *
 * 页面审计
 * ------------------------------------------------------------------ */

/** 采集 main 内全部可见控件，并给每个节点打 data-audit-id 精确标记。 */
async function collectControls(page, selector = CONTROL_SELECTOR) {
  const start = (auditSeq += 10000);
  const raw = await evalGuarded(page, ({ selector: sel, start: offset }) => {
    const textOf = (node) => (node.innerText || node.textContent || "").replace(/\s+/g, " ").trim();
    const list = [];
    for (const node of Array.from(document.querySelectorAll(sel))) {
      if (node.getAttribute("aria-hidden") === "true" || node.closest('[aria-hidden="true"]')) continue;
      const style = getComputedStyle(node);
      if (style.visibility === "hidden" || style.display === "none") continue;
      const rect = node.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;
      const id = String(offset + list.length);
      node.setAttribute("data-audit-id", id);
      list.push({
        id,
        tag: node.tagName.toLowerCase(),
        role: node.getAttribute("role") || "",
        type: (node.getAttribute("type") || "").toLowerCase(),
        // title 也提供可访问名称（图标按钮常用 title 标注），不能只认 aria-label。
        ariaLabel: node.getAttribute("aria-label") || node.getAttribute("title") || "",
        placeholder: node.getAttribute("placeholder") || "",
        text: textOf(node).slice(0, 70),
        // 表单控件常靠外层 <label> 或 label[for] 命名，同样算可读名称。
        labelText: (node.closest("label") || (node.id ? document.querySelector('label[for="' + node.id + '"]') : null))?.innerText?.replace(/\s+/g, " ").trim().slice(0, 60) || "",
        href: node.getAttribute("href") || "",
        name: node.getAttribute("name") || node.id || "",
        disabled: node.disabled === true || node.getAttribute("aria-disabled") === "true",
        readOnly: node.readOnly === true,
        hasPopup: node.getAttribute("aria-haspopup") || "",
        checked: node.checked === true || node.getAttribute("aria-checked") === "true",
        selected: node.getAttribute("aria-selected") === "true",
        hidden: false,
        x: Math.round(rect.left),
        y: Math.round(rect.top),
        tagName: node.tagName,
        // 无名称控件定位用：出问题时直接看到外层 HTML。
        html: node.outerHTML.replace(/\s+/g, " ").slice(0, 200),
      });
    }
    return list;
  }, { selector, start });
  return raw.map((info) => ({ id: info.id, info }));
}

async function auditPage(page, sessionState, [pathName, title]) {
  const label = title + " " + pathName;
  const startedAt = Date.now();
  const beforeConsole = sessionState.consoleErrors.length;
  const consoleErrors = sessionState.consoleErrors;
  const pageName = pathName === "/" ? "root" : pathName;
  console.log("\n## " + label);
  try {
    await page.goto(BASE + pathName, { waitUntil: "domcontentloaded", timeout: 30000 });
    if (new URL(page.url()).pathname.startsWith("/login")) {
      const relogin = await login(page, ADMIN, { baseUrl: BASE });
      if (!relogin.ok) addIssue(label, "fatal", "会话失效后重新登录失败：" + relogin.message);
      await page.goto(BASE + pathName, { waitUntil: "domcontentloaded", timeout: 30000 });
    }
    await settle(page);
    const text = await page.locator("main").first().innerText().catch(() => "");
    if (!text || text.trim().length < 5) addIssue(label, "layout", "内容区为空（白屏或渲染失败）");
    if (text.includes("页面渲染失败")) addIssue(label, "layout", "命中错误边界「页面渲染失败」");
    if (/\bNaN\b/.test(text)) addIssue(label, "data", "页面出现 NaN");
    if (/\bundefined\b/.test(text)) addIssue(label, "data", "页面出现 undefined");
    if (/正在校验权限/.test(text)) addIssue(label, "layout", "权限校验卡住");

    const pending = [];
    const queued = new Set();
    let discovered = await enqueueControls(page, pending, queued);
    if (discovered === 0) {
      // 冷编译/慢接口时首屏可能还在加载：再等一拍重扫一次，仍为 0 才记问题。
      await page.waitForTimeout(3000);
      await settle(page);
      discovered = await enqueueControls(page, pending, queued);
      if (discovered === 0) addIssue(label, "layout", "内容区没有可操作控件（可能一直加载中或渲染失败）");
    }
    const snapshot = { page: label, path: pathName, controls: 0, exercised: 0, disabled: 0, disappeared: 0, truncated: 0, navigated: false, issues: 0, dialogs: 0, ms: 0 };
    sessionState.pageUrl = page.url();
    sessionState.navigated = false;
    let attempted = 0;
    const loopStart = Date.now();
    while (pending.length > 0) {
      // 内容区优先：顶部标签/筛选一换，其余控件可能被整体替换，先点下面的。
      pending.sort((a, b) => (b.y || 0) - (a.y || 0));
      if (attempted >= MAX_CONTROLS) {
        snapshot.truncated += pending.length;
        break;
      }
      const item = pending.shift();
      let loc = await locateByIdentity(page, item.identity, item.occurrence);
      if (!loc) {
        // 点击筛选/刷新后页面可能短暂进入加载态，给一次短暂等待再按身份找回。
        await page.waitForTimeout(350);
        loc = await locateByIdentity(page, item.identity, item.occurrence);
      }
      if (!loc) {
        stats.disappeared += 1;
        snapshot.disappeared += 1;
        skipped.push({ page: label, control: controlLabel(item.info), reason: "重渲染/面板切换后控件不再出现" });
        continue;
      }
      const fresh = await readControl(loc).catch(() => null);
      if (!fresh) {
        stats.disappeared += 1;
        snapshot.disappeared += 1;
        skipped.push({ page: label, control: controlLabel(item.info), reason: "控件读取失败/已脱离 DOM" });
        continue;
      }
      if (fresh.disabled || fresh.readOnly) {
        stats.disabled += 1;
        snapshot.disabled += 1;
        continue;
      }
      attempted += 1;
      if (process.env.AUDIT_TRACE) console.log("  · [" + attempted + "/" + queued.size + "] +" + (Date.now() - loopStart) + "ms " + controlLabel(fresh) + " <" + fresh.tag + (fresh.role ? " role=" + fresh.role : "") + ">");
      try {
        await exerciseControl(page, label, loc, fresh, item, sessionState);
        snapshot.exercised += 1;
        stats.exercised += 1;
      } catch (error) {
        addIssue(label, "interaction", "操作异常：" + shortError(error), controlLabel(fresh));
      }
      // 点到链接可能整页跳走：能回到本页就继续，回不来才算截断。
      if (sessionState.navigated) {
        const back = await page.goBack({ waitUntil: "domcontentloaded", timeout: 10000 }).catch(() => null);
        if (back && page.url().startsWith(BASE + pathName)) {
          sessionState.navigated = false;
          await settle(page);
        } else {
          snapshot.navigated = true;
          snapshot.truncated += pending.length;
          break;
        }
      }
      // 动态重扫：标签页/筛选/弹层切换后新出现的控件也纳入本次审计。
      try {
        await enqueueControls(page, pending, queued);
      } catch (error) {
        // 重扫失败不阻塞已有队列，下一次操作后再试。
      }
    }
    snapshot.controls = queued.size;
    stats.controls += queued.size;

    snapshot.dialogs = dialogs.filter((d) => d.page === label).length;
    snapshot.issues = issues.filter((i) => i.page === label).length;
    snapshot.ms = Date.now() - startedAt;
    const pageConsoleAll = consoleErrors.slice(beforeConsole);
    // 422 已在具体操作处记为 validation 软问题；这里只把真正未处理的 console error 计入硬失败，
    // 避免同一次表单校验被重复报成硬失败。
    const pageValidation = pageConsoleAll.filter((e) => /status of 422/.test(e));
    snapshot.consoleErrors = pageConsoleAll.filter((e) => !/status of 422/.test(e));
    if (pageValidation.length > 0) addIssue(label, "validation", "页面在审计操作中收到 " + pageValidation.length + " 次 422（表单校验失败，页面已提示）");
    if (snapshot.consoleErrors.length > 0) {
      addIssue(label, "console", "页面 console error：" + snapshot.consoleErrors.slice(0, 2).join(" | ").slice(0, 180));
    }
    if (sessionState.pageErrors.length > sessionState.pageErrorBase) {
      addIssue(label, "pageerror", "未捕获异常：" + sessionState.pageErrors.slice(sessionState.pageErrorBase).join(" | ").slice(0, 180));
      sessionState.pageErrorBase = sessionState.pageErrors.length;
    }
    pages.push(snapshot);
    console.log("  controls=" + snapshot.controls + " exercised=" + snapshot.exercised + " disabled=" + snapshot.disabled + " disappeared=" + snapshot.disappeared + " dialogs=" + snapshot.dialogs + " issues=" + snapshot.issues + (snapshot.truncated ? " truncated=" + snapshot.truncated : "") + (snapshot.navigated ? " NAVIGATED" : ""));
    await page.screenshot({ path: path.join(OUT, safeName(pageName) + ".png"), fullPage: true }).catch(() => {});
  } catch (error) {
    addIssue(label, "fatal", "页面审计失败：" + shortError(error));
    pages.push({ page: label, path: pathName, controls: 0, exercised: 0, disabled: 0, disappeared: 0, truncated: 0, navigated: false, issues: 1, dialogs: 0, ms: Date.now() - startedAt });
  }
}

/* ------------------------------------------------------------------ *
 * 全局外壳 + 登录页
 * ------------------------------------------------------------------ */

async function auditShell(page, sessionState) {
  const label = "全局外壳";
  console.log("\n## " + label);
  await page.goto(BASE + "/", { waitUntil: "domcontentloaded" });
  await settle(page);
  const header = page.locator("header");
  const before = sessionState.consoleErrors.length;

  // 1) 侧栏折叠按钮
  const collapse = header.locator('button[aria-label], button[title]');
  const buttons = await collapse.all();
  for (const btn of buttons) {
    const info = await readControl(btn).catch(() => null);
    if (!info) continue;
    const name = info.ariaLabel || info.text;
    if (!/折叠|展开|侧栏|导航|主题|深色|浅色|系统|搜索|刷新|帮助|切换/.test(name)) continue;
    await btn.click({ timeout: 2500 }).catch((e) => addIssue(label, "interaction", "外壳按钮「" + name + "」点击失败：" + shortError(e), name));
    await page.waitForTimeout(220);
    const overlay = await closeOverlay(page, label, name);
    if (overlay && !overlay.closed) continue;
  }

  // 2) 全局搜索
  await page.keyboard.press("Control+k").catch(() => {});
  await page.waitForTimeout(300);
  const palette = page.locator('[role="dialog"]').first();
  if (await palette.isVisible().catch(() => false)) {
    const input = palette.locator("input").first();
    await input.fill("模型").catch(() => {});
    await page.waitForTimeout(400);
    const rows = palette.locator('[role="option"], li, button');
    const count = await rows.count().catch(() => 0);
    if (count === 0) addIssue(label, "interaction", "Ctrl+K 搜索「模型」没有结果");
    else await rows.first().click({ timeout: 2000 }).catch(() => {});
    await page.waitForTimeout(400);
    if (await palette.isVisible().catch(() => false)) {
      addIssue(label, "interaction", "全局搜索选中结果后未关闭");
      await page.keyboard.press("Escape");
    }
  } else {
    addIssue(label, "interaction", "Ctrl+K 没有打开全局搜索");
  }

  // 3) 用户菜单
  const userTrigger = header.locator('button:has-text("管理用户"), button[aria-haspopup="menu"]').first();
  if ((await userTrigger.count()) > 0) {
    await userTrigger.click({ timeout: 2500 }).catch(() => {});
    await page.waitForTimeout(300);
    const menu = page.locator('[role="menu"]').first();
    if (!(await menu.isVisible().catch(() => false))) addIssue(label, "interaction", "头像菜单点开后没有 menu");
    else {
      const items = await menu.locator('[role="menuitem"], button, a').allInnerTexts().catch(() => []);
      if (items.length === 0) addIssue(label, "interaction", "头像菜单为空");
      await page.keyboard.press("Escape");
      await page.waitForTimeout(200);
      if (await menu.isVisible().catch(() => false)) addIssue(label, "interaction", "头像菜单无法用 Esc 关闭");
    }
  }

  // 4) 主题三态（切完恢复浅色）
  const themeButtons = header.locator('button[aria-label*="浅色"], button[aria-label*="深色"], button[aria-label*="系统"]');
  const themeCount = await themeButtons.count();
  for (let i = 0; i < themeCount; i += 1) {
    await themeButtons.nth(i).click({ timeout: 2000 }).catch(() => {});
    await page.waitForTimeout(200);
  }
  const readTheme = async () => evalGuarded(page, () => ({ html: document.documentElement.className, dataTheme: document.documentElement.getAttribute("data-theme") || "", colorScheme: getComputedStyle(document.documentElement).colorScheme })).catch(() => null);
  const themeBefore = await readTheme();
  const darkBtn = header.locator('button[aria-label*="深色"]').first();
  if ((await darkBtn.count()) > 0) {
    await darkBtn.click({ timeout: 2000 }).catch(() => {});
    await page.waitForTimeout(300);
    const darkened = await readTheme();
    if (!darkened || (darkened.html === (themeBefore && themeBefore.html) && darkened.dataTheme === (themeBefore && themeBefore.dataTheme) && darkened.colorScheme === (themeBefore && themeBefore.colorScheme))) {
      addIssue(label, "interaction", "点击「深色」主题后页面主题没有变化（class/data-theme/color-scheme 都没变）");
    }
    const lightBtn = header.locator('button[aria-label*="浅色"]').first();
    if ((await lightBtn.count()) > 0) await lightBtn.click().catch(() => {});
    await page.waitForTimeout(200);
  } else {
    addIssue(label, "interaction", "顶栏缺少「深色」主题按钮（仅找到 " + (await themeCount) + " 个主题按钮）");
  }

  if (sessionState.pageErrors.length > sessionState.pageErrorBase) {
    addIssue(label, "pageerror", "外壳未捕获异常：" + sessionState.pageErrors.slice(sessionState.pageErrorBase).join(" | ").slice(0, 160));
  }
}

async function auditLogin(browser) {
  const label = "登录页";
  console.log("\n## " + label);
  const startedAt = Date.now();
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "zh-CN", baseURL: BASE });
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  // 登录页走独立 context，console 过滤与主 context 共用同一套规则（接受 401 探测）。
  const { consoleErrors, pageErrors } = attachConsoleCollector(page, { ignore: CONSOLE_IGNORE, allowUnauthorized: true });
  await page.goto(BASE + "/login", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(500);
  // 实测登录页控件数，不再硬编码；错误密码流程真实操作 3 个控件。
  const discovered = await collectControls(page, "input, button, a[href]");
  stats.controls += discovered.length;
  let exercised = 0;
  const user = page.locator("#login-username");
  const pass = page.locator("#login-password");
  if ((await user.count()) > 0) {
    await user.fill("交互审计").then(() => { exercised += 1; }).catch(() => addIssue(label, "interaction", "用户名输入框不可输入"));
  }
  if ((await pass.count()) > 0) {
    await pass.fill("wrong-password").then(() => { exercised += 1; }).catch(() => addIssue(label, "interaction", "密码输入框不可输入"));
  }
  const submit = page.locator('button[type="submit"]').first();
  if ((await submit.count()) > 0) {
    await submit.click({ timeout: 5000 }).then(() => { exercised += 1; }).catch(() => addIssue(label, "interaction", "登录提交按钮点击失败"));
  }
  stats.exercised += exercised;
  await page.waitForTimeout(1200);
  const errorText = await page.locator("p.text-danger-text").first().innerText().catch(() => "");
  if (!errorText) addIssue(label, "interaction", "错误密码提交后没有错误提示");
  if (!new URL(page.url()).pathname.startsWith("/login")) addIssue(label, "interaction", "错误密码竟然登录成功");
  const hasForm = (await page.locator("#login-username").count()) > 0;
  const title = await page.title().catch(() => "");
  if (!hasForm || !title.includes("驭流")) addIssue(label, "layout", "登录页内容异常（表单或标题缺失）");
  if (consoleErrors.length > 0) addIssue(label, "console", "登录页 console error：" + consoleErrors.slice(0, 2).join(" | ").slice(0, 160));
  if (pageErrors.length > 0) addIssue(label, "pageerror", "登录页未捕获异常：" + pageErrors.slice(0, 2).join(" | ").slice(0, 160));
  await page.screenshot({ path: path.join(OUT, "login.png"), fullPage: true }).catch(() => {});
  pages.push({ page: label, path: "/login", controls: discovered.length, exercised, disabled: 0, disappeared: 0, truncated: 0, navigated: false, issues: issues.filter((i) => i.page === label).length, dialogs: 0, ms: Date.now() - startedAt });
  await context.close();
}

/* ------------------------------------------------------------------ *
 * 报告
 * ------------------------------------------------------------------ */

function writeReport(status) {
  const hard = issues.filter((i) => HARD_KINDS.includes(i.kind));
  const counts = {
    pages: pages.length,
    controls: stats.controls,
    exercised: stats.exercised,
    disabled: stats.disabled,
    disappeared: stats.disappeared,
    truncated: pages.reduce((sum, p) => sum + (p.truncated || 0), 0),
    issues: issues.length,
    hard: hard.length,
    dialogs: dialogs.length,
    mutations: mutations.length,
  };
  const report = {
    meta: { baseUrl: BASE, apiUrl: API, startedAt: new Date().toISOString(), finishedAt: new Date().toISOString(), status, strict: STRICT, maxControls: MAX_CONTROLS, out: OUT },
    counts,
    pages,
    issues,
    dialogs,
    mutations,
    skipped,
  };
  fs.writeFileSync(path.join(OUT, "report.json"), JSON.stringify(report, null, 2));
  const lines = [];
  lines.push("# Slipstream 全站交互审计");
  lines.push("");
  lines.push("- 管理台：" + BASE + " · 控制面：" + API);
  lines.push("- 结果：" + status + " · 硬失败 " + counts.hard + " · 问题 " + counts.issues + (STRICT ? "（--strict）" : "") + " · 每页上限 " + MAX_CONTROLS);
  lines.push("- 页面：" + counts.pages + "（含登录页）· 发现控件 " + counts.controls + " · 已操作 " + counts.exercised + " · 禁用 " + counts.disabled + " · 重渲染后未操作 " + counts.disappeared + " · 因跳转/上限未操作 " + counts.truncated);
  lines.push("- 口径：发现控件 = 动态重扫到的不同控件身份数（结构 + 首行文本 + 第 n 次出现）；重渲染后未操作 = 身份已记录但操作时已不可见（标签页/筛选/弹层切换或列表刷新）。");
  lines.push("- 弹层：" + counts.dialogs + " · 变更请求（DELETE 成功）：" + counts.mutations);
  lines.push("");
  lines.push("## 页面明细");
  lines.push("");
  lines.push("| 页面 | 发现控件 | 已操作 | 禁用 | 重渲染后未操作 | 因跳转/上限未操作 | 弹层 | 问题 | 耗时 | 备注 |");
  lines.push("|---|---|---|---|---|---|---|---|---|---|");
  for (const p of pages) {
    const note = (p.truncated ? "截断 " + p.truncated + " 个" : "") + (p.navigated ? " 发生跳转" : "");
    lines.push("| " + p.page + " (" + p.path + ") | " + p.controls + " | " + p.exercised + " | " + (p.disabled || 0) + " | " + (p.disappeared || 0) + " | " + (p.truncated || 0) + " | " + p.dialogs + " | " + p.issues + " | " + Math.round(p.ms / 1000) + "s | " + note + " |");
  }
  lines.push("");
  lines.push("## 问题清单（" + issues.length + "）");
  const byKind = {};
  for (const i of issues) (byKind[i.kind] = byKind[i.kind] || []).push(i);
  if (issues.length === 0) lines.push("- 无");
  for (const kind of Object.keys(byKind)) {
    lines.push("");
    lines.push("### " + kind + "（" + byKind[kind].length + "）");
    for (const i of byKind[kind]) lines.push("- " + i.page + "：" + i.detail + (i.control ? "（" + i.control + "）" : ""));
  }
  lines.push("");
  lines.push("## 打开过的弹层（" + dialogs.length + "）");
  for (const d of dialogs) lines.push("- " + d.page + " · 「" + (d.title || d.opener) + "」 role=" + (d.role || "-") + " buttons=[" + d.buttons.join(" / ") + "] 关闭=" + d.closed + (d.validation === undefined ? "" : " 空提交校验=" + d.validation));
  if (dialogs.length === 0) lines.push("- 无");
  lines.push("");
  lines.push("## 本次审计产生的写请求（" + mutations.length + "）");
  for (const m of mutations) lines.push("- " + m.method + " " + m.url + " -> " + m.status);
  if (mutations.length === 0) lines.push("- 无");
  lines.push("");
  lines.push("## 重渲染后未操作（" + skipped.length + "）");
  for (const s of skipped) lines.push("- " + s.page + " · " + s.control + "：" + s.reason);
  if (skipped.length === 0) lines.push("- 无");
  lines.push("");
  fs.writeFileSync(path.join(OUT, "report.md"), lines.join("\n") + "\n");
  console.log("\n报告：" + path.relative(ROOT, OUT).replace(/\\/g, "/") + "/report.md");
}

/* ------------------------------------------------------------------ *
 * main
 * ------------------------------------------------------------------ */

async function main() {
  console.log("# Slipstream 全站交互审计");
  console.log("管理台 " + BASE + " · 控制面 " + API + " · 每页上限 " + MAX_CONTROLS + (STRICT ? " · strict" : ""));
  const pw = await loadPlaywright();
  if (!pw) {
    console.error("缺少 playwright / playwright-core：cd web && npm i -D playwright-core");
    process.exit(2);
  }
  try {
    loadPages();
  } catch (error) {
    console.error(String((error && error.message) || error));
    process.exit(2);
  }
  const health = await fetch(API + "/admin/health").catch((error) => ({ ok: false, status: 0, error: String(error.message || error) }));
  if (!health.ok) {
    console.error("控制面不可达：" + API);
    process.exit(2);
  }
  const launched = await launchBrowser(pw, { channel: CHANNEL, headed: HEADED });
  const browser = launched.browser;
  const sessionState = { consoleErrors: [], pageErrors: [], pageErrorBase: 0, pageUrl: "", navigated: false };
  let fatal = null;
  let envError = false;
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "zh-CN", baseURL: BASE });
    const page = await context.newPage();
    page.setDefaultTimeout(15000);
    Object.assign(sessionState, attachConsoleCollector(page, { ignore: CONSOLE_IGNORE }));
    page.on("dialog", (dialog) => void dialog.dismiss().catch(() => {}));
    page.on("response", (response) => {
      const url = response.url();
      if (!url.includes("/admin/")) return;
      const status = response.status();
      const method = response.request().method();
      if (status >= 500) addIssue("网络", "http", method + " " + url.replace(/^https?:\/\/[^/]+/, "") + " -> " + status);
      if (method === "DELETE" && status < 400) mutations.push({ method, url: url.replace(/^https?:\/\/[^/]+/, ""), status });
    });

    // 登录管理员（登录失败属于环境/种子问题：退出码 2，与 acceptance 一致）
    const loginOutcome = await login(page, ADMIN, { baseUrl: BASE });
    if (!loginOutcome.ok) {
      envError = true;
      throw new Error("管理员登录失败：" + loginOutcome.message);
    }

    // 详情页：取第一个上游 id
    const upstreams = await page.request.get(API + "/admin/upstreams", { headers: { Accept: "application/json" } }).then((r) => r.json()).catch(() => null);
    const list = Array.isArray(upstreams) ? upstreams : upstreams && (upstreams.items || upstreams.data || upstreams.upstreams);
    const firstId = Array.isArray(list) && list[0] ? list[0].id : null;
    // --only 时不要偷偷注入详情页，否则限定单页调试会被详情页拖慢
    const wantsDetail = !ONLY || ONLY.some((p) => p === "/upstreams" || p.startsWith("/upstreams/"));
    if (firstId && wantsDetail) {
      const at = PAGES.findIndex((entry) => entry[0] === "/upstreams");
      const detailPath = "/upstreams/" + firstId;
      PAGES.splice(at >= 0 ? at + 1 : PAGES.length, 0, [detailPath, labelForPath(ROUTE_TABLE, detailPath)]);
    }

    for (const entry of PAGES) await auditPage(page, sessionState, entry);
    await auditShell(page, sessionState);
    await auditLogin(browser);
  } catch (error) {
    fatal = error;
    addIssue("审计", "fatal", "审计中断：" + shortError(error));
  } finally {
    const hardCount = issues.filter((i) => HARD_KINDS.includes(i.kind)).length;
    const status = fatal ? "error" : hardCount > 0 ? "failed" : "passed";
    writeReport(status);
    await browser.close().catch(() => {});
  }
  const hard = issues.filter((i) => HARD_KINDS.includes(i.kind));
  const strictFails = STRICT ? issues.filter((i) => !HARD_KINDS.includes(i.kind)) : [];
  console.log("\nSUMMARY pages=" + pages.length + " controls=" + stats.controls + " exercised=" + stats.exercised + " disabled=" + stats.disabled + " disappeared=" + stats.disappeared + " dialogs=" + dialogs.length + " issues=" + issues.length + " hard=" + hard.length + " strict=" + STRICT);
  const exitCode = envError ? 2 : fatal ? 1 : hard.length > 0 ? 1 : STRICT && strictFails.length > 0 ? 1 : 0;
  console.log("REPORT " + path.relative(ROOT, OUT).replace(/\\/g, "/") + "/report.md");
  process.exit(exitCode);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
