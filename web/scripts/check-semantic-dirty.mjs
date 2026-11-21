#!/usr/bin/env node
/**
 * 09 ticket 门禁：语义色 token、字段级脏标记原语与 toast 统一策略。
 *
 * 本仓前端没有测试运行器（package.json 无 vitest/jest），沿用 check-ui-foundation 的做法：
 * 用 Vite 的 SSR 加载器把真实 TS/TSX 编译进内存，断言设计 token、纯函数行为与组件 SSR
 * 出的 DOM/class；再对外层页面做源码接线契约（哪些表单用了原语、哪些操作行用了语义按钮）。
 *
 * 用法：node scripts/check-semantic-dirty.mjs
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { createServer } from "vite";

const webRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(webRoot, p), "utf8");

const checks = [];
const check = (name, fn) => checks.push({ name, fn });
const expect = (condition, message) => {
  if (!condition) throw new Error(message);
};
const includesAll = (haystack, needles, label) => {
  const missing = needles.filter((needle) => !haystack.includes(needle));
  expect(missing.length === 0, label + " 缺少：" + missing.join("、"));
};

// ---------- 1. 语义 token（index.css） ----------
check("index.css：信息蓝与中性灰补齐 text/soft 三件套并映射到 @theme", () => {
  const css = read("src/index.css");
  includesAll(
    css,
    [
      "--info: #2563eb;",
      "--info-text: #1d4ed8;",
      "--info-soft: #eff6ff;",
      "--neutral: #6b7280;",
      "--neutral-text: #4b5563;",
      "--neutral-soft: #f3f4f6;",
      "--info: #60a5fa;",
      "--info-text: #93c5fd;",
      "--info-soft: rgba(96, 165, 250, 0.14);",
      "--neutral: #9ca3af;",
      "--neutral-text: #d1d5db;",
      "--neutral-soft: rgba(156, 163, 175, 0.14);",
      "--color-info: var(--info);",
      "--color-info-text: var(--info-text);",
      "--color-info-soft: var(--info-soft);",
      "--color-neutral: var(--neutral);",
      "--color-neutral-text: var(--neutral-text);",
      "--color-neutral-soft: var(--neutral-soft);",
    ],
    "语义 token",
  );
  expect(!css.includes("--info: #5b6573"), "旧的灰色 --info 必须收敛为信息蓝");
});

// ---------- 2. 纯函数/模块契约 ----------
let server;
const load = async (id) => server.ssrLoadModule(id);
const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
const render = (element) =>
  renderToStaticMarkup(
    createElement(QueryClientProvider, { client: queryClient }, createElement(MemoryRouter, null, element)),
  );

check("semantic-tone：五档 tone 与文字/底色/描边工具类映射", async () => {
  const { SEMANTIC_TONES, TONE_TEXT, TONE_SOFT_BG, TONE_BORDER, toneText } = await load("/src/lib/semantic-tone.ts");
  expect(
    JSON.stringify([...SEMANTIC_TONES]) === JSON.stringify(["success", "warning", "info", "danger", "neutral"]),
    "SEMANTIC_TONES 必须是 success/warning/info/danger/neutral 五档",
  );
  includesAll(TONE_TEXT, [], "");
  expect(TONE_TEXT.success === "text-success-text", "success 文字色");
  expect(TONE_TEXT.warning === "text-warning-text", "warning 文字色");
  expect(TONE_TEXT.info === "text-info-text", "info 文字色必须是信息蓝 token");
  expect(TONE_TEXT.danger === "text-danger-text", "danger 文字色");
  expect(TONE_TEXT.neutral === "text-neutral-text", "neutral 文字色");
  expect(TONE_SOFT_BG.success === "bg-success-soft", "success 浅底");
  expect(TONE_SOFT_BG.warning === "bg-warning-soft", "warning 浅底");
  expect(TONE_SOFT_BG.info === "bg-info-soft", "info 浅底");
  expect(TONE_SOFT_BG.danger === "bg-danger-soft", "danger 浅底");
  expect(TONE_SOFT_BG.neutral === "bg-neutral-soft", "neutral 浅底");
  expect(TONE_BORDER.warning === "border-warning", "warning 描边");
  expect(toneText("info") === "text-info-text", "toneText helper");
});

check("icons.ACTION_TONES：七个语义动词映射 + 全量图标都有 tone", async () => {
  const { ACTION_ICONS, ACTION_TONES } = await load("/src/lib/icons.ts");
  const expected = {
    enable: "success",
    disable: "warning",
    cooldown: "warning",
    releaseCooldown: "success",
    testConnection: "info",
    delete: "danger",
    edit: "neutral",
  };
  for (const [key, tone] of Object.entries(expected)) {
    expect(ACTION_TONES[key] === tone, "ACTION_TONES." + key + " 必须是 " + tone + "，实际 " + ACTION_TONES[key]);
  }
  const tones = new Set(["success", "warning", "info", "danger", "neutral"]);
  for (const key of Object.keys(ACTION_ICONS)) {
    expect(tones.has(ACTION_TONES[key]), "ACTION_TONES 缺少 " + key + " 或 tone 非法");
  }
});

// ---------- 3. 语义组件 SSR 契约 ----------
check("ActionButton：动作=图标 + 语义文字色 + 文案", async () => {
  const { ActionButton } = await load("/src/components/ui/action-button.tsx");
  const cases = {
    enable: "text-success-text",
    disable: "text-warning-text",
    cooldown: "text-warning-text",
    releaseCooldown: "text-success-text",
    testConnection: "text-info-text",
    delete: "text-danger-text",
    edit: "text-neutral-text",
  };
  for (const [action, toneClass] of Object.entries(cases)) {
    const html = render(createElement(ActionButton, { action, onClick: () => {} }, "动作" + action));
    expect(html.includes(toneClass), action + " 必须带 " + toneClass);
    expect(html.includes("<svg"), action + " 必须带图标（不能只靠颜色）");
    expect(html.includes("动作" + action), action + " 必须保留文字标签");
  }
});

check("Badge tone=info：信息蓝底 + 信息蓝字", async () => {
  const { Badge } = await load("/src/components/ui/badge.tsx");
  const html = render(createElement(Badge, { tone: "info" }, "测试"));
  expect(html.includes("bg-info-soft") && html.includes("text-info-text"), "Badge info 必须是信息蓝三件套，实际：" + html);
});

check("Alert variant=info：信息蓝底 + Info 图标", async () => {
  const { Alert } = await load("/src/components/ui/alert.tsx");
  const html = render(createElement(Alert, { variant: "info" }, "提示"));
  expect(html.includes("bg-info-soft") && html.includes("text-info-text"), "Alert info 必须是信息蓝三件套，实际：" + html);
  expect(html.includes("<svg"), "Alert info 必须带图标");
});

// ---------- 4. 脏标记原语 ----------
check("diffFields：默认 Object.is、baseline=null 空集、equals 覆盖", async () => {
  const { diffFields, sameArray, sameSet, sameJson } = await load("/src/lib/dirty-fields.ts");
  const changed = diffFields({ name: "a", count: 1 }, { name: "a", count: 2 });
  expect(changed.size === 1 && changed.has("count"), "只应把变化的字段标脏");
  expect(diffFields({ name: "a" }, { name: "a" }).size === 0, "完全相同时不应有脏字段");
  expect(diffFields(null, { name: "a" }).size === 0, "baseline 为 null（新表单）时不标脏");
  const withSet = diffFields(
    { permissions: new Set(["a"]) },
    { permissions: new Set(["a"]) },
    { equals: { permissions: sameSet } },
  );
  expect(withSet.size === 0, "sameSet 覆盖后内容相同的 Set 不应标脏");
  const setChanged = diffFields(
    { permissions: new Set(["a"]) },
    { permissions: new Set(["a", "b"]) },
    { equals: { permissions: sameSet } },
  );
  expect(setChanged.has("permissions"), "Set 内容变化必须标脏");
  expect(sameArray([1, 2], [1, 2]) === true, "sameArray 内容相同");
  expect(sameArray([1, 2], [2, 1]) === false, "sameArray 顺序不同");
  expect(sameJson({ a: 1 }, { a: 1 }) === true, "sameJson 结构相同");
});

check("useDirtyFields：返回 dirtyFields/dirtyCount/isDirty/isDirtyField", async () => {
  const { useDirtyFields } = await load("/src/lib/use-dirty-fields.ts");
  function Probe(props) {
    const state = useDirtyFields(props.baseline, props.current);
    return createElement(
      "span",
      { "data-dirty": state.isDirty ? "true" : "false" },
      JSON.stringify({
        count: state.dirtyCount,
        fields: [...state.dirtyFields].sort(),
        isDirty: state.isDirty,
        name: state.isDirtyField("name"),
      }),
    );
  }
  const html = render(createElement(Probe, { baseline: { name: "a", title: "x" }, current: { name: "a", title: "y" } }));
  expect(html.includes("&quot;title&quot;"), "dirtyFields 必须含 title，实际：" + html);
  expect(
    html.includes("count&quot;:1") && html.includes("isDirty&quot;:true"),
    "dirtyCount 必须为 1 且 isDirty=true，实际：" + html,
  );
  expect(html.includes("&quot;name&quot;:false"), "未变化的 name 不应标脏，实际：" + html);
});

check("DirtyField：脏时浅底 + 已修改点 + 恢复该项、无左侧警示线（W7 A 方案）；干净时不渲染标记", async () => {
  const { DirtyField } = await load("/src/components/ui/dirty-field.tsx");
  const input = createElement("input", { defaultValue: "v", "aria-label": "字段" });
  const dirtyHtml = render(createElement(DirtyField, { dirty: true, onReset: () => {}, children: input }));
  includesAll(dirtyHtml, ["bg-warning-soft", "已修改", "恢复该项", "dirty-marker"], "脏字段标记");
  expect(dirtyHtml.includes("<svg"), "恢复该项按钮必须带图标");
  expect(!dirtyHtml.includes("dirty-bar"), "W7 ticket 12：脏字段不得再渲染左侧 2px 警示线（dirty-bar）");
  expect(!dirtyHtml.includes("w-0.5"), "不得以任何竖条元素变相恢复左侧警示线");
  const cleanHtml = render(createElement(DirtyField, { dirty: false, onReset: () => {}, children: input }));
  expect(!cleanHtml.includes("已修改"), "干净字段不应出现「已修改」");
  expect(!cleanHtml.includes("bg-warning-soft"), "干净字段不应有警示浅底");
  expect(cleanHtml.includes("<input"), "干净字段仍需渲染子内容");
});

check("DirtyCountBadge/DirtySummary/DirtySaveButton/DirtyFooter：计数、保存中与中性禁用", async () => {
  const { DirtyCountBadge, DirtySummary, DirtySaveButton, DirtyFooter } = await load(
    "/src/components/ui/dirty-field.tsx",
  );
  expect(render(createElement(DirtyCountBadge, { count: 0 })) === "", "0 项时不应渲染计数徽章");
  const countHtml = render(createElement(DirtyCountBadge, { count: 3 }));
  includesAll(countHtml, ["3 项未保存", "bg-warning-soft"], "未保存计数徽章");
  const summaryHtml = render(createElement(DirtySummary, { count: 2, onResetAll: () => {} }));
  includesAll(summaryHtml, ["未保存 2 项", "恢复全部"], "底部未保存摘要");
  includesAll(render(createElement(DirtySummary, { count: 2, saving: true })), ["保存中"], "保存中摘要");
  includesAll(render(createElement(DirtySummary, { count: 0 })), ["所有修改已保存"], "干净摘要");

  const dirtyBtn = render(createElement(DirtySaveButton, { dirty: true, onClick: () => {} }, "保存"));
  expect(!dirtyBtn.includes(' disabled=""'), "脏状态下保存按钮应可用");
  expect(dirtyBtn.includes("bg-primary"), "脏状态下保存按钮应是主按钮");
  const cleanBtn = render(createElement(DirtySaveButton, { dirty: false, onClick: () => {} }, "保存"));
  expect(cleanBtn.includes(' disabled=""'), "干净状态下保存按钮必须禁用（中性）");
  expect(cleanBtn.includes("bg-surface-2"), "干净状态下保存按钮必须是中性色，实际：" + cleanBtn);
  const pendingBtn = render(createElement(DirtySaveButton, { dirty: true, pending: true }, "保存"));
  expect(pendingBtn.includes(' disabled=""') && pendingBtn.includes("保存中"), "保存中必须禁用并显示进度");
  expect(
    pendingBtn.includes('data-slot="spinner"') && pendingBtn.includes("motion-reduce:animate-none"),
    "保存中必须复用 ui/spinner（自带 motion-reduce 降级），不得手写 Loader2 + animate-spin",
  );

  const footer = render(
    createElement(
      DirtyFooter,
      { count: 2, onResetAll: () => {}, saving: false },
      createElement("button", { type: "button" }, "保存"),
    ),
  );
  includesAll(footer, ["sticky", "bottom-0", "未保存 2 项", "恢复全部", "保存"], "脏表单底部动作条");
  expect(
    !footer.includes("backdrop-blur") && !footer.includes("bg-surface/95"),
    "底栏必须不透明（DESIGN-AUDIT：不做半透明 + 背景模糊）",
  );
  const dirtySource = read("src/components/ui/dirty-field.tsx");
  expect(!dirtySource.includes("Loader2") && !dirtySource.includes("animate-spin"), "进度必须走 ui/spinner，不得手写旋转动画");
  includesAll(dirtySource, ["@/components/ui/spinner", "<Spinner"], "脏表单进度指示器");
});

// ---------- 5. toast 统一策略 ----------
check("toast-policy：统一 3s、右上且避开顶栏、不可被调用方延长", async () => {
  const { NOTIFY_DURATION_MS, TOAST_POSITION, TOAST_OFFSET, TOAST_VISIBLE_COUNT, withToastDefaults } = await load(
    "/src/lib/toast-policy.ts",
  );
  expect(NOTIFY_DURATION_MS === 3000, "统一时长必须是 3 秒，实际 " + NOTIFY_DURATION_MS);
  expect(TOAST_POSITION === "top-right", "toast 必须在右上（避开表格底部与操作列），实际 " + TOAST_POSITION);
  expect(TOAST_OFFSET.top >= 64, "右上 toast 必须下移避开 64px 顶栏，实际 top=" + TOAST_OFFSET.top);
  expect(TOAST_VISIBLE_COUNT === 3, "同屏最多 3 条");
  const defaults = withToastDefaults();
  expect(defaults.duration === 3000 && defaults.closeButton === true, "默认必须 3s + 关闭按钮");
  const forced = withToastDefaults({ duration: 60000, closeButton: false });
  expect(forced.duration === 3000, "调用方给的 duration 必须被 3s 覆盖，实际 " + forced.duration);
  expect(forced.closeButton === true, "调用方不能关掉关闭按钮");
});

check("接线：notify 与 Toaster 都用 toast-policy，Toaster 位置/时长来自常量", () => {
  const notify = read("src/lib/notify.ts");
  includesAll(notify, ["from \"@/lib/toast-policy\"", "withToastDefaults"], "lib/notify.ts");
  expect(!notify.includes("...options }"), "旧实现允许调用方覆盖 duration，必须移除");
  const sonner = read("src/components/ui/sonner.tsx");
  includesAll(
    sonner,
    ["from \"@/lib/toast-policy\"", "position={TOAST_POSITION}", "offset={TOAST_OFFSET}", "duration: NOTIFY_DURATION_MS"],
    "components/ui/sonner.tsx",
  );
});

// ---------- 6. 表单接线（抽屉/弹窗/页面三种） ----------
check("抽屉表单 role-drawer：字段级脏标记 + 权限区块计数 + 底部未保存摘要", () => {
  const text = read("src/components/roles/role-drawer.tsx");
  includesAll(
    text,
    ["useDirtyFields", "sameSet", "DirtyField", "DirtyCountBadge", "DirtyFooter", "DirtySaveButton", "onReset"],
    "role-drawer 接线",
  );
});

check("弹窗表单 edit-user-dialog：字段级脏标记 + 语义状态选项 + 底部未保存摘要", () => {
  const text = read("src/components/users/edit-user-dialog.tsx");
  includesAll(
    text,
    ["useDirtyFields", "DirtyField", "DirtyFooter", "DirtySaveButton", "onReset", "text-success-text", "text-warning-text"],
    "edit-user-dialog 接线",
  );
});

check("页面表单 ops_settings：连接地址用脏标记原语 + 恢复 + 底部摘要", () => {
  const text = read("src/pages/ops_settings.tsx");
  includesAll(
    text,
    ["useDirtyFields", "DirtyField", "DirtyFooter", "DirtySaveButton", "onReset"],
    "ops_settings 接线",
  );
});

// ---------- 6b. 上游模型满高抽屉与冷却互斥（ticket 11） ----------
check("cooldown-state：单次/周期互斥与阻塞说明", async () => {
  const { cooldownModeState } = await load("/src/components/models/cooldown-state.ts");
  const now = 1_700_000_000_000;
  const fmt = (ms) => "T" + ms;
  const baseRule = {
    id: "rule_1", kind: "cooldown", scope: "upstream_model", scope_id: "m1",
    recurrence: "once", expires_at_ms: now + 3_600_000, schedule_json: null, note: "", created_at_ms: now,
  };
  const call = (overrides) => cooldownModeState({
    row: { enabled: true },
    rules: [],
    scope: "upstream_model",
    scopeId: "m1",
    nowMs: now,
    formatDeadline: fmt,
    ...overrides,
  });

  // 1) 常态：没有冷却、不阻塞模式、没有解除入口。
  const normal = call({});
  expect(!normal.cooling && !normal.blockedSingle && !normal.blockedPeriodic && !normal.releaseVisible, "常态不应有冷却/阻塞/解除");
  expect(normal.singleBlockReason === "" && normal.periodicBlockReason === "", "常态不应有阻塞说明");
  expect(normal.coolingUntilMs === 0, "常态冷却截止必须为 0，实际 " + normal.coolingUntilMs);

  // 2) 单次冷却生效：周期模式禁用；单次模式仍可用（改期）；解除可见。
  const single = call({
    row: { enabled: true, cooldown_until_ms: now + 3_600_000, availability: { state: "cooling", cooldown_until_ms: now + 3_600_000 } },
    rules: [baseRule],
  });
  expect(single.cooling, "单次冷却中 cooling 必须为 true");
  expect(single.singleActiveRule && single.singleActiveRule.id === "rule_1", "必须识别生效中的单次规则");
  expect(single.coolingUntilMs === now + 3_600_000, "冷却截止应取规则截止，实际 " + single.coolingUntilMs);
  expect(single.blockedPeriodic === true && single.blockedSingle === false, "单次生效只禁周期模式");
  expect(single.periodicBlockReason.includes("单次冷却生效期间不能创建或改期周期冷却"), "周期禁用要给出互斥原因：" + single.periodicBlockReason);
  expect(single.periodicBlockReason.includes("T" + (now + 3_600_000)), "周期禁用原因要含单次截止时间：" + single.periodicBlockReason);
  expect(single.releaseVisible === true, "冷却中必须给出解除入口");

  // 3) 周期窗口生效（行冷却但无单次规则）：单次模式禁用；说明含阻塞规则与窗口结束时间。
  const periodicRule = {
    ...baseRule, id: "rule_2", recurrence: "daily", expires_at_ms: null,
    schedule_json: JSON.stringify({ windows: [{ start: "02:00", end: "04:00" }] }),
  };
  const periodic = call({
    row: { enabled: true, cooldown_until_ms: now + 1_800_000, availability: { state: "cooling", cooldown_until_ms: now + 1_800_000 } },
    rules: [periodicRule],
  });
  expect(periodic.cooling && periodic.releaseVisible, "周期窗口生效时也必须显示冷却与解除");
  expect(periodic.periodicActiveRule && periodic.periodicActiveRule.id === "rule_2", "必须识别周期窗口规则");
  expect(periodic.blockedSingle === true && periodic.blockedPeriodic === false, "周期窗口生效只禁单次模式");
  expect(periodic.singleBlockReason.includes("周期冷却窗口生效期间不能设置单次冷却"), "单次禁用要给出互斥原因：" + periodic.singleBlockReason);
  expect(periodic.singleBlockReason.includes("T" + (now + 1_800_000)), "单次禁用原因要含窗口结束时间：" + periodic.singleBlockReason);
  expect(periodic.singleBlockReason.includes("每天"), "单次禁用原因要含阻塞规则摘要：" + periodic.singleBlockReason);

  // 4) 缺 availability:read（rules=null）降级：仍显示冷却与解除，但不猜着禁用模式。
  const unknown = call({
    row: { enabled: true, cooldown_until_ms: now + 600_000, availability: { state: "cooling", cooldown_until_ms: now + 600_000 } },
    rules: null,
  });
  expect(unknown.cooling && unknown.releaseVisible, "规则不可读时仍应显示冷却与解除");
  expect(unknown.blockedSingle === false && unknown.blockedPeriodic === false, "规则不可读时不能猜着禁用模式");

  // 5) 其它 scope / ban 规则不得被当成生效冷却。
  const other = call({
    row: { enabled: true, cooldown_until_ms: now + 600_000, availability: { state: "cooling", cooldown_until_ms: now + 600_000 } },
    rules: [
      { ...baseRule, id: "rule_x", scope: "public_model", scope_id: "p1" },
      { ...baseRule, id: "rule_y", kind: "ban", expires_at_ms: null },
    ],
  });
  expect(other.singleActiveRule === null && other.periodicActiveRule === null, "其它 scope/ban 规则不得被当成生效冷却");
  expect(other.blockedSingle === false && other.blockedPeriodic === false, "其它规则不得误禁模式");

  // 6) 已关闭的行仍有冷却：解除入口照常给出。
  const closed = call({
    row: { enabled: false, cooldown_until_ms: now + 600_000, availability: { state: "closed" } },
  });
  expect(closed.cooling === true && closed.releaseVisible === true, "关闭的行若有未来冷却截止仍应显示解除入口");
});

check("CooldownControlPanel：模式禁用/互斥说明/唯一解除/选中态", async () => {
  const { CooldownControlPanel } = await load("/src/components/models/cooldown-panel.tsx");
  const baseState = {
    cooling: false,
    coolingUntilMs: 0,
    singleActiveRule: null,
    periodicActiveRule: null,
    blockedSingle: false,
    blockedPeriodic: false,
    singleBlockReason: "",
    periodicBlockReason: "",
    releaseVisible: false,
  };
  const panel = (state, extra) =>
    render(
      createElement(CooldownControlPanel, {
        state,
        mode: "single",
        onModeChange: () => {},
        onRelease: () => {},
        singleForm: createElement("div", null, "单次冷却表单"),
        periodicForm: createElement("div", null, "周期冷却表单"),
        ...extra,
      }),
    );
  const tagOf = (html, marker) => {
    const match = html.match(new RegExp("<button[^>]*" + marker + "[^>]*>"));
    return match ? match[0] : "";
  };
  const source = read("src/components/models/cooldown-panel.tsx");
  includesAll(source, ["ToggleGroup", "ToggleGroupItem", 'type="single"'], "模式卡必须复用 ui/toggle-group 单选原语");
  expect(!source.includes("function ModeCard"), "手写 ModeCard（button + aria-pressed）必须删除，改由 ToggleGroupItem 承担单选语义");

  // 1) 常态：两种模式都可选，无互斥提示、无解除入口；单次模式选中态明显且只渲染当前表单。
  const normal = panel(baseState);
  expect(normal.includes('data-slot="cooldown-panel"'), "冷却面板缺少 data-slot 标记：" + normal.slice(0, 200));
  expect(!normal.includes('data-slot="cooldown-conflict"'), "常态不应出现互斥提示");
  expect(!normal.includes('data-slot="cooldown-release"'), "常态不应出现解除入口");
  const normalSingle = tagOf(normal, 'data-mode="single"');
  const normalPeriodic = tagOf(normal, 'data-mode="periodic"');
  // Radix ToggleGroup type="single" 用 radio 语义（role="radio" + aria-checked），不手写 aria-pressed。
  const pressed = (tag) => tag.includes('aria-checked="true"') || tag.includes('aria-pressed="true"');
  const unpressed = (tag) => tag.includes('aria-checked="false"') || tag.includes('aria-pressed="false"');
  expect(pressed(normalSingle) && normalSingle.includes("border-primary"), "选中的单次模式必须有明显选中态：" + normalSingle);
  expect(unpressed(normalPeriodic), "未选中的周期模式必须暴露未选中态（aria-checked=false）");
  // 原语基类自带 disabled: 变体类名，这里只匹配布尔 disabled 属性，避免误判。
  const hasDisabledAttr = (tag) => /\sdisabled(?:=|\s|>)/.test(tag);
  expect(!hasDisabledAttr(normalSingle) && !hasDisabledAttr(normalPeriodic), "常态两种模式都不应禁用");
  expect(normal.includes("单次冷却表单") && !normal.includes("周期冷却表单"), "只渲染当前选中模式表单");

  // 2) 周期窗口生效：单次模式禁用 + 互斥说明（含窗口结束时间）+ 唯一解除。
  const singleReason = "周期冷却窗口生效期间不能设置单次冷却；阻塞规则：每天 02:00 至 04:00；窗口至 11-20 12:00，可先解除跳过本窗口";
  const blockedSingle = panel(
    { ...baseState, cooling: true, coolingUntilMs: 1, blockedSingle: true, singleBlockReason: singleReason, releaseVisible: true },
    { mode: "single" },
  );
  expect(tagOf(blockedSingle, 'data-mode="single"').includes("disabled"), "周期窗口生效时必须禁用单次模式");
  expect(blockedSingle.includes('data-slot="cooldown-conflict"'), "互斥冲突必须有醒目的提示块");
  expect(blockedSingle.includes("周期冷却窗口生效期间不能设置单次冷却"), "互斥提示缺少原因");
  expect(blockedSingle.includes("窗口至 11-20 12:00"), "互斥提示缺少窗口结束时间");
  expect((blockedSingle.match(/data-slot="cooldown-release"/g) || []).length === 1, "冷却中必须恰好一个解除入口");

  // 3) 单次冷却生效：周期模式禁用 + 互斥说明；解除入口按 pending 禁用。
  const periodicReason = "单次冷却生效期间不能创建或改期周期冷却；当前单次冷却至 11-20 12:00，请先解除单次冷却";
  const blockedPeriodic = panel(
    { ...baseState, cooling: true, coolingUntilMs: 1, blockedPeriodic: true, periodicBlockReason: periodicReason, releaseVisible: true },
    { mode: "single", pending: true },
  );
  expect(tagOf(blockedPeriodic, 'data-mode="periodic"').includes("disabled"), "单次冷却生效时必须禁用周期模式");
  expect(blockedPeriodic.includes("单次冷却生效期间不能创建或改期周期冷却"), "互斥提示缺少原因");
  expect(blockedPeriodic.includes("仅跳过当前窗口") || blockedPeriodic.includes("只跳过本窗口") || blockedPeriodic.includes("跳过本窗口"), "解除入口要说明只跳过本窗口");
  expect(tagOf(blockedPeriodic, 'data-slot="cooldown-release"').includes("disabled"), "解除动作 pending 时必须禁用");

  // 4) 选中周期模式：换表单、切换态正确。
  const periodicMode = panel(baseState, { mode: "periodic" });
  expect(pressed(tagOf(periodicMode, 'data-mode="periodic"')), "周期模式选中态");
  expect(periodicMode.includes("周期冷却表单") && !periodicMode.includes("单次冷却表单"), "切换模式后只渲染周期表单");
});

check("上游模型满高抽屉：右侧满高、视口自适应宽度、四组内容、固定底栏与 09 脏标记", () => {
  const text = read("src/components/models/upstream-model-drawer.tsx");
  includesAll(
    text,
    [
      // 右侧满高抽屉：侧边、满高（h-dvh）、宽度封顶 820px 且受视口约束（W6 票09 自适应改造）
      "SheetContent",
      'side="right"',
      "h-dvh",
      "w-full",
      "sm:w-[min(820px,calc(100vw-2rem))]",
      "sm:max-w-[calc(100vw-2rem)]",
      // 三段式骨架：可滚动内容 + 固定底栏
      "flex-1",
      "overflow-y-auto",
      "shrink-0",
      "border-t",
      // 四个分组
      "基本信息",
      "能力与参数",
      "价格",
      "状态与冷却",
      // 09 脏标记原语
      "useDirtyFields",
      "DirtyField",
      "DirtyCountBadge",
      "DirtyFooter",
      "DirtySaveButton",
      "onReset",
      // 冷却面板 + 互斥推导
      "CooldownControlPanel",
      "cooldownModeState",
      "useAvailabilityRulesQuery",
      "availability:read",
      // 未保存离开与保存状态
      "ConfirmDialog",
      "保存中",
      "保存失败",
      "取消",
    ],
    "上游模型满高抽屉",
  );
  // 保存是唯一主按钮：只有一个 DirtySaveButton，其余按钮不得用 primary 变体。
  expect((text.match(/<DirtySaveButton/g) || []).length === 1, "抽屉必须恰好一个主保存按钮（DirtySaveButton）");
  expect(!text.includes('variant="primary"'), "除保存外的按钮不得用 primary 变体（保存是唯一主按钮）");
});

check("接线：两处上游模型编辑改用抽屉，冷却入口只在抽屉", () => {
  for (const file of ["src/pages/models.tsx", "src/components/upstreams/models-panel.tsx"]) {
    const text = read(file);
    expect(text.includes("upstream-model-drawer"), file + " 必须使用满高抽屉编辑上游模型");
    expect(!text.includes("upstream-model-dialog"), file + " 不能再引用旧弹窗");
    expect(!text.includes("CooldownManageDialog"), file + " 冷却控制必须收进抽屉（行内不再弹冷却窗）");
  }
  const models = read("src/pages/models.tsx");
  expect(!models.includes("cooldownFor"), "行内不再保留冷却快捷入口（冷却只从抽屉进入）");
  const panel = read("src/components/upstreams/models-panel.tsx");
  expect(panel.includes("releaseCooldown"), "上游详情模型行冷却中要保留「解除」快捷入口");
});

check("冷却表单：单次预设/自定义截止与周期规则编辑", async () => {
  const { SingleCooldownFields, PeriodicCooldownFields } = await load("/src/components/models/cooldown-panel.tsx");

  // 单次：1/3/6/12/24/72 小时预设 + 自定义截止 + 原因 + 到期时刻说明，默认选中 1 小时。
  const single = render(createElement(SingleCooldownFields, { pending: false, onSubmit: () => {}, onDirtyChange: () => {} }));
  includesAll(single, ["1 小时", "3 小时", "6 小时", "12 小时", "24 小时", "72 小时", "自定义截止", "到期时刻", "原因", "设置冷却"], "单次冷却表单");
  const pressed = single.match(/aria-pressed="true"/g) || [];
  expect(pressed.length === 1, "单次冷却默认必须恰好选中一个时长预设，实际 " + pressed.length);
  expect(single.includes("<svg"), "提交按钮必须带语义图标（不只靠颜色）");

  // 周期：已有周期规则（摘要 + 删除规则）+ 重复方式/时间窗/备注 + 提交。
  const periodicRule = {
    id: "rule_2", kind: "cooldown", scope: "upstream_model", scope_id: "m1", recurrence: "daily",
    expires_at_ms: null, schedule_json: JSON.stringify({ windows: [{ start: "02:00", end: "04:00" }] }),
    note: "", created_at_ms: 1,
  };
  const periodic = render(
    createElement(PeriodicCooldownFields, {
      scope: "upstream_model",
      scopeId: "m1",
      rules: [periodicRule],
      pending: false,
      onSubmit: () => {},
      onRemoveRule: () => {},
      onDirtyChange: () => {},
    }),
  );
  includesAll(periodic, ["已有周期冷却", "每天 02:00 至 04:00", "删除规则", "重复方式", "开始时间", "结束时间", "备注", "设置周期冷却"], "周期冷却表单");
  expect(!periodic.includes("仅跳过当前窗口"), "周期表单不得混入单次解除语义");
});

// ---------- 7. 行内语义动作按钮接线 ----------
const actionFiles = [
  ["src/pages/models.tsx", ["edit", "delete", "releaseCooldown", "disable", "enable"]],
  ["src/pages/upstreams.tsx", ["edit", "delete", "testConnection", "disable", "enable"]],
  ["src/pages/client_keys.tsx", ["rename", "resetKey", "delete", "disable", "enable"]],
  ["src/pages/roles.tsx", ["edit", "delete"]],
  ["src/components/users/users-panel.tsx", ["edit", "delete", "disable", "enable"]],
  ["src/components/upstreams/models-panel.tsx", ["edit", "delete", "disable", "enable", "testConnection", "fetchModels", "releaseCooldown"]],
  ["src/components/models/cooldown-panel.tsx", ["releaseCooldown", "cooldown", "delete"]],
  ["src/components/models/upstream-model-drawer.tsx", ["enable", "disable"]],
  ["src/pages/upstream_detail.tsx", ["testConnection"]],
];
const legacyIconKeys = ["delete", "disable", "enable", "cooldown", "releaseCooldown", "testConnection"];
for (const [file, actions] of actionFiles) {
  check("语义动作按钮：" + file, () => {
    const text = read(file);
    expect(text.includes("ActionButton"), file + " 必须改用 ActionButton 统一图标 + 语义色");
    for (const action of actions) {
      expect(text.includes('"' + action + '"'), file + " 缺少 action=" + action);
    }
    for (const key of legacyIconKeys) {
      expect(!text.includes("<ACTION_ICONS." + key), file + " 仍直接渲染 <ACTION_ICONS." + key + "，应改用 ActionButton");
    }
  });
}

check("用户关闭：可逆操作不弹确认（DESIGN-AUDIT §4），当前登录账号禁用并说明", () => {
  const text = read("src/components/users/users-panel.tsx");
  includesAll(text, ["usePermissions", "me?.id", "不能关闭当前登录账号"], "当前账号关闭按钮的禁用说明");
  expect(!text.includes("disableTarget"), "关闭/重新启用是可逆操作，不得再弹二次确认弹窗（可逆操作直接执行）");
  expect(!/关闭用户「/.test(text), "用户关闭确认弹窗必须删除");
});

// ---------- 8. 公开模型单页编辑器（W5 ticket 13） ----------
const publicModelFixture = (patch = {}) => ({
  id: "pm_01",
  name: "glm-5.3",
  routing_mode: "failover",
  note: "主力对话模型",
  enabled: true,
  created_at_ms: Date.parse("2026-11-10T09:00:00"),
  targets: [
    { id: "mt_02", public_model_id: "pm_01", upstream_model_id: "um_02", upstream_model_name: "glm-5.3-flash", upstream_name: "zai-01", priority: 2, weight: 1, when: null, enabled: true },
    { id: "mt_01", public_model_id: "pm_01", upstream_model_id: "um_01", upstream_model_name: "glm-5.3", upstream_name: "zai-01", priority: 1, weight: 1, when: null, enabled: true },
  ],
  ...patch,
});
const upstreamModelFixtures = [
  { id: "um_01", upstream_id: "up_01", name: "glm-5.3", upstream_name: "zai-01", model_type: "chat", enabled: true, created_at_ms: 0 },
  { id: "um_02", upstream_id: "up_01", name: "glm-5.3-flash", upstream_name: "zai-01", model_type: "chat", enabled: true, created_at_ms: 0 },
];
const dirtyStateOf = (fields) => ({
  dirtyFields: new Set(fields),
  dirtyCount: fields.length,
  isDirty: fields.length > 0,
  isDirtyField: (field) => fields.includes(field),
});
const pageForm = (patch = {}) => ({
  name: "glm-5.3",
  routing_mode: "failover",
  note: "主力对话模型",
  enabled: true,
  members: [
    { upstream_model_id: "um_01", priority: "1", weight: "1", when: "" },
    { upstream_model_id: "um_02", priority: "2", weight: "1", when: "" },
  ],
  ...patch,
});
const pageProps = (patch = {}) => ({
  model: publicModelFixture(),
  form: pageForm(),
  upstreamModels: upstreamModelFixtures,
  fallbackNames: new Map(),
  dirty: dirtyStateOf(["name"]),
  saving: false,
  saveError: null,
  missingPermissions: [],
  onFormChange: () => {},
  onMembersChange: () => {},
  onResetField: () => {},
  onResetAll: () => {},
  onSave: () => {},
  ...patch,
});
const buttonsContaining = (html, text) =>
  [...html.matchAll(/<button\b[\s\S]*?<\/button>/g)].map((match) => match[0]).filter((button) => button.includes(text));

check("public-model-form：草稿 hydrate、单 PATCH 载荷、双权限与整页校验", async () => {
  const { EMPTY_PUBLIC_MODEL_FORM, formOf, missingPermissions, normalizeForm, patchPayloadOf, validateForm } = await load(
    "/src/components/models/public-model-form.ts",
  );
  const form = formOf(publicModelFixture());
  expect(form.name === "glm-5.3" && form.routing_mode === "failover" && form.enabled === true, "formOf 必须回填基本字段");
  expect(form.note === "主力对话模型", "formOf 必须回填备注");
  expect(form.members.length === 2, "formOf 必须带入成员草稿");
  expect(form.members[0].upstream_model_id === "um_02", "成员草稿保持服务端 targets 顺序（fixture 故意乱序）");
  expect(form.members[0].priority === "2" && form.members[0].weight === "1", "成员数字字段必须转成字符串");
  expect(EMPTY_PUBLIC_MODEL_FORM.name === "" && EMPTY_PUBLIC_MODEL_FORM.members.length === 0, "空草稿不能带成员");
  const payload = patchPayloadOf({ ...form, name: "  glm-5.3  ", note: " 备注 " });
  expect(payload.name === "glm-5.3" && payload.note === "备注", "单 PATCH 载荷必须 trim 名称/备注，实际 " + JSON.stringify(payload));
  expect(Array.isArray(payload.targets) && payload.targets.length === 2, "单 PATCH 必须携带 targets");
  expect(payload.targets[0].priority === 1 && payload.targets[1].priority === 2, "targets 必须按 priority 升序提交");
  expect(payload.enabled === true && payload.routing_mode === "failover", "载荷必须包含启用与策略");
  expect(typeof payload.targets[0].weight === "number", "targets weight 必须是数字");
  const noWeight = patchPayloadOf({ ...form, members: [{ upstream_model_id: "um_01", priority: "1", weight: "", when: "" }] });
  expect(noWeight.targets[0].weight === 0, "空 weight 必须提交成 0");
  expect(missingPermissions(() => true).length === 0, "权限齐全时不应缺权限");
  expect(
    missingPermissions((permission) => permission === "public_models:write").join(",") === "model_targets:write",
    "只缺成员写权限时必须精确点名 model_targets:write",
  );
  expect(
    missingPermissions(() => false).join(",") === "public_models:write,model_targets:write",
    "双权限必须按固定顺序返回",
  );
  expect(validateForm({ ...form, name: "  " }).some((error) => error.includes("名称")), "名称不能为空");
  expect(validateForm({ ...form, members: [] }).some((error) => error.includes("至少保留 1 个成员")), "至少要保留一个成员");
  expect(
    validateForm({ ...form, members: [form.members[0], { ...form.members[0] }] }).some((error) => error.includes("成员重复")),
    "重复成员必须报错",
  );
  const conditional = normalizeForm({
    ...form,
    routing_mode: "conditional",
    members: [
      { upstream_model_id: "um_01", priority: "1", weight: "", when: "" },
      { upstream_model_id: "um_02", priority: "2", weight: "", when: "" },
    ],
  });
  expect(validateForm(conditional).some((error) => error.includes("末位")), "conditional 非末位成员不能留空 when");
  expect(normalizeForm(conditional).members.length === 2 && normalizeForm(conditional).members[0].when === "", "normalizeForm 必须保留成员 when");
});

check("PublicModelPageView：单页三段 + 页头 h1/状态/脏标记 + 唯一「保存」", async () => {
  const { PublicModelPageView } = await load("/src/components/models/public-model-page.tsx");
  const html = render(createElement(PublicModelPageView, pageProps()));
  expect(!html.includes("tablist"), "公开模型编辑器不能再有页签");
  expect(!html.includes('role="tab"'), "不能再有 tab role");
  expect(/<h1[^>]*>/.test(html), "页头必须是 h1");
  includesAll(html, ["glm-5.3", "failover · 故障转移", "正常", "1 项未保存", "未保存 1 项"], "页头状态与脏标记");
  const basic = html.indexOf("基本信息");
  const members = html.indexOf("成员编排");
  const summary = html.indexOf("只读摘要");
  expect(basic >= 0 && members > basic && summary > members, "三段顺序必须是 基本信息 → 成员编排 → 只读摘要");
  const saveButtons = buttonsContaining(html, "保存");
  expect(saveButtons.length === 1, "整页只能有一个保存按钮，实际 " + saveButtons.length);
  expect(!html.includes("保存整页"), "旧「保存整页」文案必须移除");
  expect(!html.includes("保存成员"), "旧成员保存按钮必须移除");
  // ticket 14：保存/状态/未保存数量固定页头（sticky），不再有底部动作条。
  const headStart = html.indexOf('data-slot="page-head"');
  const headerSave = html.indexOf('data-slot="header-save"');
  expect(headStart >= 0 && headerSave > headStart, "保存/状态/未保存数量必须固定在 sticky 页头（data-slot=header-save）");
  const summaryStart = html.indexOf('data-slot="readonly-summary"');
  const summaryHtml = html.slice(summaryStart);
  expect(summaryStart > headerSave, "只读摘要折叠容器必须在页头之后（不占主编辑区）");
  expect(!/<input|<textarea|<select/i.test(summaryHtml), "只读摘要内不得有可编辑控件");
  includesAll(summaryHtml, ["priority", "冷却", "上游模型"], "只读摘要必须说明渲染语义与冷却归属");
});

check("PublicModelPageView：保存失败保留脏标记、保存中进度、缺权限禁用保存并点名权限键", async () => {
  const { PublicModelPageView } = await load("/src/components/models/public-model-page.tsx");
  const failed = render(createElement(PublicModelPageView, pageProps({ saveError: "数据库暂时不可用" })));
  includesAll(failed, ["保存失败，修改已保留", "数据库暂时不可用", "未保存 1 项"], "失败时必须保留脏标记与用户输入");
  const saving = render(createElement(PublicModelPageView, pageProps({ saving: true })));
  includesAll(saving, ["保存中"], "保存中必须显示进度");
  expect(buttonsContaining(saving, "保存").every((button) => button.includes("disabled")), "保存中按钮必须禁用");
  const readOnly = render(
    createElement(
      PublicModelPageView,
      pageProps({ dirty: dirtyStateOf([]), missingPermissions: ["public_models:write", "model_targets:write"] }),
    ),
  );
  includesAll(
    readOnly,
    ["缺少权限", "public_models:write", "model_targets:write", "名称、策略、备注与启用状态", "成员编排"],
    "缺权限时必须点名两个权限键与影响范围",
  );
  expect(buttonsContaining(readOnly, "保存")[0].includes("disabled"), "缺权限时保存必须禁用");
  expect(/<fieldset[^>]*disabled/.test(readOnly), "缺权限时字段必须只读");
  const partial = render(createElement(PublicModelPageView, pageProps({ missingPermissions: ["model_targets:write"] })));
  includesAll(partial, ["model_targets:write"], "只缺成员权限也要点名");
  expect(!partial.includes("public_models:write"), "已具备的权限不应出现在缺失提示里");
});

check("PublicModelPageView：成员校验与 conditional 末位兜底提示", async () => {
  const { PublicModelPageView } = await load("/src/components/models/public-model-page.tsx");
  includesAll(
    render(createElement(PublicModelPageView, pageProps())),
    ["至少保留 1 个成员", "成员不可重复", "末位成员可以留空 when"],
    "成员规则提示",
  );
  const empty = render(createElement(PublicModelPageView, pageProps({ form: pageForm({ members: [] }) })));
  includesAll(empty, ["至少保留 1 个成员"], "空成员校验提示");
  expect(buttonsContaining(empty, "保存")[0].includes("disabled"), "成员非法时不能保存");
  const duplicate = render(
    createElement(
      PublicModelPageView,
      pageProps({
        form: pageForm({
          members: [
            { upstream_model_id: "um_01", priority: "1", weight: "1", when: "" },
            { upstream_model_id: "um_01", priority: "2", weight: "1", when: "" },
          ],
        }),
      }),
    ),
  );
  includesAll(duplicate, ["成员重复"], "重复成员提示");
  expect(buttonsContaining(duplicate, "保存")[0].includes("disabled"), "重复成员时不能保存");
  const conditional = pageForm({
    routing_mode: "conditional",
    members: [
      { upstream_model_id: "um_01", priority: "1", weight: "", when: 'request.user_id == "u1"' },
      { upstream_model_id: "um_02", priority: "2", weight: "", when: "" },
    ],
  });
  includesAll(
    render(createElement(PublicModelPageView, pageProps({ form: conditional }))),
    ["conditional", "末位兜底", "glm-5.3-flash"],
    "conditional 末位兜底提示",
  );
  const badConditional = pageForm({
    routing_mode: "conditional",
    members: [
      { upstream_model_id: "um_01", priority: "1", weight: "", when: "" },
      { upstream_model_id: "um_02", priority: "2", weight: "", when: "" },
    ],
  });
  includesAll(
    render(createElement(PublicModelPageView, pageProps({ form: badConditional }))),
    ["只有末位成员可以留空 when"],
    "末位兜底校验提示",
  );
});

check("接线：公开模型编辑器单页（无 Tab、单 PATCH、双权限、脏标记与脏守卫）", () => {
  const text = read("src/components/models/public-model-editor.tsx");
  includesAll(
    text,
    ["PublicModelPageView", "useDirtyFields", "usePermissions", "useDirtyGuard", "ENDPOINTS.publicModelUpdate"],
    "公开模型编辑器接线",
  );
  const formContract = read("src/components/models/public-model-form.ts");
  includesAll(formContract, ["public_models:write", "model_targets:write", "missingPermissions"], "双权限契约");
  expect(!text.includes("Tabs"), "必须移除 Tabs 引入与使用");
  expect(!text.includes("保存整页") && !text.includes("保存成员"), "旧保存文案必须移除");
  expect((text.match(/save\.mutate\(/g) ?? []).length === 1, "整页只能有一个保存入口");
  includesAll(text, ["api.patch", "patchPayloadOf"], "保存必须走单 PATCH 且携带 targets");
  const page = read("src/components/models/public-model-page.tsx");
  expect(!page.includes("Tabs"), "单页视图不得使用 Tabs");
  expect(
    page.includes("DirtySaveButton") && page.includes("DirtySummary") && !page.includes("DirtyFooter"),
    "保存/状态/未保存数量必须固定页头（ticket 14 后公开模型页不再用底部 DirtyFooter）",
  );
});

// ---------- 9. 公开模型成员编排 chip 流（W5 ticket 14） ----------
const chipUpstreamModels = [
  { id: "um_01", upstream_id: "up_01", name: "glm-5.3", upstream_name: "zai-01", model_type: "chat", enabled: true, created_at_ms: 0 },
  { id: "um_02", upstream_id: "up_01", name: "glm-5.3-flash", upstream_name: "zai-01", model_type: "chat", enabled: true, created_at_ms: 0 },
  { id: "um_03", upstream_id: "up_02", name: "nebula-chat-1", upstream_name: "nebula-01", model_type: "chat", enabled: true, created_at_ms: 0 },
  { id: "um_04", upstream_id: "up_02", name: "nebula-embed-1", upstream_name: "nebula-01", model_type: "embedding", enabled: true, created_at_ms: 0 },
];
const chipMembers = [
  { upstream_model_id: "um_01", priority: "1", weight: "1", when: "" },
  { upstream_model_id: "um_02", priority: "2", weight: "1", when: "" },
  { upstream_model_id: "um_03", priority: "2", weight: "1", when: "" },
];
const conditionalMembers = [
  { upstream_model_id: "um_01", priority: "1", weight: "", when: 'request.tier == "pro"' },
  { upstream_model_id: "um_02", priority: "2", weight: "", when: 'request.tier == "std"' },
  { upstream_model_id: "um_03", priority: "3", weight: "", when: "" },
];
const inputTags = (html, label) => [...html.matchAll(new RegExp('<input[^>]*aria-label="' + label + '"[^>]*>', "g"))].map((match) => match[0]);

check("member-chip：成员名统一「上游渠道/模型」，按 priority 分层且同层保序", async () => {
  const chip = await load("/src/components/models/member-chip.ts");
  expect(chip.memberChipLabel("zai-01", "glm-5.3") === "zai-01/glm-5.3", "成员名必须是「上游渠道/模型」");
  expect(chip.memberChipLabel(" zai-01 ", " glm-5.3 ") === "zai-01/glm-5.3", "成员名必须 trim");
  expect(chip.memberChipLabel(undefined, "glm-5.3") === "glm-5.3", "上游渠道缺失时只显示模型名");
  const labelOf = chip.memberLabeler(chipUpstreamModels, new Map([["um_gone", "glm-4.6"]]));
  expect(labelOf("um_01") === "zai-01/glm-5.3", "memberLabeler 必须输出上游渠道/模型，实际 " + labelOf("um_01"));
  expect(labelOf("um_gone") === "glm-4.6", "上游模型列表缺失时回退服务端 join 名");
  expect(!labelOf("um_01").includes(" · "), "成员名不能再用「模型名 · 上游名」");
  const layers = chip.memberLayers(chipMembers, labelOf, "failover");
  expect(JSON.stringify(layers.map((layer) => layer.title)) === JSON.stringify(["第 1 层", "第 2 层"]), "按 priority 升序分两层，实际 " + JSON.stringify(layers.map((layer) => layer.title)));
  expect(layers[0].chips.length === 1 && layers[1].chips.length === 2, "同 priority 必须归入同一层");
  expect(JSON.stringify(layers[1].chips.map((item) => item.label)) === JSON.stringify(["zai-01/glm-5.3-flash", "nebula-01/nebula-chat-1"]), "同层保持草稿顺序，实际 " + JSON.stringify(layers[1].chips.map((item) => item.label)));
  expect(JSON.stringify(layers.flatMap((layer) => layer.chips.map((item) => item.order))) === JSON.stringify([1, 2, 3]), "chip order 必须是分层后的全局 1-based 顺序");
  expect(chip.memberLayers([], labelOf, "failover").length === 0, "空成员不能凭空造层");
});

check("member-chip：conditional 顺序/末位兜底与候选按上游渠道分组搜索", async () => {
  const chip = await load("/src/components/models/member-chip.ts");
  const labelOf = chip.memberLabeler(chipUpstreamModels, new Map());
  const chips = chip.memberLayers(conditionalMembers, labelOf, "conditional").flatMap((layer) => layer.chips);
  expect(JSON.stringify(chips.map((item) => item.order)) === JSON.stringify([1, 2, 3]), "conditional 必须给出顺序徽标序号");
  expect(JSON.stringify(chips.map((item) => item.fallback)) === JSON.stringify([false, false, true]), "只有末位 when 留空的成员是兜底");
  const fallback = chip.conditionalFallback(conditionalMembers, labelOf, "conditional");
  expect(fallback !== null && fallback.label === "nebula-01/nebula-chat-1", "conditionalFallback 必须返回末位兜底成员");
  expect(chip.conditionalFallback(conditionalMembers.map((item) => ({ ...item, when: "true" })), labelOf, "conditional") === null, "末位 when 非空时没有兜底");
  expect(chip.conditionalFallback(chipMembers, labelOf, "failover") === null, "仅 conditional 模式才有末位兜底");
  const groups = chip.candidateGroups(chipUpstreamModels);
  expect(JSON.stringify(groups.map((group) => group.name)) === JSON.stringify(["nebula-01", "zai-01"]), "候选必须按上游渠道名升序分组，实际 " + JSON.stringify(groups.map((group) => group.name)));
  expect(JSON.stringify(groups[1].models.map((model) => model.name)) === JSON.stringify(["glm-5.3", "glm-5.3-flash"]), "组内模型必须按名称升序");
  const byChannel = chip.filterCandidateGroups(groups, "NEBULA");
  expect(byChannel.length === 1 && byChannel[0].models.length === 2, "上游渠道名命中时必须整组保留（大小写不敏感）");
  const byModel = chip.filterCandidateGroups(groups, "embed");
  expect(byModel.length === 1 && byModel[0].models.length === 1 && byModel[0].models[0].name === "nebula-embed-1", "模型名命中时只保留命中的模型");
  expect(chip.filterCandidateGroups(groups, "no-such").length === 0, "无命中时返回空列表");
  expect(chip.filterCandidateGroups(groups, "  ").length === 2, "空关键词返回全部组");
  const hint = chip.conditionalMultiKeyHint([{ upstream_model_id: "um_01" }], chipUpstreamModels, [{ id: "up_01", name: "zai-01", key_count: 3 }]);
  expect(typeof hint === "string" && hint.includes("E20"), "多密钥提示必须提到 E20");
  expect(chip.conditionalMultiKeyHint([{ upstream_model_id: "um_01" }], chipUpstreamModels, [{ id: "up_01", name: "zai-01", key_count: 1 }]) === null, "单密钥不提示 E20");
});

check("MemberChipFlow：已选成员表格化、候选全量原位灰显（SSR，W7 票05）", async () => {
  const flowView = await load("/src/components/models/member-chip-flow.tsx");
  const html = render(createElement(flowView.MemberChipFlow, {
    members: chipMembers, upstreamModels: chipUpstreamModels, fallbackNames: new Map(), mode: "failover", onChange: () => {},
  }));
  includesAll(
    html,
    ['data-slot="member-chip-flow"', 'data-slot="member-table"', 'data-slot="member-table-head"', 'data-slot="member-row"', 'data-slot="member-board-left"', 'data-slot="member-board-right"', "优先级", "成员 / 上游", "同层 P2C 平权", "zai-01/glm-5.3", "zai-01/glm-5.3-flash", "nebula-01/nebula-chat-1"],
    "成员表格与行内编辑流",
  );
  expect(!html.includes("glm-5.3 · zai-01") && !html.includes("zai-01 · glm-5.3"), "成员命名不能再用「模型名 · 上游名」");
  expect((html.match(/data-slot="member-row"/g) ?? []).length === 3, "每个成员一行");
  // failover 行内只渲染 priority：weight/when 输入完全不出现（disabled 也不行）。
  expect(inputTags(html, "priority").length === 3, "每行必须有一个 priority 行内输入");
  expect(!html.includes('aria-label="weight"'), "failover 行不得渲染 weight 输入");
  expect(!html.includes('aria-label="when"'), "failover 行不得渲染 when 输入");
  expect((html.match(/data-slot="member-row-remove"/g) ?? []).length === 3, "每行一个移除按钮");
  expect((html.match(/data-slot="member-row-expand"/g) ?? []).length === 3, "每行一个显式展开 chevron");
  includesAll(html, ["移除 zai-01/glm-5.3", "移除 nebula-01/nebula-chat-1", "展开更多配置 zai-01/glm-5.3"], "移除/展开按钮必须点名成员");
  // 候选：按上游渠道分组 chip；W7 票05 起候选全量原位渲染，已选灰显（+ 变 ×），再点取消。
  expect(!html.includes('role="combobox"'), "候选区不得再用 Combobox 单控件");
  const rightAt = html.indexOf('data-slot="member-board-right"');
  const searchAt = html.indexOf('aria-label="搜索上游渠道或模型"');
  const scrollAt = html.indexOf('data-slot="member-scroll"', rightAt);
  expect(searchAt > rightAt && scrollAt > searchAt, "候选搜索框必须固定在滚动区外（列头内、member-scroll 之前）");
  const chips = html.match(/data-slot="member-candidate-chip"/g) ?? [];
  expect(chips.length === 4, "候选必须全量原位渲染（已选灰显不消失、不重排），实际 " + chips.length);
  const selected = html.match(/data-slot="member-candidate-chip"[^>]*data-selected="true"/g) ?? [];
  expect(selected.length === 3, "已选成员的候选 chip 必须原地灰显，实际 " + selected.length);
  includesAll(html, ["加入成员 nebula-01/nebula-embed-1", "取消选择成员 zai-01/glm-5.3", 'data-slot="member-candidate-group"', "nebula-01", 'aria-pressed="true"'], "候选 chip 加入/取消双态");
  expect(html.includes('data-upstream-model-id="um_04"'), "候选 chip 必须带上游模型 id");

  const weighted = render(createElement(flowView.MemberChipFlow, {
    members: [
      { upstream_model_id: "um_04", priority: "0", weight: "60", when: "" },
      { upstream_model_id: "um_03", priority: "0", weight: "40", when: "" },
    ],
    upstreamModels: chipUpstreamModels, fallbackNames: new Map(), mode: "weighted", onChange: () => {},
  }));
  const weightInputs = inputTags(weighted, "weight");
  expect(weightInputs.length === 2, "weighted 每行必须可编辑 weight");
  expect(weightInputs.some((tag) => tag.includes('value="60"')), "weight 输入必须回显草稿值");
  expect(!weighted.includes('aria-label="when"'), "weighted 行不得渲染 when 输入");
  includesAll(weighted, ["权重"], "weighted 表头出现中文「权重」");
  expect(!weighted.includes("表达式"), "weighted 表头不得出现「表达式」");

  const conditional = render(createElement(flowView.MemberChipFlow, {
    members: conditionalMembers, upstreamModels: chipUpstreamModels, fallbackNames: new Map(), mode: "conditional", onChange: () => {},
  }));
  expect((conditional.match(/data-slot="chip-order"/g) ?? []).length === 3, "conditional 每行必须显示顺序徽标");
  expect((conditional.match(/data-slot="chip-fallback"/g) ?? []).length === 1, "只有末位成员显示兜底标签");
  expect(inputTags(conditional, "when").length === 3, "conditional 每行可编辑 when");
  expect(inputTags(conditional, "when").some((tag) => tag.includes('value="request.tier')), "when 输入必须回显 CEL 谓词");
  expect(!conditional.includes('aria-label="weight"'), "conditional 行不得渲染 weight 输入");
  includesAll(conditional, ["末位兜底", "request.tier", "表达式"], "conditional 必须显示 when 与兜底，表头为中文「表达式」");
});

check("PublicModelPageView：成员表格新命名、末位兜底与成员脏标记", async () => {
  const { PublicModelPageView } = await load("/src/components/models/public-model-page.tsx");
  const html = render(createElement(PublicModelPageView, pageProps({ upstreamModels: chipUpstreamModels })));
  includesAll(html, ['data-slot="member-chip-flow"', 'data-slot="member-table"', "优先级", "zai-01/glm-5.3", "搜索上游渠道或模型"], "单页成员表格");
  expect(!html.includes("glm-5.3 · zai-01") && !html.includes("zai-01 · glm-5.3"), "成员名不能再是「模型名 · 上游名」");
  const dirtyMembers = render(createElement(PublicModelPageView, pageProps({ upstreamModels: chipUpstreamModels, dirty: dirtyStateOf(["members"]) })));
  const memberSection = dirtyMembers.slice(dirtyMembers.indexOf("成员编排"), dirtyMembers.indexOf("只读摘要"));
  includesAll(memberSection, ['data-slot="dirty-field"', 'data-dirty="true"', "已修改", "恢复成员编排"], "成员段必须有脏标记与恢复入口");
  const conditional = render(createElement(PublicModelPageView, pageProps({
    upstreamModels: chipUpstreamModels,
    form: pageForm({
      routing_mode: "conditional",
      members: [
        { upstream_model_id: "um_01", priority: "1", weight: "", when: 'request.tier == "pro"' },
        { upstream_model_id: "um_02", priority: "2", weight: "", when: "" },
      ],
    }),
  })));
  includesAll(conditional, ["条件路由末位兜底：zai-01/glm-5.3-flash", "末位兜底"], "conditional 兜底必须用新命名");
});

check("接线：成员 chip 流替换 MemberBoard，创建弹窗同样用「上游渠道/模型」", () => {
  const page = read("src/components/models/public-model-page.tsx");
  includesAll(page, ["MemberChipFlow", "DirtyField", "恢复成员编排"], "成员段接线");
  expect(!page.includes("MemberBoard"), "单页编辑器不得再用 MemberBoard");
  expect(!page.includes('" · "'), "单页编辑器不得再用「模型名 · 上游名」拼接");
  const editor = read("src/components/models/member-editor.tsx");
  expect(!editor.includes('" · "'), "创建弹窗成员名必须统一「上游渠道/模型」");
  includesAll(editor, ["memberChipLabel", "MemberEditor"], "创建弹窗复用统一命名");
  const flow = read("src/components/models/member-chip-flow.tsx");
  includesAll(
    flow,
    ['data-slot="member-row"', 'data-slot="member-candidates"', 'data-slot="member-candidate-group"', 'data-slot="member-candidate-chip"', "搜索上游渠道或模型", "末位兜底"],
    "行内编辑流结构契约",
  );
  includesAll(flow, ["@/components/ui/button"], "行内编辑流必须复用 Button 原语");
  expect(!flow.includes("<button"), "行内编辑流不得手写 <button>（成员行、移除、候选 chip 都走原语）");
  const chip = read("src/components/models/member-chip.ts");
  includesAll(chip, ["memberChipLabel", "memberLayers", "conditionalFallback", "candidateGroups", "filterCandidateGroups"], "纯函数契约");
});

// ---------- 10. 统一悬浮详情 HoverInfo（W7 ticket 08）：语义色与稳定态 ----------
check("HoverInfo 浮层：底色与前景走语义 token，不写死颜色（浅深主题自适应）", () => {
  const src = read("src/components/ui/hover-info.tsx");
  includesAll(src, ["bg-popover", "text-popover-foreground"], "浮层底色与前景色");
  const magic = src.match(/#[0-9a-fA-F]{3,8}\b|rgba?\(/g);
  expect(!magic, "浮层不得出现魔法色值：" + (magic ?? []).join("、"));
});

check("HoverInfo：禁用与空内容是稳定态——不浮层、不新增焦点落点、禁用标记 aria-disabled", async () => {
  const { HoverInfo } = await load("/src/components/ui/hover-info.tsx");
  const disabled = render(
    createElement(HoverInfo, { content: "详情", disabled: true }, createElement("span", null, "关闭")),
  );
  expect(disabled.includes('aria-disabled="true"'), "禁用态必须标记 aria-disabled");
  expect(!disabled.includes('tabindex="0"'), "禁用态不得新增焦点落点");
  const empty = render(
    createElement(HoverInfo, { content: "" }, createElement("span", null, "关闭")),
  );
  expect(!empty.includes('tabindex="0"'), "空内容不得新增焦点落点（没有详情可读）");
  expect(!empty.includes('aria-disabled="true"'), "空内容不是禁用，只是没有详情可展示");
});

// ---------- 11. 模型参数列（W7 ticket 09）：语义色与缺失值口径 ----------
check("参数列与悬浮详情：走语义色 token，不写死颜色", () => {
  const src = read("src/components/models/model-params-cell.tsx");
  includesAll(src, ["text-body", "text-faint"], "参数单元格与详情行必须走语义色");
  const magic = src.match(/#[0-9a-fA-F]{3,8}\b|rgba?\(/g);
  expect(!magic, "参数单元格不得出现魔法色值：" + (magic ?? []).join("、"));
});

check("缺失值口径：两处模型表共用同一个「未配置」写法", () => {
  const vocab = read("src/components/models/model-vocab.ts");
  expect(vocab.includes('PARAM_MISSING = "未配置"'), "缺失值口径必须收在一个常量里");
  const models = read("src/pages/models.tsx");
  const panel = read("src/components/upstreams/models-panel.tsx");
  for (const [file, text] of [["models.tsx", models], ["models-panel.tsx", panel]]) {
    expect(text.includes("ModelParamsCell"), file + " 必须复用共享参数单元格（缺失值口径不得各写各的）");
    expect(!text.includes("未声明"), file + " 参数列不得再出现旧口径「未声明」");
  }
});

// ---------- run ----------
server = await createServer({
  configFile: join(webRoot, "vite.config.ts"),
  root: webRoot,
  logLevel: "silent",
  server: { middlewareMode: true },
  appType: "custom",
});

const failures = [];
try {
  for (const { name, fn } of checks) {
    try {
      await fn();
      console.log("ok   - " + name);
    } catch (error) {
      failures.push({ name, message: error && error.message ? error.message : String(error) });
      console.log("FAIL - " + name + "\n       " + (error && error.message ? error.message : error));
    }
  }
} finally {
  await server.close();
}

console.log("\n" + (checks.length - failures.length) + "/" + checks.length + " checks passed");
if (failures.length > 0) {
  console.error("\n未通过的契约：");
  for (const failure of failures) console.error("- " + failure.name + "：" + failure.message);
  process.exitCode = 1;
}
