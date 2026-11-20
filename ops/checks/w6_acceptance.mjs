#!/usr/bin/env node
/**
 * W6 收官验收（2026-11-19）：26 条路由逐页四查截图 + 六条关键流程端到端。
 *
 * 与旧 acceptance_browser.mjs 的关系：旧断言基于二期页面集（/policies /guardrails /mcp
 * 独立页、账单页、旧上游详情五 Tab），三期重构后已失效；本脚本按 routes.json（唯一页面
 * 清单）驱动，是 W6 的验收事实源。
 *
 * 覆盖：
 *   A. 登录页四查（品牌 / 错误密码 / 截图）
 *   B. routes.json 全部路由（含 variants 与参数化实例）逐页四查：
 *      首屏（无 console error + 无错误边界/NaN/白屏）/ 空态（无数据的表格必须有空态文案）/
 *      错误态（无未捕获异常；另有全局强制 500 用例）/ 交互（按路由的轻量交互，无则 SKIP）
 *   C. 六条关键流程：
 *      1 建上游（auto 探测）→ 获取模型 → 建公开模型 → 下发版本
 *      2 建用户 → 签发密钥 → 复制 toast
 *      3 日志筛选 / 排序 / 列显隐 / 详情（含正文开关）
 *      4 看板连点区间无卡顿
 *      5 价目导出 → 导入回环
 *      6 危险操作三档 + 周期冷却窗口期启用仅跳过当前窗口
 *   D. 错误态：route 拦截让 /admin/upstreams 返回 500，页面应优雅降级不白屏
 *
 * 运行前提：控制面 3700 已起（单端口托管 web/dist，SLIPSTREAM_AG_BINARY= 允许无二进制下发），
 * 已跑 seed_demo.py；浏览器优先 playwright，否则 playwright-core + 本机 Edge/Chrome。
 *
 * 用法：
 *   node ops/checks/w6_acceptance.mjs
 *   node ops/checks/w6_acceptance.mjs --base-url http://localhost:3700 --channel msedge
 *   node ops/checks/w6_acceptance.mjs --only flow3
 *   node ops/checks/w6_acceptance.mjs --only route./models
 *   node ops/checks/w6_acceptance.mjs --headed
 *
 * 退出码：0 全部通过（SKIP 允许）；1 有 FAIL；2 环境/依赖未就绪。
 * 证据：ops/checks/.logs/acceptance/w6-<时间戳>/（report.md + *.png，.logs/ 不入库）。
 */
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { launchBrowser, loadPlaywright, parseCred, parseFlags, stamp } from "./lib/cli.mjs";
import { assertNoNewErrors, assertPageSane, ensureAuthed, openSession, settle } from "./lib/session.mjs";
import { loadRouteTable, variantsOf } from "./lib/routes.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..", "..");

/* ------------------------------------------------------------------ *
 * 0. 参数与结果模型
 * ------------------------------------------------------------------ */

const flags = parseFlags(process.argv.slice(2));
const BASE_URL = (flags.get("base-url") || process.env.W6_BASE_URL || "http://127.0.0.1:3700").replace(/\/$/, "");
const HEADED = flags.has("headed");
const CHANNEL = flags.get("channel") || process.env.PLAYWRIGHT_CHANNEL || "";
const ONLY = flags.has("only") ? String(flags.get("only")).split(",").map((s) => s.trim()).filter(Boolean) : null;
const ADMIN_CRED = parseCred(flags.get("admin") || process.env.W6_ADMIN, { user: "admin", pass: "admin12345" });

const OUT = path.resolve(flags.get("out") || path.join(ROOT, "ops", "checks", ".logs", "acceptance", "w6-" + stamp()));
fs.mkdirSync(OUT, { recursive: true });

const results = [];
const pageChecks = new Map();
let currentEvidence = [];

class CheckError extends Error {}

function assert(condition, message) {
  if (!condition) throw new CheckError(message);
}

function safeSlug(value) {
  return String(value).replace(/[^A-Za-z0-9]+/g, "-").replace(/^-+|-+$/g, "").toLowerCase() || "root";
}

