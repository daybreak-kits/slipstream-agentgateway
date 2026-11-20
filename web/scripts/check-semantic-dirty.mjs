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

check("DirtyField：脏时 2px 警示条 + 浅底 + 已修改点 + 恢复该项；干净时不渲染标记", async () => {
  const { DirtyField } = await load("/src/components/ui/dirty-field.tsx");
  const input = createElement("input", { defaultValue: "v", "aria-label": "字段" });
  const dirtyHtml = render(createElement(DirtyField, { dirty: true, onReset: () => {}, children: input }));
  includesAll(dirtyHtml, ["w-0.5", "bg-warning", "bg-warning-soft", "已修改", "恢复该项"], "脏字段标记");
  expect(dirtyHtml.includes("<svg"), "恢复该项按钮必须带图标");
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

  const footer = render(
    createElement(
      DirtyFooter,
      { count: 2, onResetAll: () => {}, saving: false },
      createElement("button", { type: "button" }, "保存"),
    ),
  );
  includesAll(footer, ["sticky", "bottom-0", "未保存 2 项", "恢复全部", "保存"], "脏表单底部动作条");
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

// ---------- 7. 行内语义动作按钮接线 ----------
const actionFiles = [
  ["src/pages/models.tsx", ["edit", "delete", "cooldown", "releaseCooldown", "disable", "enable"]],
  ["src/pages/upstreams.tsx", ["edit", "delete", "testConnection", "disable", "enable"]],
  ["src/pages/client_keys.tsx", ["rename", "resetKey", "delete", "disable", "enable"]],
  ["src/pages/roles.tsx", ["edit", "delete"]],
  ["src/components/users/users-panel.tsx", ["edit", "delete", "disable", "enable"]],
  ["src/components/upstreams/models-panel.tsx", ["edit", "delete", "disable", "enable"]],
  ["src/components/models/cooldown-dialogs.tsx", ["releaseCooldown"]],
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
  const summaryStart = html.indexOf('data-slot="public-model-summary"');
  const footerStart = html.indexOf('data-slot="dirty-footer"');
  expect(summaryStart >= 0 && footerStart > summaryStart, "只读摘要必须有独立容器且位于底部动作条之前");
  const summaryHtml = html.slice(summaryStart, footerStart);
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
  expect(page.includes("DirtySaveButton") && page.includes("DirtyFooter"), "单页视图必须用统一脏表单动作条");
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
