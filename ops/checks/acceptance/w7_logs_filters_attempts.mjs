#!/usr/bin/env node
/**
 * W7 ticket 06 验收：日志筛选安静化 + 尝试链收进模型格（spec User Stories 25–33、
 * Implementation Decisions「交互与界面-日志」、Testing Decisions 必测矩阵「日志」）。
 *
 * 覆盖：
 *   1. 常驻「筛选已修改」提示删除——加载与 dirty 状态下都不出现（US 25）；
 *   2. 查询按钮默认白底（surface，与普通操作按钮同级）、dirty 变强调色（primary）、
 *      查询后恢复默认（US 26/28）；
 *   3. 改动的筛选输入框出现黄色边框（warning），未改动输入框不变；查询后恢复（US 27）；
 *   4. 独立「尝试」列删除（US 29）；
 *   5. 分叉图标只在 attempts_count > 0 的模型格出现（US 30）；
 *   6. 点图标开 popover：每行模型/状态/耗时；点尝试行展开错误详情——长错误全文在
 *      展开区可见（US 31/32）；
 *   7. 键盘可打开 popover 并展开尝试行（Testing Decisions 键盘用例）；
 *   8. requested_model 缺失只显示实际上游模型，无「请求模型未记录」占位、
 *      模型格内无输入框样式元素（US 33）；
 *   9. 375 宽度无横向溢出，查询按钮与分叉图标可用（spec 响应式约定）。
 *
 * 运行：
 *   node ops/checks/acceptance/w7_logs_filters_attempts.mjs            # 自起隔离站点：API 3900 + web 3901
 *   node ops/checks/acceptance/w7_logs_filters_attempts.mjs --base-url http://127.0.0.1:3901
 *   node ops/checks/acceptance/w7_logs_filters_attempts.mjs --headed
 *
 * 前提：web/dist 已构建（cd web && npx vite build）。脚本自管 seed/服务进程，结束后全部清理；
 * 使用临时 SQLite 与临时 ag-config，绝不触碰 3700/3600 与主仓库工作树。
 * seed 不含尝试链/requested_model 缺失行：夹具直接写入临时 SQLite（seed 后、起服务前），
 * 事件挪进默认 24h 窗口并排到页首，保证断言稳定。
 *
 * 退出码：0 全部 PASS；1 有 FAIL；2 环境/依赖未就绪。
 * 证据：ops/checks/.logs/acceptance/w7-logs-filters-<时间戳>/（report.md + *.png，.logs/ 不入库）。
 */
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { launchBrowser, loadPlaywright, parseCred, parseFlags, stamp } from "../lib/cli.mjs";
import { openSession, settle } from "../lib/session.mjs";
import { createIsolatedSite, pythonExecutable } from "../lib/isolated-site.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..", "..", "..");
const WEB_ROOT = path.join(ROOT, "web");
const API_ROOT = path.join(ROOT, "api");

const flags = parseFlags(process.argv.slice(2));
const API_PORT = Number(flags.get("api-port") || process.env.W7_LOGS_API_PORT || 3900);
const WEB_PORT = Number(flags.get("web-port") || process.env.W7_LOGS_WEB_PORT || 3901);
const HEADED = flags.has("headed");
const CHANNEL = flags.get("channel") || process.env.PLAYWRIGHT_CHANNEL || "";
const REUSE = Boolean(flags.get("base-url"));
const BASE_URL = (flags.get("base-url") || "").replace(/\/$/, "");
const ADMIN_CRED = parseCred(flags.get("admin") || process.env.W6_ADMIN, { user: "admin", pass: "admin12345" });
const OUT = path.resolve(flags.get("out") || path.join(ROOT, "ops", "checks", ".logs", "acceptance", "w7-logs-filters-" + stamp()));
fs.mkdirSync(OUT, { recursive: true });