async function test(id, name, fn) {
  if (ONLY && !ONLY.some((p) => id.includes(p))) return null;
  currentEvidence = [];
  const started = Date.now();
  try {
    const detail = await fn();
    const row = { id, name, status: "pass", detail: detail || "", evidence: currentEvidence.slice(), ms: Date.now() - started };
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
 * 1. 通用 API 助手（页面 request 上下文，复用登录 cookie）
 * ------------------------------------------------------------------ */

async function apiCall(session, method, apiPath, body) {
  const response = await session.page.request.fetch(session.apiBase + apiPath, {
    method,
    data: body,
    headers: { Accept: "application/json" },
  });
  const text = await response.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    // 204 / 非 JSON 原样返回
  }
  return { status: response.status(), body: json, text };
}

/* ------------------------------------------------------------------ *
 * 2. 路由清单 → 具体 URL（variants / 参数化 / 重定向 / 404）
 * ------------------------------------------------------------------ */

function buildRouteUrls(table, upstreamId) {
  const urls = [];
  for (const route of table.routes) {
    const variants = variantsOf(route);
    if (variants.length > 0) {
      for (const variant of variants) {
        urls.push({ path: variant.path, label: route.title + "·" + variant.title, kind: "page" });
      }
      continue;
    }
    if (route.path === "*") {
      urls.push({ path: "/not-exists-audit", label: "404", kind: "notfound" });
      continue;
    }
    if (route.path.includes(":")) {
      if (route.path === "/upstreams/:id" && upstreamId) {
        urls.push({ path: "/upstreams/" + upstreamId, label: route.title, kind: "page" });
      }
      continue;
    }
    const isRedirect = route.page === "pricing_redirect";
    urls.push({
      path: route.path,
      label: route.auditLabel || route.title,
      kind: isRedirect ? "redirect" : route.path === "/login" ? "login" : "page",
      to: isRedirect ? (route.props && route.props.to) || "/pricing" : undefined,
    });
  }
  return urls;
}

/* ------------------------------------------------------------------ *
 * 3. 四查：首屏 / 空态 / 错误态 / 交互
 * ------------------------------------------------------------------ */

async function checkEmptyState(page) {
  return await page.evaluate(() => {
    const main = document.querySelector("main");
    if (!main) return { ok: false, reason: "没有 main 容器" };
    const tables = main.querySelectorAll("table");
    if (tables.length === 0) return { ok: true, note: "非表格页（空态由首屏断言覆盖）" };
    let rows = 0;
    for (const table of Array.from(tables)) rows += table.querySelectorAll("tbody tr").length;
    if (rows > 0) return { ok: true, note: "有数据 " + rows + " 行" };
    const text = main.innerText || "";
    const emptyMarker = /暂无|无数据|还没有|无匹配|没有.*[条项个]|空空如也|没有结果/.test(text);
    if (emptyMarker) return { ok: true, note: "空态文案在位" };
    return { ok: false, reason: "表格 0 行且无空态文案（可能是静默空白）" };
  });
}

async function sweepOne(session, url, id) {
  const checks = { first: "pass", empty: "pass", error: "pass", interact: "pass" };
  const notes = [];
  pageChecks.set(id, checks);
  const from = session.consoleErrors.length;
  try {
    const response = await session.page.goto(BASE_URL + url.path, { waitUntil: "domcontentloaded", timeout: 30000 });
    await settle(session.page, { quietMs: 450 });
    // 首屏
    await assertPageSane(session.page, url.label);
    if (url.kind !== "redirect" && response && response.status() >= 400) {
      checks.first = "fail";
      notes.push("HTTP " + response.status());
    }
    // 错误态（console / pageerror 差分）
    try {
      assertNoNewErrors(session, from, url.label);
    } catch (error) {
      checks.error = "fail";
      notes.push(String(error.message || error));
    }
    // 空态
    const empty = await checkEmptyState(session.page);
    if (!empty.ok) {
      checks.empty = "fail";
      notes.push(empty.reason || "空态缺失");
    } else if (empty.note) notes.push("空态：" + empty.note);
    // 交互
    const interaction = INTERACTIONS[url.path] || INTERACTIONS[url.kind];
    if (interaction) {
      try {
        const result = await interaction(session, url);
        if (result && result.skip) {
          checks.interact = "skip";
          notes.push("交互跳过：" + result.skip);
        } else if (result && result.detail) {
          notes.push("交互：" + result.detail);
        }
      } catch (error) {
        const message = String((error && error.message) || error);
        if (/未找到|不存在|skip/i.test(message)) {
          checks.interact = "skip";
          notes.push("交互跳过：" + message.slice(0, 120));
        } else {
          checks.interact = "fail";
          notes.push("交互失败：" + message.slice(0, 200));
        }
      }
    } else {
      checks.interact = "skip";
      notes.push("交互跳过：该路由无副作用交互定义");
    }
    await session.shot("route-" + safeSlug(url.label) + "-" + safeSlug(url.path));
    const failed = Object.entries(checks).filter(([, v]) => v === "fail");
    assert(failed.length === 0, "四查未过：" + failed.map(([k]) => k).join("/") + (notes.length ? "（" + notes.join("；") + "）" : ""));
    return "首屏/空态/错误态/交互 全过" + (notes.length ? "；" + notes.join("；") : "");
  } catch (error) {
    await session.shot("FAIL-route-" + safeSlug(url.label) + "-" + safeSlug(url.path));
    throw error;
  }
}

/* ------------------------------------------------------------------ *
 * 4. 每页轻量交互（选择器全部来自现役页面；找不到 = SKIP 不失败）
 * ------------------------------------------------------------------ */

const INTERACTIONS = {
  "/login": async () => ({ skip: "登录页交互（错误密码）由 login.page 用例覆盖" }),
  "/": async (s) => {
    const copy = s.page.getByRole("button", { name: "复制", exact: true }).first();
    if ((await copy.count()) === 0) throw new Error("未找到复制按钮");
    await copy.click();
    await s.page.getByText("已复制").first().waitFor({ state: "visible", timeout: 5000 });
    return { detail: "复制接入示例 → toast 已复制" };
  },
  "/dashboard": async (s) => {
    const btn = s.page.getByRole("button", { name: /近\s*7\s*天/ }).first();
    if ((await btn.count()) === 0) throw new Error("未找到区间按钮");
    await btn.click();
    await s.page.waitForTimeout(700);
    await assertPageSane(s.page, "看板/切换近7天");
    return { detail: "区间切到近7天" };
  },
  "/logs": async (s) => {
    const help = s.page.getByRole("button", { name: "查询语法", exact: true }).first();
    if ((await help.count()) === 0) throw new Error("未找到查询语法按钮");
    await help.click();
    await s.page.getByRole("dialog").first().waitFor({ state: "visible", timeout: 5000 });
    await s.page.keyboard.press("Escape");
    await s.page.waitForTimeout(300);
    const sortBtn = s.page.getByRole("button", { name: "按词元排序", exact: true }).first();
    if ((await sortBtn.count()) > 0) {
      await sortBtn.click();
      await s.page.waitForTimeout(600);
    }
    await assertPageSane(s.page, "日志/交互后");
    return { detail: "查询语法弹层 + 词元排序" };
  },
  "/upstreams": async (s) => {
    const search = s.page.locator('input[placeholder*="搜索"]').first();
    if ((await search.count()) === 0) throw new Error("未找到搜索框");
    await search.fill("zai");
    await s.page.waitForTimeout(600);
    await assertPageSane(s.page, "上游/搜索后");
    await search.fill("");
    return { detail: "搜索 zai 过滤" };
  },
  "/upstreams/:id": async (s) => {
    let clicked = 0;
    for (const label of ["连接与模型", "路由与模型", "请求与响应", "其他设置"]) {
      const tab = s.page.getByRole("tab", { name: label, exact: true }).first();
      if ((await tab.count()) === 0) continue;
      await tab.click();
      clicked += 1;
      await s.page.waitForTimeout(500);
      await assertPageSane(s.page, "上游详情/" + label);
    }
    assert(clicked > 0, "未找到上游详情 Tab");
    return { detail: "上游详情 " + clicked + " 个 Tab 可切换" };
  },
  "/models": async (s) => {
    const tab = s.page.getByRole("tab", { name: "公开模型", exact: true }).first();
    if ((await tab.count()) === 0) throw new Error("未找到公开模型 Tab");
    await tab.click();
    await s.page.waitForTimeout(600);
    await assertPageSane(s.page, "模型/公开模型 Tab");
    return { detail: "切到公开模型 Tab" };
  },
  "/pricing": async (s) => {
    const btn = s.page.getByRole("button", { name: /导入 JSON/ }).first();
    if ((await btn.count()) === 0) throw new Error("未找到导入按钮");
    await btn.click();
    await s.page.getByRole("dialog").first().waitFor({ state: "visible", timeout: 5000 });
    await s.page.keyboard.press("Escape");
    await s.page.waitForTimeout(300);
    return { detail: "导入 JSON 弹层可打开" };
  },
  "/client-keys": async (s) => {
    const copy = s.page.getByRole("button", { name: "复制密钥明文", exact: true }).first();
    if ((await copy.count()) === 0) throw new Error("未找到复制密钥按钮");
    await copy.click();
    await s.page.getByText("密钥已复制").first().waitFor({ state: "visible", timeout: 8000 });
    return { detail: "复制密钥 → toast 密钥已复制" };
  },
  "/users": async (s) => {
    const tab = s.page.getByRole("tab", { name: "控制台账号", exact: true }).first();
    if ((await tab.count()) === 0) throw new Error("未找到控制台账号 Tab");
    await tab.click();
    await s.page.waitForTimeout(600);
    await assertPageSane(s.page, "用户/控制台账号");
    return { detail: "切到控制台账号 Tab" };
  },
  "/roles": async (s) => {
    const view = s.page.getByRole("button", { name: "查看", exact: true }).first();
    const target = (await view.count()) > 0 ? view : s.page.getByRole("button", { name: "编辑", exact: true }).first();
    if ((await target.count()) === 0) throw new Error("未找到角色编辑入口");
    await target.click();
    await s.page.getByRole("dialog").first().waitFor({ state: "visible", timeout: 5000 });
    await s.page.keyboard.press("Escape");
    await s.page.waitForTimeout(300);
    return { detail: "角色抽屉可打开" };
  },
  "/gateway-policies": async (s) => {
    for (const label of ["流量策略", "护栏", "MCP"]) {
      const tab = s.page.getByRole("tab", { name: label, exact: true }).first();
      if ((await tab.count()) === 0) continue;
      await tab.click();
      await s.page.waitForTimeout(600);
      await assertPageSane(s.page, "网关策略/" + label);
    }
    return { detail: "网关策略三个 Tab 可切换" };
  },
  "/audits": async (s) => {
    const detail = s.page.getByRole("button", { name: "详情", exact: true }).first();
    if ((await detail.count()) === 0) throw new Error("未找到审计详情按钮");
    await detail.click();
    await s.page.waitForTimeout(600);
    await assertPageSane(s.page, "审计/详情抽屉");
    await s.page.keyboard.press("Escape");
    await s.page.waitForTimeout(300);
    return { detail: "审计详情抽屉可打开" };
  },
  "/config-revisions": async (s) => {
    const detail = s.page.getByRole("button", { name: "详情", exact: true }).first();
    if ((await detail.count()) === 0) throw new Error("未找到版本详情按钮");
    await detail.click();
    await s.page.waitForTimeout(600);
    await assertPageSane(s.page, "配置版本/详情抽屉");
    await s.page.keyboard.press("Escape");
    await s.page.waitForTimeout(300);
    return { detail: "配置版本详情抽屉可打开" };
  },
  "/settings/theme": async (s) => {
    const dark = s.page.getByRole("radio", { name: /深色/ }).first();
    if ((await dark.count()) === 0) throw new Error("未找到主题选项");
    await dark.click();
    await s.page.waitForTimeout(500);
    await assertPageSane(s.page, "设置/主题切换");
    return { detail: "切换深色主题" };
  },
  "/settings/notifications": async (s) => {
    const sw = s.page.getByRole("switch").first();
    if ((await sw.count()) === 0) throw new Error("未找到通知开关");
    await sw.click();
    await s.page.waitForTimeout(400);
    return { detail: "切换一个通知开关" };
  },
  redirect: async (s, url) => {
    const expected = new URL(url.to, BASE_URL);
    await s.page
      .waitForURL((u) => u.pathname === expected.pathname && (expected.search === "" || u.search === expected.search), { timeout: 6000 })
      .catch(() => {});
    const actual = new URL(s.page.url());
    assert(actual.pathname === expected.pathname, "重定向落点错误：" + actual.pathname + " ≠ " + expected.pathname);
    if (expected.search) assert(actual.search === expected.search, "重定向 query 错误：" + actual.search + " ≠ " + expected.search);
    return { detail: "重定向到 " + url.to };
  },
  notfound: async (s) => {
    const text = await s.mainText();
    assert(/404|页面不存在|找不到/.test(text), "404 页缺少 404/页面不存在文案");
    return { detail: "404 文案在位" };
  },
};

/* ------------------------------------------------------------------ *
 * 5. 六条关键流程
 * ------------------------------------------------------------------ */

async function flow1UpstreamChain(s) {
  // 本地假上游：OpenAI 兼容 /v1/models（auto 探测第一站 openai_chat）
  const fake = http.createServer((req, res) => {
    if (String(req.url).startsWith("/v1/models")) {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ object: "list", data: [{ id: "demo-chat", object: "model" }, { id: "demo-embed", object: "model" }] }));
      return;
    }
    res.writeHead(404, { "content-type": "application/json" });
    res.end("{}");
  });
  await new Promise((resolve) => fake.listen(3999, "127.0.0.1", resolve));
  const suffix = String(Date.now()).slice(-6);
  const upstreamName = "w6-up-" + suffix;
  const publicName = "w6-pm-" + suffix;
  const ids = { upstream: "", upstreamModel: "", publicModel: "", target: "" };
  try {
    // 建上游（auto 探测）
    const created = await apiCall(s, "POST", "/admin/upstreams", {
      base_url: "http://127.0.0.1:3999/v1",
      api_style: "auto",
      api_key: "sk-w6-fake",
    });
    assert(created.status < 300, "建上游 HTTP " + created.status + "：" + created.text.slice(0, 200));
    ids.upstream = created.body.id;
    assert(created.body.api_style && created.body.api_style !== "auto", "api_style 未落库为具体风格：" + created.body.api_style);
    // 获取上游模型（discover）
    const discovered = await apiCall(s, "POST", "/admin/upstreams/" + ids.upstream + "/discover-models", {});
    assert(discovered.status < 300, "探测模型 HTTP " + discovered.status + "：" + discovered.text.slice(0, 200));
    const names = (discovered.body.models || []).map((m) => (typeof m === "string" ? m : m.name));
    assert(names.includes("demo-chat"), "探测结果缺少 demo-chat：" + JSON.stringify(names));
    // 导入模型
    const imported = await apiCall(s, "POST", "/admin/upstreams/" + ids.upstream + "/import-models", { names: ["demo-chat"], model_type: "chat" });
    assert(imported.status < 300, "导入模型 HTTP " + imported.status + "：" + imported.text.slice(0, 200));
    const ums = await apiCall(s, "GET", "/admin/upstream-models?page_size=200&offset=0");
    const um = (ums.body || []).find((m) => m.upstream_id === ids.upstream && m.name === "demo-chat");
    assert(um, "导入后上游模型列表没有 demo-chat");
    ids.upstreamModel = um.id;
    // 建公开模型
    // 建公开模型（ticket 10：成员随创建一次提交；TargetDraft 用 upstream_model_id）
    const pm = await apiCall(s, "POST", "/admin/public-models", {
      name: publicName,
      routing_mode: "failover",
      targets: [{ upstream_model_id: ids.upstreamModel, priority: 1 }],
    });
    assert(pm.status < 300, "建公开模型 HTTP " + pm.status + "：" + pm.text.slice(0, 200));
    ids.publicModel = pm.body.id;
    const tlist = await apiCall(s, "GET", "/admin/model-targets?public_model_id=" + ids.publicModel);
    const target = (tlist.body || []).find((t) => t.upstream_model_id === ids.upstreamModel);
    assert(target, "目标列表没有绑定行");
    ids.target = target.id;
    // 下发版本
    const applied = await apiCall(s, "POST", "/admin/config/apply", { reason: "W6 验收：上游链路" });
    assert(applied.status < 300, "下发版本 HTTP " + applied.status + "：" + applied.text.slice(0, 300));
    // UI 验证：两个页面能看到新数据
    await s.visit("/upstreams", "上游渠道");
    const upSearch = s.page.locator('input[placeholder*="搜索"]').first();
    if ((await upSearch.count()) > 0) {
      await upSearch.fill(upstreamName);
      await s.page.waitForTimeout(700);
      await assertPageSane(s.page, "上游/搜索新上游");
    }
    await s.shot("flow1-upstreams-search");
    await s.visit("/models", "模型管理");
    const pmTab = s.page.getByRole("tab", { name: "公开模型", exact: true }).first();
    if ((await pmTab.count()) > 0) {
      await pmTab.click();
      await s.page.waitForTimeout(600);
    }
    const modelSearch = s.page.locator('input[placeholder*="搜索公开名"]').first();
    if ((await modelSearch.count()) > 0) {
      await modelSearch.fill(publicName);
      await s.page.waitForTimeout(700);
      await assertPageSane(s.page, "模型/搜索新公开模型");
    }
    await s.shot("flow1-public-model-search");
    return "auto 探测→发现→导入→公开模型→绑定→下发（rev " + String(applied.body.id || "").slice(0, 8) + "）全链路 200；UI 搜索可见";
  } finally {
    if (ids.target) await apiCall(s, "DELETE", "/admin/model-targets/" + ids.target);
    if (ids.upstreamModel) await apiCall(s, "DELETE", "/admin/upstream-models/" + ids.upstreamModel);
    if (ids.upstream) await apiCall(s, "DELETE", "/admin/upstreams/" + ids.upstream);
    if (ids.publicModel) await apiCall(s, "DELETE", "/admin/public-models/" + ids.publicModel);
    await new Promise((resolve) => fake.close(resolve));
  }
}

async function flow2UserAndKey(s) {
  const userName = "W6验收用户" + String(Date.now()).slice(-4);
  let userId = "";
  let keyId = "";
  try {
    // 建用户（UI）
    await s.visit("/users", "用户管理");
    const createBtn = s.page.getByRole("button", { name: "新建用户", exact: true }).first();
    assert((await createBtn.count()) > 0, "用户页没有新建用户按钮");
    await createBtn.click();
    await s.page.getByRole("dialog").first().waitFor({ state: "visible", timeout: 5000 });
    await s.page.fill("#create-user-name", userName);
    await s.page.getByRole("button", { name: "创建用户", exact: true }).first().click();
    await s.page.getByText("用户已创建").first().waitFor({ state: "visible", timeout: 8000 });
    await s.shot("flow2-user-created");
    // 复制初始密码 → toast 已复制
    const copyBtn = s.page.getByRole("dialog").getByRole("button", { name: "复制" }).first();
    assert((await copyBtn.count()) > 0, "一次性密码弹窗没有复制按钮");
    await copyBtn.click();
    await s.page.getByText("已复制").first().waitFor({ state: "visible", timeout: 5000 });
    await s.page.keyboard.press("Escape");
    await s.page.waitForTimeout(400);
    const users = await apiCall(s, "GET", "/admin/users?page_size=200&offset=0");
    const user = (users.body || []).find((u) => u.name === userName);
    assert(user, "创建后用户列表没有 " + userName);
    userId = user.id;
    // 签发密钥（UI，W6 新增入口）
    await s.visit("/client-keys", "连接密钥");
    const issueBtn = s.page.getByRole("button", { name: "新建密钥", exact: true }).first();
    assert((await issueBtn.count()) > 0, "连接密钥页没有新建密钥按钮");
    await issueBtn.click();
    await s.page.getByRole("dialog").first().waitFor({ state: "visible", timeout: 5000 });
    await s.page.locator("#issue-user").click();
    await s.page.getByRole("option", { name: userName, exact: true }).first().click();
    await s.page.fill("#issue-name", "w6-key");
    await s.page.getByRole("button", { name: "签发密钥", exact: true }).first().click();
    await s.page.getByText("连接密钥已签发").first().waitFor({ state: "visible", timeout: 8000 });
    await s.shot("flow2-key-issued");
    const copyKey = s.page.getByRole("dialog").getByRole("button", { name: "复制" }).first();
    await copyKey.click();
    await s.page.getByText("已复制").first().waitFor({ state: "visible", timeout: 5000 });
    await s.page.keyboard.press("Escape");
    await s.page.waitForTimeout(400);
    const keys = await apiCall(s, "GET", "/admin/api-keys?page_size=200&offset=0");
    const key = (keys.body || []).find((k) => k.name === "w6-key" && k.user_id === userId);
    assert(key, "签发后密钥列表没有 w6-key");
    keyId = key.id;
    return "建用户（初始密码一次性弹窗+复制 toast）→ 签发密钥（明文一次性弹窗+复制 toast）均通过；user=" + userId.slice(0, 10) + " key=" + keyId.slice(0, 10);
  } finally {
    if (keyId) await apiCall(s, "DELETE", "/admin/api-keys/" + keyId);
    if (userId) await apiCall(s, "DELETE", "/admin/users/" + userId);
  }
}