/* DOM 契约（实现必须提供的稳定选择器）。 */
const QUERY_BUTTON = '[data-slot="logs-query-button"]';
const TRIGGER = '[data-slot="log-attempts-trigger"]';
const POPOVER = '[data-slot="log-attempts-popover"]';
const ATTEMPT_ROW = '[data-slot="attempt-row"]';
const ATTEMPT_DETAIL = '[data-slot="attempt-detail"]';
const ATTEMPT_DETAIL_BODY = '[data-slot="attempt-detail-body"]';
const KEYWORD_INPUT = 'input[aria-label="关键词或查询语法"]';
const MODEL_COMBO = '[role="combobox"][aria-label="按公开模型筛选"]';
const STATUS_SELECT = '[aria-label="按状态筛选"]';
const RESET_BUTTON = 'button:has-text("重置")';

const results = [];
let currentEvidence = [];
let browser = null;
/** 夹具内容：seed 之后由 afterSeed 钩子写入库并回填。 */
let fixture = null;
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

/** 列表响应既可能是裸数组也可能是 {items} 信封（与前端 unwrapList 同口径）。 */
function listItems(body) {
  if (Array.isArray(body)) return body;
  return body && Array.isArray(body.items) ? body.items : [];
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
 * 1. 隔离站点：API 3900 + web 3901（静态托管 + /admin、/api 反代）
 * ------------------------------------------------------------------ */

function applyFixture(databaseFile) {
  const fixtureFile = path.join(OUT, "fixture.json");
  const script = `
import json, sqlite3, sys, time
db, out = sys.argv[1], sys.argv[2]
LONG_A = "upstream connection reset by peer while reading the response stream (w7-logs-fixture-a)"
LONG_B = "upstream 503 service unavailable: peer pool exhausted while draining inflight requests (w7-logs-fixture-b)"
now = int(time.time() * 1000)
conn = sqlite3.connect(db)
cur = conn.cursor()
cur.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='request_attempts'")
assert cur.fetchone(), "request_attempts table missing"
cur.execute("SELECT event_id, requested_model, upstream_model FROM gateway_usage_events WHERE requested_model != '' AND upstream_model != '' ORDER BY started_at_ms DESC LIMIT 2")
rows = cur.fetchall()
assert len(rows) == 2, "seed rows missing: " + str(len(rows))
(event_a, req_a, _up_a), (event_b, _req_b, up_b) = rows
cur.execute("UPDATE gateway_usage_events SET correlation_key='fx_chain_a', started_at_ms=?, duration_ms=1500, http_status=200, error='' WHERE event_id=?", (now - 60_000, event_a))
cur.execute("UPDATE gateway_usage_events SET correlation_key='fx_chain_b', started_at_ms=?, requested_model='', duration_ms=900, http_status=200, error='' WHERE event_id=?", (now - 120_000, event_b))
attempt_rows = [
    ("fx_chain_a", 1, "fx-up-a1", req_a, 500, "500", LONG_A, now - 61_000, 600, "error"),
    ("fx_chain_a", 2, "fx-up-a2", req_a, 200, "", "", now - 60_400, 900, "ok"),
    ("fx_chain_b", 1, "fx-up-b1", up_b, 503, "503", LONG_B, now - 121_000, 700, "error"),
    ("fx_chain_b", 2, "fx-up-b2", up_b, 200, "", "", now - 120_300, 200, "ok"),
]
for key, no, ref, model, status, etype, emsg, started, dur, outcome in attempt_rows:
    cur.execute(
        "INSERT OR REPLACE INTO request_attempts (correlation_key, attempt_no, upstream_ref, model, status_code, error_type, error_message, started_at_ms, duration_ms, outcome, adapter_id, recorded_at_ms)"
        " VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
        (key, no, ref, model, status, etype, emsg, started, dur, outcome, "seedfx", now),
    )
conn.commit()
conn.close()
with open(out, "w", encoding="utf-8") as fh:
    json.dump({
        "event_a": event_a, "requested_model_a": req_a,
        "event_b": event_b, "upstream_model_b": up_b,
        "long_error_a": LONG_A, "long_error_b": LONG_B,
    }, fh, ensure_ascii=False)
print("fixture ok")
`;
  const result = spawnSync(pythonExecutable(API_ROOT), ["-I", "-c", script, databaseFile, fixtureFile], {
    encoding: "utf8",
    timeout: 60_000,
  });
  if (result.status !== 0) {
    throw new CheckError("夹具写入失败：" + String(result.stderr || result.stdout || "").slice(-800));
  }
  return JSON.parse(fs.readFileSync(fixtureFile, "utf8"));
}

const isolatedSite = createIsolatedSite({
  apiRoot: API_ROOT,
  webRoot: WEB_ROOT,
  apiPort: API_PORT,
  webPort: WEB_PORT,
  outDir: OUT,
  dbName: "w7-logs-filters.db",
  secretKey: "w7-logs-filters-acceptance-only",
  adminCred: ADMIN_CRED,
  afterSeed: (databaseFile) => {
    fixture = applyFixture(databaseFile);
  },
});

/* ------------------------------------------------------------------ *
 * 2. 页面与读取助手
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

async function openLogs(session) {
  const page = session.page;
  await page.goto(session.base + "/logs", { waitUntil: "domcontentloaded", timeout: 30000 });
  await settle(page, { quietMs: 400 });
  await session.assertSane("使用日志");
}

/** 从主题 token 取参考色（独立事实源：不写死色值，跟浅/深主题走）。 */
async function themeColors(page) {
  return page.evaluate(() => {
    const probe = (cssVar, prop) => {
      const el = document.createElement("span");
      el.style[prop] = "var(" + cssVar + ")";
      el.style.display = "none";
      document.body.appendChild(el);
      const value = getComputedStyle(el)[prop];
      el.remove();
      return value;
    };
    return {
      surface: probe("--surface", "backgroundColor"),
      primary: probe("--primary", "backgroundColor"),
      border: probe("--border", "borderTopColor"),
      warning: probe("--warning", "borderTopColor"),
    };
  });
}

async function styleOf(page, selector, prop) {
  return page.evaluate(
    ({ sel, prop: cssProp }) => {
      const el = document.querySelector(sel);
      return el ? getComputedStyle(el)[cssProp] : null;
    },
    { sel: selector, prop },
  );
}

/** 表头文本（Data Table 语义表头）。 */
async function readHeaders(page) {
  return page.evaluate(() =>
    [...document.querySelectorAll("thead th")].map((el) => (el.textContent || "").trim()),
  );
}

async function mainHasHint(page) {
  const text = await page.locator("main").first().innerText();
  return text.includes("筛选已修改");
}

async function rowGeometry(page) {
  return page.evaluate(() => ({
    docWidth: document.documentElement.scrollWidth,
    viewWidth: window.innerWidth,
    rows: [...document.querySelectorAll('[data-testid="data-table-body"] tr')].length,
  }));
}

/** 让筛选进入 dirty：在关键词框输入文本（不改变结果集语义之外的控件）。 */
async function makeDirty(page) {
  await page.locator(KEYWORD_INPUT).fill("w7-fixture-dirty");
  await page.waitForTimeout(200);
}

/** 与 UI 默认查询同参：24h 窗口 + started_at 倒序——seed 的「今天」事件可能落在未来，
 * 未过滤的 /admin/logs 会把它们排在夹具行前面，必须带窗口过滤才能对上页面第一页。 */
async function logsPage(session, pageSize = 50) {
  const to = Date.now();
  const from = to - 24 * 3_600_000;
  const response = await session.page.request.get(
    session.apiBase +
      "/admin/logs?page_size=" + pageSize +
      "&sort=started_at&order=desc&from_ms=" + from + "&to_ms=" + to,
    { headers: { Accept: "application/json" } },
  );
  const body = await response.json().catch(() => null);
  assert(response.status() === 200 && body, "读取日志失败：HTTP " + response.status());
  return listItems(body);
}

/* ------------------------------------------------------------------ *
 * 3. 验收项
 * ------------------------------------------------------------------ */

async function runChecks(session, fixture) {
  const page = session.page;
  const colors = await themeColors(page);

  await test("hint.removed", "常驻「筛选已修改」提示删除：加载态与 dirty 态都不出现（US 25）", async () => {
    await openLogs(session);
    assert(!(await mainHasHint(page)), "页面加载后不得出现「筛选已修改」提示");
    await makeDirty(page);
    assert(!(await mainHasHint(page)), "筛选 dirty 后也不得出现「筛选已修改」提示");
    const text = await page.locator("main").first().innerText();
    assert(!text.includes("点「查询」生效"), "旧提示文案「点「查询」生效」必须整体删除");
    await page.locator(RESET_BUTTON).click();
    await page.waitForTimeout(300);
    assert(!(await mainHasHint(page)), "重置后同样不得出现提示");
    await shot(page, "logs-quiet-filters");
    return "加载/dirty/重置三态均无提示文案";
  });

  await test("querybutton.states", "查询按钮默认白底（surface）→ dirty 变强调色（primary）→ 查询后恢复（US 26/28）", async () => {
    await openLogs(session);
    const bgDefault = await styleOf(page, QUERY_BUTTON, "backgroundColor");
    assert(bgDefault === colors.surface, "默认查询按钮背景应为 var(--surface)（白底），实际 " + bgDefault + " 期望 " + colors.surface);
    await makeDirty(page);
    const bgDirty = await styleOf(page, QUERY_BUTTON, "backgroundColor");
    assert(bgDirty === colors.primary, "dirty 查询按钮背景应为 var(--primary)（强调色），实际 " + bgDirty + " 期望 " + colors.primary);
    await page.locator(QUERY_BUTTON).click();
    await settle(page, { quietMs: 400 });
    // 点击会把指针留在按钮上，hover 态会盖住恢复后的底色——先移开再读。
    await page.mouse.move(0, 0);
    await page.waitForTimeout(200);
    const bgApplied = await styleOf(page, QUERY_BUTTON, "backgroundColor");
    assert(bgApplied === colors.surface, "查询后按钮背景应恢复 var(--surface)，实际 " + bgApplied);
    await shot(page, "logs-query-button");
    return "surface → primary → surface";
  });

  await test("input.dirtyborder", "改动的筛选输入框黄边（warning），未改动输入框不变；查询后恢复（US 27）", async () => {
    await openLogs(session);
    const keywordBorder = await styleOf(page, KEYWORD_INPUT, "borderTopColor");
    assert(keywordBorder === colors.border, "未改动关键词框边框应为 var(--border)，实际 " + keywordBorder);

    await makeDirty(page);
    const dirtyBorder = await styleOf(page, KEYWORD_INPUT, "borderTopColor");
    assert(dirtyBorder === colors.warning, "dirty 关键词框边框应为 var(--warning)，实际 " + dirtyBorder + " 期望 " + colors.warning);

    // combobox dirty：选一个公开模型。
    await page.locator(MODEL_COMBO).click();
    await page.waitForTimeout(300);
    await page.locator("[cmdk-item]").nth(1).click();
    await page.waitForTimeout(300);
    const comboBorder = await styleOf(page, MODEL_COMBO, "borderTopColor");
    assert(comboBorder === colors.warning, "dirty 模型筛选框边框应为 var(--warning)，实际 " + comboBorder);

    // status select dirty：选「2XX 成功」。
    await page.locator(STATUS_SELECT).click();
    await page.waitForTimeout(300);
    await page.getByRole("option", { name: "2XX 成功" }).click();
    await page.waitForTimeout(300);
    const selectBorder = await styleOf(page, STATUS_SELECT, "borderTopColor");
    assert(selectBorder === colors.warning, "dirty 状态筛选框边框应为 var(--warning)，实际 " + selectBorder);

    await page.locator(QUERY_BUTTON).click();
    await settle(page, { quietMs: 400 });
    const appliedKeyword = await styleOf(page, KEYWORD_INPUT, "borderTopColor");
    const appliedCombo = await styleOf(page, MODEL_COMBO, "borderTopColor");
    const appliedSelect = await styleOf(page, STATUS_SELECT, "borderTopColor");
    assert(appliedKeyword === colors.border, "查询后关键词框边框应恢复 var(--border)，实际 " + appliedKeyword);
    assert(appliedCombo === colors.border, "查询后模型筛选框边框应恢复 var(--border)，实际 " + appliedCombo);
    assert(appliedSelect === colors.border, "查询后状态筛选框边框应恢复 var(--border)，实际 " + appliedSelect);
    await shot(page, "logs-dirty-border");
    return "keyword/combobox/select 三类输入框黄边 + 查询后恢复";
  });

  await test("column.removed", "独立「尝试」列删除（US 29）", async () => {
    await openLogs(session);
    const headers = await readHeaders(page);
    assert(!headers.includes("尝试"), "表头不得再有「尝试」列，实际：" + JSON.stringify(headers));
    assert(headers.some((text) => text.includes("模型")), "模型列应仍在：" + JSON.stringify(headers));
    await shot(page, "logs-no-attempts-column");
    return "表头 " + JSON.stringify(headers);
  });

  await test("fork.gating", "分叉图标只在 attempts_count > 0 的模型格出现（US 30）", async () => {
    await openLogs(session);
    const items = (await logsPage(session)).slice(0, 10);
    const withChain = items.filter((item) => (item.attempts_count ?? 0) > 0);
    assert(withChain.length >= 2, "夹具应提供 ≥2 行带尝试链的日志，实际 " + withChain.length);
    const triggerCount = await page.locator(TRIGGER).count();
    assert(triggerCount === withChain.length, "分叉图标数量应等于带链行数 " + withChain.length + "，实际 " + triggerCount);
    const triggerEventIds = await page.evaluate(
      (sel) => [...document.querySelectorAll(sel)].map((el) => el.getAttribute("data-event-id")),
      TRIGGER,
    );
    for (const item of withChain) {
      assert(
        triggerEventIds.includes(item.event_id),
        "带链行 " + item.event_id + "（attempts_count=" + item.attempts_count + "）应有分叉图标，实际触发器：" + JSON.stringify(triggerEventIds),
      );
    }
    for (const item of items.filter((row) => (row.attempts_count ?? 0) === 0)) {
      assert(!triggerEventIds.includes(item.event_id), "无链行 " + item.event_id + " 不得出现分叉图标");
    }
    await shot(page, "logs-fork-gating");
    return triggerCount + " 个图标 = 带链行 " + withChain.length;
  });

  await test("popover.content", "点分叉图标开 popover：每行模型/状态/耗时；点尝试行展开错误全文（US 31/32）", async () => {
    await openLogs(session);
    await page.locator(TRIGGER + '[data-event-id="' + fixture.event_a + '"]').click();
    await page.locator(POPOVER).waitFor({ state: "visible", timeout: 8000 });
    await page.locator(POPOVER + " " + ATTEMPT_ROW).first().waitFor({ state: "visible", timeout: 8000 });
    const popoverText = await page.locator(POPOVER).innerText();
    assert(popoverText.includes("路由链 · 2 次尝试"), "popover 应显示尝试轮数，实际：" + JSON.stringify(popoverText.slice(0, 120)));
    assert(popoverText.includes("总耗时"), "popover 应显示总耗时");
    const rows = page.locator(POPOVER + " " + ATTEMPT_ROW);
    assert((await rows.count()) === 2, "popover 应有 2 个尝试行，实际 " + (await rows.count()));
    const firstText = (await rows.nth(0).innerText()).replace(/\s+/g, " ");
    assert(firstText.includes(fixture.requested_model_a), "第 1 行应包含模型 " + fixture.requested_model_a + "，实际：" + firstText);
    assert(firstText.includes("500"), "第 1 行应包含状态码 500，实际：" + firstText);
    assert(firstText.includes("0.60s"), "第 1 行应包含耗时 0.60s，实际：" + firstText);
    const secondText = (await rows.nth(1).innerText()).replace(/\s+/g, " ");
    assert(secondText.includes("200"), "第 2 行应包含状态码 200，实际：" + secondText);
    assert(secondText.includes("0.90s"), "第 2 行应包含耗时 0.90s，实际：" + secondText);

    // 折叠态不给全文（closed details 内容不渲染）；点尝试行 → 展开错误详情（长错误完整可见）。
    const detailBody = page.locator(POPOVER + " " + ATTEMPT_DETAIL_BODY).first();
    assert(!(await detailBody.isVisible()), "折叠态不得展示错误详情区");
    await rows.nth(0).click();
    await page.waitForTimeout(300);
    assert(await detailBody.isVisible(), "点尝试行后应展开错误详情");
    const detailText = await detailBody.innerText();
    assert(detailText.includes(fixture.long_error_a), "展开区必须包含错误全文，实际：" + JSON.stringify(detailText.slice(0, 200)));
    await shot(page, "logs-attempts-popover");
    await page.keyboard.press("Escape");
    await page.waitForTimeout(200);
    assert((await page.locator(POPOVER).count()) === 0 || !(await page.locator(POPOVER).isVisible().catch(() => false)), "Escape 应关闭 popover");
    return "2 行（模型/状态/耗时）+ 点击展开错误全文";
  });

  await test("popover.keyboard", "键盘可打开 popover 并展开尝试行（键盘用例）", async () => {
    await openLogs(session);
    const trigger = page.locator(TRIGGER + '[data-event-id="' + fixture.event_a + '"]');
    await trigger.focus();
    await page.keyboard.press("Enter");
    await page.locator(POPOVER).waitFor({ state: "visible", timeout: 8000 });
    await page.locator(POPOVER + " " + ATTEMPT_ROW).first().waitFor({ state: "visible", timeout: 8000 });
    // 挂载焦点可能落在容器（加载态无 tabbable）：行渲染后若焦点不在尝试行控件上，Tab 一次。
    const readFocus = () =>
      page.evaluate((sel) => {
        const popover = document.querySelector(sel);
        const active = document.activeElement;
        return {
          inside: Boolean(popover && active && popover.contains(active)),
          isSummary: active instanceof HTMLElement && active.tagName === "SUMMARY",
        };
      }, POPOVER);
    let rowFocus = await readFocus();
    if (!rowFocus.inside || !rowFocus.isSummary) {
      await page.keyboard.press("Tab");
      rowFocus = await readFocus();
    }
    assert(rowFocus.inside && rowFocus.isSummary, "键盘后焦点应落在 popover 内的尝试行展开控件上");
    await page.keyboard.press("Enter");
    await page.waitForTimeout(300);
    const openCount = await page.evaluate(
      (sel) => {
        const popover = document.querySelector(sel);
        const details = popover ? popover.querySelectorAll("[data-slot='attempt-detail']") : [];
        return [...details].filter((el) => el.hasAttribute("open")).length;
      },
      POPOVER,
    );
    assert(openCount >= 1, "键盘 Enter 应展开当前聚焦的尝试行，实际展开 " + openCount + " 个");
    // 明确对第一行做键盘展开：错误全文必须可达。若该行已展开则不再按键（Enter 是开关）。
    const firstDetail = page.locator(POPOVER + " " + ATTEMPT_DETAIL).first();
    if (!(await firstDetail.evaluate((el) => el.hasAttribute("open")))) {
      await page.locator(POPOVER + " " + ATTEMPT_DETAIL).first().locator("summary").focus();
      await page.keyboard.press("Enter");
      await page.waitForTimeout(200);
    }
    assert(await firstDetail.evaluate((el) => el.hasAttribute("open")), "键盘 Enter 应展开第一个尝试行");
    const detailText = await page.locator(POPOVER + " " + ATTEMPT_DETAIL_BODY).first().innerText();
    assert(detailText.includes(fixture.long_error_a), "键盘展开后应能看到错误全文，实际：" + JSON.stringify(detailText.slice(0, 200)));
    await shot(page, "logs-attempts-keyboard");
    await page.keyboard.press("Escape");
    await page.waitForTimeout(200);
    return "Enter 开 popover → 焦点入内 → Enter 展开行";
  });

  await test("model.missing", "requested_model 缺失只显示上游模型：无占位文案、无输入框样式（US 33）", async () => {
    await openLogs(session);
    const text = await page.locator("main").first().innerText();
    assert(!text.includes("请求模型未记录"), "页面不得再出现「请求模型未记录」占位");
    const logs = await logsPage(session);
    const missing = logs.find((item) => item.requested_model === "");
    assert(Boolean(missing), "夹具应有一行 requested_model 缺失的日志");
    assert(missing.upstream_model === fixture.upstream_model_b, "缺失行上游模型应与夹具一致");
    const cell = await page.evaluate(
      (eventId) => {
        const trigger = document.querySelector('[data-slot="log-attempts-trigger"][data-event-id="' + eventId + '"]');
        if (!trigger) return null;
        const td = trigger.closest("td");
        if (!td) return null;
        const firstLine = td.querySelector("p");
        return {
          text: (td.textContent || "").trim(),
          firstLine: firstLine ? (firstLine.textContent || "").trim() : "",
          hasInput: Boolean(td.querySelector("input")),
        };
      },
      fixture.event_b,
    );
    assert(cell, "缺失行模型格应带分叉图标（事件 " + fixture.event_b + "）");
    assert(!cell.hasInput, "模型格不得渲染成输入框样式（含 input 元素）");
    assert(cell.firstLine === fixture.upstream_model_b, "缺失行模型格首行应直接是上游模型 " + fixture.upstream_model_b + "，实际：" + JSON.stringify(cell.firstLine));
    await shot(page, "logs-model-missing");
    return "上游模型 " + fixture.upstream_model_b + " 直出，无占位";
  });

  await test("layout.375", "375 宽度无横向溢出，查询按钮与分叉图标可用（响应式约定）", async () => {
    const previous = page.viewportSize();
    await page.setViewportSize({ width: 375, height: 800 });
    await page.goto(session.base + "/logs", { waitUntil: "domcontentloaded", timeout: 30000 });
    await settle(page, { quietMs: 400 });
    await session.assertSane("使用日志(375)");
    const geo = await rowGeometry(page);
    assert(geo.docWidth <= geo.viewWidth + 1, "375 下不得出现文档级横向溢出：" + geo.docWidth + " > " + geo.viewWidth);
    assert(await page.locator(QUERY_BUTTON).isVisible(), "375 下查询按钮应可见");
    const trigger = page.locator(TRIGGER).first();
    assert(await trigger.isVisible(), "375 下分叉图标应可见");
    await trigger.click();
    await page.locator(POPOVER).waitFor({ state: "visible", timeout: 8000 });
    assert(await page.locator(POPOVER).isVisible(), "375 下点图标应能打开 popover");
    const popoverWidth = await page.evaluate(
      (sel) => document.querySelector(sel)?.getBoundingClientRect().width ?? 0,
      POPOVER,
    );
    assert(popoverWidth <= 375, "popover 不得超出 375 视口：宽 " + popoverWidth);
    await shot(page, "logs-mobile-375");
    await page.keyboard.press("Escape");
    await page.setViewportSize(previous);
    await page.waitForTimeout(200);
    return "docWidth " + geo.docWidth + " ≤ 375；popover 宽 " + Math.round(popoverWidth);
  });
}

/* ------------------------------------------------------------------ *
 * 4. 主流程
 * ------------------------------------------------------------------ */

async function main() {
  if (!REUSE && (API_PORT === 3700 || WEB_PORT === 3700)) {
    console.error("拒绝在 3700 上运行（隔离端口应为 3900/3901）");
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
    console.log("复用已起站点：" + base + "（复用模式需自行保证夹具存在）");
    fixture = {
      event_a: process.env.W7_LOGS_EVENT_A || "",
      requested_model_a: "",
      event_b: process.env.W7_LOGS_EVENT_B || "",
      upstream_model_b: process.env.W7_LOGS_UPSTREAM_B || "",
      long_error_a: process.env.W7_LOGS_LONG_ERR_A || "",
      long_error_b: "",
    };
    if (!fixture.event_a) {
      console.error("复用模式必须提供 W7_LOGS_EVENT_A / W7_LOGS_UPSTREAM_B / W7_LOGS_LONG_ERR_A");
      process.exitCode = 2;
      return;
    }
  }

  const launched = await launchBrowser(playwright, { channel: CHANNEL, headed: HEADED });
  browser = launched.browser;

  try {
    const session = await openSession(browser, { base, apiBase: base, role: "admin" });
    const outcome = await session.login(ADMIN_CRED);
    assert(outcome.ok, "登录失败：" + outcome.message);
    await runChecks(session, fixture);
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
    "# W7 ticket 06 · 日志筛选与尝试链浏览器验收",
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