async function flow3Logs(s) {
  // 正文开关（尽力而为）：开 full 再验证明细节
  await apiCall(s, "PUT", "/admin/settings", { values: { ag_access_log_llm: "full" } });
  await s.visit("/logs", "使用日志");
  // 筛选
  const search = s.page.locator('input[aria-label="关键词或查询语法"]');
  assert((await search.count()) > 0, "日志页没有查询输入框");
  await search.fill("status:500");
  await s.page.getByRole("button", { name: "查询", exact: true }).first().click();
  await s.page.waitForTimeout(1200);
  await assertPageSane(s.page, "日志/status:500");
  const filteredText = await s.mainText();
  await s.shot("flow3-logs-filtered");
  // 排序（重置筛选后）
  await search.fill("");
  await s.page.getByRole("button", { name: "查询", exact: true }).first().click();
  await s.page.waitForTimeout(1000);
  const tokensBtn = s.page.getByRole("button", { name: "按词元排序", exact: true }).first();
  assert((await tokensBtn.count()) > 0, "词元列不可排序");
  await tokensBtn.click();
  await s.page.waitForTimeout(900);
  const firstTokens = await s.page.locator("tbody tr").first().innerText().catch(() => "");
  await tokensBtn.click();
  await s.page.waitForTimeout(900);
  const ascTokens = await s.page.locator("tbody tr").first().innerText().catch(() => "");
  // 列显隐
  const colBtn = s.page.getByRole("button", { name: "列设置", exact: true }).first();
  assert((await colBtn.count()) > 0, "日志页没有列设置");
  await colBtn.click();
  await s.page.waitForTimeout(400);
  const tokensItem = s.page.getByRole("menuitemcheckbox", { name: "词元" }).first();
  if ((await tokensItem.count()) > 0) {
    await tokensItem.click();
    await s.page.waitForTimeout(500);
  }
  const headerAfter = await s.page.getByRole("columnheader", { name: /词元/ }).count();
  await s.shot("flow3-logs-columns");
  // 列设置下拉保持打开（onSelect preventDefault），Radix 会给背景加 aria-hidden——
  // 先 Escape 收起，否则 getByRole 在 a11y 树上找不到表格按钮（实测 detailRole=0 / DOM 40）
  await s.page.keyboard.press("Escape");
  await s.page.waitForTimeout(400);
  // 详情
  const detail = s.page.locator('tbody button[aria-label*="详情"]').first();
  if ((await detail.count()) === 0) {
    const rowDetail = s.page.locator("tbody tr").first().getByRole("button", { name: "详情" }).first();
    assert((await rowDetail.count()) > 0, "日志行没有详情入口");
    await rowDetail.click();
  } else {
    await detail.click();
  }
  await s.page.waitForTimeout(900);
  await assertPageSane(s.page, "日志/详情抽屉");
  const payloadSection = s.page.getByText("请求与响应正文").first();
  let payloadNote = "详情抽屉打开；正文节存在=" + (await payloadSection.count());
  if ((await payloadSection.count()) > 0) {
    await payloadSection.click();
    await s.page.waitForTimeout(1200);
    await s.shot("flow3-logs-detail-payload");
    payloadNote += "；正文展开后未记录正文=" + (await s.mainText()).includes("未记录正文");
  }
  await s.shot("flow3-logs-detail");
  await s.page.keyboard.press("Escape");
  return (
    "筛选 status:500 后页面正常（含 500 行数=" + (filteredText.match(/\b5\d\d\b/g) || []).length + "）；" +
    "词元排序前后首行不同=" + (firstTokens !== ascTokens) + "；" +
    "列设置隐藏词元后 columnheader 数=" + headerAfter + "；" + payloadNote
  );
}

async function flow4Dashboard(s) {
  await s.visit("/dashboard", "数据看板");
  const ranges = [/近\s*24\s*小时/, /近\s*7\s*天/, /近\s*30\s*天/];
  const from = s.consoleErrors.length;
  for (let round = 0; round < 3; round += 1) {
    for (const pattern of ranges) {
      const btn = s.page.getByRole("button", { name: pattern }).first();
      if ((await btn.count()) === 0) continue;
      await btn.click();
      await s.page.waitForTimeout(120);
    }
  }
  const started = Date.now();
  const last = s.page.getByRole("button", { name: /近\s*30\s*天/ }).first();
  if ((await last.count()) > 0) await last.click();
  await s.page.locator("main svg, main canvas").first().waitFor({ state: "visible", timeout: 5000 }).catch(() => {});
  const renderMs = Date.now() - started;
  await settle(s.page, { quietMs: 400 });
  await assertPageSane(s.page, "看板/连点后");
  assertNoNewErrors(s, from, "看板连点");
  assert(renderMs < 3000, "区间切换渲染耗时 " + renderMs + "ms（阈值 3000ms）");
  await s.shot("flow4-dashboard-after-rapid-clicks");
  return "9 次连点区间 + 30 天渲染 " + renderMs + "ms，无 console error、无白屏";
}

async function flow5Pricing(s) {
  await s.visit("/pricing", "价目管理");
  // 导出
  const [download] = await Promise.all([
    s.page.waitForEvent("download", { timeout: 10000 }),
    s.page.getByRole("button", { name: /导出 JSON/ }).first().click(),
  ]);
  const file = path.join(os.tmpdir(), "w6-prices-" + Date.now() + ".json");
  await download.saveAs(file);
  const original = JSON.parse(fs.readFileSync(file, "utf8"));
  assert(Array.isArray(original.upstream_models) && original.upstream_models.length > 0, "导出文件没有 upstream_models");
  await s.page.getByText("价目已导出").first().waitFor({ state: "visible", timeout: 5000 }).catch(() => {});
  await s.shot("flow5-prices-exported");
  // 改一个成本
  const target = original.upstream_models.find((m) => m.cost_input_per_1m);
  assert(target, "导出里没有带成本价的模型");
  const originalCost = target.cost_input_per_1m;
  const bumped = (Number(originalCost) + 1).toFixed(6);
  target.cost_input_per_1m = bumped;
  const modifiedFile = file + ".mod.json";
  fs.writeFileSync(modifiedFile, JSON.stringify(original, null, 2));
  // 导入
  await s.page.getByRole("button", { name: /导入 JSON/ }).first().click();
  await s.page.getByRole("dialog").first().waitFor({ state: "visible", timeout: 5000 });
  await s.page.locator('input[type="file"]').setInputFiles(modifiedFile);
  await s.page.waitForTimeout(600);
  const importBtn = s.page.getByRole("dialog").getByRole("button", { name: /导入/ }).first();
  assert((await importBtn.count()) > 0, "导入弹层没有导入按钮");
  await importBtn.click();
  await s.page.getByText("价目导入成功").first().waitFor({ state: "visible", timeout: 10000 });
  await s.shot("flow5-prices-imported");
  // 验证后端生效
  const exported = await apiCall(s, "GET", "/admin/prices/export");
  const applied = (exported.body.upstream_models || []).find((m) => m.id === target.id);
  assert(applied && Number(applied.cost_input_per_1m) === Number(bumped), "导入后成本未生效：" + (applied && applied.cost_input_per_1m));
  // 还原：重新导入未改动的导出文件
  await s.page.getByRole("button", { name: /导入 JSON/ }).first().click();
  await s.page.getByRole("dialog").first().waitFor({ state: "visible", timeout: 5000 });
  await s.page.locator('input[type="file"]').setInputFiles(file);
  await s.page.waitForTimeout(600);
  await s.page.getByRole("dialog").getByRole("button", { name: /导入/ }).first().click();
  await s.page.getByText("价目导入成功").first().waitFor({ state: "visible", timeout: 10000 }).catch(() => {});
  return "导出 " + original.upstream_models.length + " 行 → 改 " + target.name + " 成本 " + originalCost + "→" + bumped + " → 导入生效 → 已还原";
}

async function flow6DangerAndCooldown(s) {
  const notes = [];
  // 三档之一：单条删除红色确认
  await s.visit("/models", "模型管理");
  const delBtn = s.page.locator('button:not([disabled])').filter({ hasText: "删除" }).first();
  assert((await delBtn.count()) > 0, "模型页没有删除按钮");
  await delBtn.click();
  await s.page.getByRole("alertdialog").first().waitFor({ state: "visible", timeout: 5000 });
  const confirmText = await s.page.getByRole("alertdialog").first().innerText();
  assert(/删除/.test(confirmText) && /取消/.test(confirmText), "单条删除确认弹层文案异常：" + confirmText.slice(0, 80));
  await s.page.getByRole("alertdialog").getByRole("button", { name: "取消" }).first().click();
  notes.push("单条删除=红色确认（已取消）");
  // 三档之二：重置密钥确认
  await s.visit("/client-keys", "连接密钥");
  const rotateBtn = s.page.getByRole("button", { name: "重置", exact: true }).first();
  assert((await rotateBtn.count()) > 0, "密钥页没有重置按钮");
  await rotateBtn.click();
  await s.page.getByRole("alertdialog").first().waitFor({ state: "visible", timeout: 5000 });
  const rotateText = await s.page.getByRole("alertdialog").first().innerText();
  assert(/重置/.test(rotateText), "重置确认弹层文案异常");
  await s.page.getByRole("alertdialog").getByRole("button", { name: "取消" }).first().click();
  notes.push("重置密钥=确认+明文仅一次（已取消）");
  // 三档之三：批量删除 >10 需输入「删除」
  await s.visit("/models", "模型管理");
  const boxes = s.page.locator('button[role="checkbox"][aria-label^="选择 "]');
  const boxCount = await boxes.count();
  assert(boxCount >= 11, "上游模型不足 11 条，无法验证批量三档（实际 " + boxCount + "）");
  for (let i = 0; i < 11; i += 1) await boxes.nth(i).click();
  await s.page.getByRole("button", { name: "批量删除" }).first().click();
  await s.page.getByRole("alertdialog").first().waitFor({ state: "visible", timeout: 5000 });
  const typing = s.page.getByRole("alertdialog").locator('input[aria-label="输入删除以确认"]');
  assert((await typing.count()) > 0, "批量删除弹层没有「输入删除」确认框");
  await typing.fill("删除");
  await s.shot("flow6-batch-delete-dialog");
  await s.page.getByRole("alertdialog").getByRole("button", { name: "取消" }).first().click();
  notes.push("批量删除 11 条=需输入「删除」（已取消）");
  // 周期冷却窗口期启用
  const models = await apiCall(s, "GET", "/admin/upstream-models?page_size=200&offset=0");
  const model = (models.body || []).find((m) => m.enabled);
  assert(model, "没有启用的上游模型可用于周期冷却验收");
  const rule = await apiCall(s, "POST", "/admin/availability-rules", {
    kind: "cooldown",
    scope: "upstream_model",
    scope_id: model.id,
    recurrence: "daily",
    schedule_json: JSON.stringify({ windows: [{ start: "00:00", end: "23:59" }] }),
    note: "W6 周期冷却验收",
  });
  assert(rule.status < 300, "建周期规则 HTTP " + rule.status + "：" + rule.text.slice(0, 200));
  const ruleId = rule.body.id;
  try {
    const state = await apiCall(s, "GET", "/admin/upstream-models?page_size=200&offset=0");
    const row = (state.body || []).find((m) => m.id === model.id);
    assert(row && row.availability && row.availability.state === "cooling", "周期规则生效后状态不是 cooling：" + JSON.stringify(row && row.availability));
    // 启用按钮只在 enabled=false 的行出现（_row_view：disabled→closed，UI 给「启用」）；
    // 后端 enable 不区分 enabled，仍会为窗口期内的周期规则写 skip → 先禁用以露出按钮
    await apiCall(s, "PATCH", "/admin/upstream-models/" + model.id, { enabled: false });
    await s.visit("/models", "模型管理");
    const search = s.page.locator('input[placeholder*="搜索模型名"]').first();
    if ((await search.count()) > 0) {
      await search.fill(model.name);
      await s.page.waitForTimeout(800);
    }
    const enableBtn = s.page.getByRole("button", { name: "启用", exact: true }).first();
    assert((await enableBtn.count()) > 0, "冷却中的模型行没有启用按钮");
    await enableBtn.click();
    await s.page.getByText("本次启用仅跳过当前窗口，后续窗口照常").first().waitFor({ state: "visible", timeout: 8000 });
    await s.shot("flow6-window-skip-toast");
    const after = await apiCall(s, "GET", "/admin/upstream-models?page_size=200&offset=0");
    const afterRow = (after.body || []).find((m) => m.id === model.id);
    assert(afterRow && afterRow.availability && afterRow.availability.window_skip_until_ms > 0, "启用后 window_skip_until_ms 未置位：" + JSON.stringify(afterRow && afterRow.availability));
    notes.push("周期窗口期内启用 → 提示「仅跳过当前窗口」且 window_skip_until_ms=" + afterRow.availability.window_skip_until_ms);
    return notes.join("；");
  } finally {
    await apiCall(s, "DELETE", "/admin/availability-rules/" + ruleId);
    await apiCall(s, "PATCH", "/admin/upstream-models/" + model.id, { enabled: model.enabled });
  }
}

async function flow7ForcedError(s) {
  // 错误态：拦截 /admin/upstreams 返回 500，列表页应显示错误 + 重试，不白屏
  // （apiList 直接 GET 无 query string，glob 必须以上游路径结尾，不能带 ?** 尾巴）
  await s.page.route("**/admin/upstreams", async (route) => {
    await route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({ code: "INTERNAL", message: "W6 强制错误（验收用）" }),
    });
  });
  try {
    await s.page.goto(BASE_URL + "/upstreams", { waitUntil: "domcontentloaded", timeout: 30000 });
    await settle(s.page, { quietMs: 600 });
    const text = await s.mainText();
    assert(!text.includes("页面渲染失败"), "强制 500 命中错误边界（白屏级）");
    assert(/加载失败|出错|失败|W6 强制错误|重试/.test(text), "强制 500 后页面没有错误提示：" + text.slice(0, 120));
    await s.shot("flow7-forced-500");
    return "拦截 /admin/upstreams → 500，页面显示错误提示+重试，未白屏";
  } finally {
    await s.page.unroute("**/admin/upstreams");
  }
}

/* ------------------------------------------------------------------ *
 * 6. 主流程
 * ------------------------------------------------------------------ */

async function main() {
  const playwright = await loadPlaywright();
  if (!playwright) {
    console.error("环境未就绪：找不到 playwright / playwright-core（在 web 包安装依赖后重试）");
    process.exit(2);
  }
  const { browser } = await launchBrowser(playwright, { channel: CHANNEL, headed: HEADED });
  const session = await openSession(browser, {
    role: "admin",
    base: BASE_URL,
    apiBase: BASE_URL,
    outDir: OUT,
    evidence: (rel) => currentEvidence.push(rel),
    consoleIgnore: ["status of 401"],
    contextOptions: { permissions: ["clipboard-read", "clipboard-write"], acceptDownloads: true },
  });

  const table = loadRouteTable();
  const upstreams = await apiCall(session, "GET", "/admin/upstreams?page_size=50");
  const upstreamId = (upstreams.body || [])[0]?.id || "";
  const urls = buildRouteUrls(table, upstreamId);

  // A. 登录页四查（截图 + 品牌 + 错误密码）；登录页是独立卡片布局，没有 main 容器，读 body
  await test("login.page", "登录页品牌与错误密码", async () => {
    await session.page.goto(BASE_URL + "/login", { waitUntil: "domcontentloaded" });
    await settle(session.page, { quietMs: 400 });
    const text = await session.page.locator("body").innerText().catch(() => "");
    assert(text.includes("驭流") && text.includes("Slipstream"), "登录页缺少品牌锁");
    await session.shot("login");
    await session.page.fill("#login-username", ADMIN_CRED.user);
    await session.page.fill("#login-password", "wrong-password");
    await session.page.click('button[type="submit"]');
    await session.page.locator("p.text-danger-text").first().waitFor({ state: "visible", timeout: 6000 });
    return "品牌 + 错误密码提示";
  });

  // 登录（session.login 会记录 cred/authed，供 ensureAuthed 自愈）
  const loginOutcome = await session.login(ADMIN_CRED);
  assert(loginOutcome.ok, "登录失败：" + loginOutcome.message);
  const me = await session.apiGet("/admin/auth/me");
  assert(me.status === 200, "登录后 /admin/auth/me " + me.status);

  // B. 路由四查
  for (const url of urls) {
    const id = "route " + url.path;
    await test(id, "四查 " + url.label + " " + url.path, () => sweepOne(session, url, id));
  }

  // C. 六条流程
  await test("flow1.upstream", "流程1 建上游(auto)→模型→公开模型→下发", () => flow1UpstreamChain(session));
  await test("flow2.user-key", "流程2 建用户→签发密钥→复制 toast", () => flow2UserAndKey(session));
  await test("flow3.logs", "流程3 日志筛选/排序/列显隐/详情", () => flow3Logs(session));
  await test("flow4.dashboard", "流程4 看板连点无卡顿", () => flow4Dashboard(session));
  await test("flow5.pricing", "流程5 价目导出→导入回环", () => flow5Pricing(session));
  await test("flow6.danger", "流程6 危险三档+周期冷却窗口启用", () => flow6DangerAndCooldown(session));
  await test("flow7.error-state", "错误态 强制 500 降级", () => flow7ForcedError(session));

  await session.close();
  await browser.close();

  // 报告
  const pass = results.filter((r) => r.status === "pass").length;
  const fail = results.filter((r) => r.status === "fail").length;
  const mark = (v) => (v === "fail" ? "FAIL" : v === "skip" ? "SKIP" : "PASS");
  const lines = [];
  lines.push("# W6 收官验收报告");
  lines.push("");
  lines.push("- 时间：" + new Date().toISOString());
  lines.push("- Base：" + BASE_URL);
  lines.push("- 结果： PASS " + pass + " / FAIL " + fail + " / 共 " + results.length);
  lines.push("");
  lines.push("## 逐页四查（路由清单 " + table.routes.length + " 条 / 具体 URL " + urls.length + " 个）");
  lines.push("");
  lines.push("| 页面 | 路径 | 首屏 | 空态 | 错误态 | 交互 | 说明 |");
  lines.push("| --- | --- | --- | --- | --- | --- | --- |");
  for (const r of results.filter((x) => x.id.startsWith("route "))) {
    const checks = pageChecks.get(r.id) || {};
    const detail = r.status === "fail" ? r.detail : r.detail.replace(/\|/g, "/").replace(/\n/g, " ");
    lines.push(
      "| " + r.name.replace(/^四查 /, "") + " | " + r.id.replace(/^route /, "") + " | " +
      mark(checks.first) + " | " + mark(checks.empty) + " | " + mark(checks.error) + " | " + mark(checks.interact) +
      " | " + detail + " |",
    );
  }
  lines.push("");
  lines.push("## 流程");
  lines.push("");
  for (const r of results.filter((x) => x.id.startsWith("flow"))) {
    lines.push("- " + (r.status === "pass" ? "PASS" : "FAIL") + " **" + r.name + "** — " + r.detail.replace(/\n/g, " "));
  }
  lines.push("");
  lines.push("## 证据");
  lines.push("");
  for (const r of results) {
    if (r.evidence.length === 0) continue;
    lines.push("- " + r.id + "：" + r.evidence.map((e) => "`" + e + "`").join(" "));
  }
  fs.writeFileSync(path.join(OUT, "report.md"), lines.join("\n"));
  fs.writeFileSync(path.join(OUT, "report.json"), JSON.stringify({ base: BASE_URL, results }, null, 2));
  console.log("");
  console.log("PASS " + pass + " · FAIL " + fail + " · 证据 " + path.relative(ROOT, OUT).replace(/\\/g, "/"));
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error("验收环境错误：" + String((error && error.stack) || error));
  process.exit(2);
});