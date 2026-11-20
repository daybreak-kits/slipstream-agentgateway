#!/usr/bin/env node
/**
 * 01 ticket 的门禁脚本：驭流品牌与 UI 基础层契约。
 *
 * 为什么是脚本而不是单测：本仓前端没有测试运行器（package.json 无 vitest/jest），
 * 而本 ticket 的契约同时落在三处——构建入口（index.html）、设计 token（index.css/
 * 构建产物）与组件渲染结果。这里用 Vite 的 SSR 加载器编译真实 TSX、用
 * react-dom/server 渲染真实组件，断言的是用户能看到的 DOM 与设计 token，不是内部实现。
 *
 * 用法：node scripts/check-ui-foundation.mjs
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { createServer } from "vite";

const webRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = (...p) => join(webRoot, "src", ...p);
const read = (p) => readFileSync(join(webRoot, p), "utf8");
/** 递归列出 src 下的源码文件：术语门禁要扫全部 UI 文案，不能只抽查几个页面。 */
const sourceFiles = (dir = src()) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return /\.(?:ts|tsx)$/.test(entry.name) ? [full] : [];
  });
const rel = (p) => relative(webRoot, p).replaceAll("\\", "/");

const checks = [];
const check = (name, fn) => checks.push({ name, fn });
const expect = (condition, message) => {
  if (!condition) throw new Error(message);
};
const includesAll = (haystack, needles, label) => {
  const missing = needles.filter((needle) => !haystack.includes(needle));
  expect(missing.length === 0, label + " 缺少：" + missing.join("、"));
};

// ---------- 1. 构建入口与品牌资产 ----------
check("index.html：页签标题为「驭流 Slipstream · LLM API 网关」", () => {
  const html = read("index.html");
  expect(/<title>驭流 Slipstream · LLM API 网关<\/title>/.test(html), "title 未改回驭流品牌全称");
  expect(/<html lang="zh-CN">/.test(html), "lang 必须是 zh-CN");
});

check("index.html：favicon 指向 /logo-v10-contrast.svg", () => {
  const html = read("index.html");
  expect(/<link[^>]+rel="icon"[^>]+type="image\/svg\+xml"[^>]+href="\/logo-v10-contrast\.svg"/.test(html), "favicon link 缺失");
  expect(/<meta name="theme-color" content="#0B0F17"/.test(html), "theme-color 必须与深色 --bg 同值");
});

check("index.html：反闪烁脚本同步 colorScheme", () => {
  const html = read("index.html");
  expect(/classList\.add\("dark"\)/.test(html), "反闪烁脚本必须切 .dark");
  expect(/colorScheme/.test(html), "反闪烁脚本必须同步 color-scheme");
});

check("public：logo-v10-contrast / logo / favicon 三件就位", () => {
  for (const name of ["logo-v10-contrast.svg", "logo.svg", "favicon.svg"]) {
    const file = join(webRoot, "public", name);
    expect(existsSync(file), "缺少 public/" + name);
    const svg = readFileSync(file, "utf8");
    expect(svg.includes("<svg"), "public/" + name + " 不是 SVG");
  }
});

// ---------- 2. 设计 token ----------
check("index.css：语义色 token（三层基底 + 主色/状态色/焦点）", () => {
  const css = read("src/index.css");
  includesAll(css, [
    "--bg:", "--surface:", "--surface-2:", "--border:", "--border-strong:",
    "--text-title:", "--text-body:", "--text-muted:", "--text-faint:",
    "--primary:", "--primary-hover:", "--primary-active:", "--primary-soft:", "--primary-on:",
    "--success:", "--success-text:", "--success-soft:",
    "--warning:", "--warning-text:", "--warning-soft:",
    "--danger:", "--danger-text:", "--danger-soft:", "--info:", "--focus-ring:",
  ], "语义色");
  expect((css.match(/\.dark\s*\{/g) ?? []).length >= 1, "必须有 .dark 主题");
});

check("index.css：shadcn 别名层（bg-background/foreground/…/ring 全部可解析）", () => {
  const css = read("src/index.css");
  includesAll(css, [
    "--background:", "--foreground:", "--card:", "--card-foreground:",
    "--popover:", "--popover-foreground:", "--primary-foreground:",
    "--secondary:", "--secondary-foreground:", "--muted:", "--muted-foreground:",
    "--accent:", "--accent-foreground:", "--destructive:", "--destructive-foreground:",
    "--input:", "--ring:", "--radius:",
  ], ":root 别名层");
  includesAll(css, [
    "--color-background:", "--color-foreground:", "--color-card:", "--color-popover:",
    "--color-primary-foreground:", "--color-secondary:", "--color-muted:",
    "--color-muted-foreground:", "--color-accent:", "--color-accent-foreground:",
    "--color-destructive:", "--color-border:", "--color-input:", "--color-ring:",
  ], "@theme inline 转发");
  expect(/@theme inline\s*\{/.test(css), "@theme inline 的 inline 不能省（否则深色拿不到覆盖）");
});

check("index.css：圆角两套标尺（control/card/badge + shadcn 四档）", () => {
  const css = read("src/index.css");
  includesAll(css, [
    "--radius-control: 8px;", "--radius-card: 12px;", "--radius-badge: 6px;",
    "--radius-sm: 6px;", "--radius-md: 8px;", "--radius-lg: 12px;", "--radius-xl: 16px;",
  ], "圆角");
});

check("index.css：阴影两档 shadow-card / shadow-pop", () => {
  const css = read("src/index.css");
  includesAll(css, [
    "--shadow-card: 0 1px 2px rgba(17, 24, 39, 0.04), 0 8px 24px -18px rgba(17, 24, 39, 0.28);",
    "--shadow-pop: 0 18px 40px -20px rgba(17, 24, 39, 0.35), 0 2px 8px rgba(17, 24, 39, 0.06);",
  ], "阴影");
});

check("index.css：字号四档 + metric 20 + h1 22（14px 基准，最小 12px）", () => {
  const css = read("src/index.css");
  includesAll(css, [
    "--text-2xs: 12px;", "--text-2xs--line-height: 18px;",
    "--text-2sm: 13px;", "--text-2sm--line-height: 20px;",
    "--text-metric: 20px;", "--text-metric--line-height: 28px;",
    "--text-h1: 22px;", "--text-h1--line-height: 30px;",
  ], "字号");
  expect(!/--text-sm:\s*\d/.test(css), "不得覆盖内置 text-sm（14/20），旧规范要求只加档");
  expect(!/--text-xs:\s*\d/.test(css), "不得覆盖内置 text-xs（12/16）");
});

check("index.css：图表 16 槽色板（浅色 + 深色独立亮度集）", () => {
  const css = read("src/index.css");
  for (let i = 1; i <= 16; i += 1) {
    expect((css.match(new RegExp("--chart-" + i + ":", "g")) ?? []).length >= 2, "--chart-" + i + " 必须浅/深各一份");
  }
});

check("index.css：z-index 五档（sticky/topbar/popover/modal/toast；popover 高于 modal：Dialog 内下拉需浮在遮罩上，W6 验收修复）", () => {
  const css = read("src/index.css");
  includesAll(css, ["--z-sticky: 10;", "--z-topbar: 30;", "--z-modal: 50;", "--z-popover: 60;", "--z-toast: 70;"], "z-index");
});

check("index.css：动效 fade-up / fade-in（keyframes 在 @theme 内）", () => {
  const css = read("src/index.css");
  includesAll(css, ["--animate-fade-up: fade-up 200ms ease-out both;", "--animate-fade-in: fade-in 200ms ease-out both;", "@keyframes fade-up", "@keyframes fade-in"], "动效");
});

check("index.css：布局宽度 + base 层（placeholder/autofill/光标/选区）", () => {
  const css = read("src/index.css");
  includesAll(css, ["--width-sidebar: 248px;", "--width-sidebar-collapsed: 72px;"], "侧栏宽度");
  includesAll(css, ["input::placeholder", "-webkit-autofill", "cursor: pointer;", "::selection", "svg text"], "base 层");
});

// ---------- 3. 组件渲染契约 ----------
let server;
const load = async (id) => server.ssrLoadModule(id);

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
// 组件可能依赖 Query 缓存（usePermissions 等），SSR 渲染也必须给 Provider，否则门禁只测到崩溃而不是契约。
const render = (element) =>
  renderToStaticMarkup(
    createElement(QueryClientProvider, { client: queryClient }, createElement(MemoryRouter, null, element)),
  );

check("BrandLockup：两行品牌锁（驭流 14/600 + SLIPSTREAM 12/500 大写 0.12em）+ logo 36", async () => {
  const { BrandLockup } = await load("/src/components/layout/sidebar.tsx");
  const html = render(createElement(BrandLockup, { collapsed: false }));
  expect(html.includes("/logo-v10-contrast.svg"), "logo 必须用产品内主用文件 logo-v10-contrast.svg");
  expect(/alt=""/.test(html), "logo 是装饰性图片，alt 必须为空");
  expect(/aria-hidden="true"/.test(html), "logo 必须 aria-hidden");
  expect(html.includes("h-9 w-9"), "logo 必须是 36×36（h-9 w-9）");
  expect(html.includes("驭流"), "第一行中文名缺失");
  expect(html.includes(">Slipstream<"), "第二行英文名缺失（文本内容为 Slipstream）");
  expect(/text-sm[^"]*font-semibold[^"]*tracking-tight/.test(html), "中文名必须是 14px/600/tracking-tight");
  expect(/text-2xs[^"]*uppercase[^"]*tracking-\[0\.12em\]/.test(html), "英文名必须是 12px/全大写/0.12em");
  expect(html.includes("text-muted-foreground"), "英文名必须弱化为 muted-foreground");
});

check("BrandLockup：折叠态 logo 用 title 兜底、文字块 sr-only", async () => {
  const { BrandLockup } = await load("/src/components/layout/sidebar.tsx");
  const html = render(createElement(BrandLockup, { collapsed: true }));
  expect(html.includes('title="驭流 Slipstream"'), "折叠态必须给 logo 一个 title 兜底");
  expect(/class="[^"]*sr-only[^"]*"/.test(html), "折叠态文字块必须 sr-only（读屏仍可读）");
});

check("Sidebar：主导航带 aria-label 与折叠态可读名称", async () => {
  const { Sidebar } = await load("/src/components/layout/sidebar.tsx");
  const html = render(createElement(Sidebar, { collapsed: true }));
  expect(html.includes('aria-label="主导航"'), "导航必须有 aria-label=主导航");
  expect(/title="[^"]+"/.test(html), "折叠态导航项必须有 title 兜底");
  expect(html.includes("w-18") || html.includes("--width-sidebar-collapsed"), "折叠态宽度必须是 72px 档");
  const expanded = render(createElement(Sidebar, { collapsed: false }));
  expect(expanded.includes("w-sidebar"), "展开态宽度必须走 w-sidebar（248px）");
});

check("Button：默认变体是 primary（不是 secondary）", async () => {
  const { Button } = await load("/src/components/ui/button.tsx");
  const html = render(createElement(Button, null, "保存"));
  expect(html.includes("bg-primary"), "默认按钮必须是主色底");
  expect(html.includes("text-primary-on"), "主按钮前景必须是 primary-on");
  expect(!html.includes("bg-surface-2"), "默认按钮不得退化为 secondary 底");
});

check("Button：控件高度阶梯 28/32/36/40/44", async () => {
  const { Button } = await load("/src/components/ui/button.tsx");
  const heightOf = (size) => render(createElement(Button, { size }, "x"));
  expect(heightOf("dense").includes("h-7"), "dense 必须是 28（h-7）");
  expect(heightOf("sm").includes("h-8"), "sm 必须是 32（h-8）");
  expect(heightOf("md").includes("h-9"), "md 必须是 36（h-9）");
  expect(heightOf("default").includes("h-10"), "default 必须是 40（h-10）");
  expect(heightOf("lg").includes("h-11"), "lg 必须是 44（h-11）");
  expect(/h-10[^"]*w-10|w-10[^"]*h-10/.test(heightOf("icon")), "icon 必须是 40×40");
});

check("Empty：图标圆底 + 标题 + 说明 + 动作", async () => {
  const { Empty } = await load("/src/components/ui/empty.tsx");
  const { Search } = await import("lucide-react");
  const html = render(
    createElement(Empty, {
      icon: Search,
      title: "没有匹配的模型",
      description: "换个关键词，或检查上游是否已启用。",
      action: createElement("button", { type: "button" }, "重新发现"),
    }),
  );
  expect(html.includes("rounded-full"), "图标必须是圆底（EmptyMedia icon）");
  expect(html.includes("bg-primary-soft"), "图标底必须是 primary-soft");
  expect(html.includes("没有匹配的模型"), "标题缺失");
  expect(html.includes("换个关键词"), "说明缺失");
  expect(html.includes("重新发现"), "动作缺失");
});

check("Empty：旧 text 调用仍渲染标题（兼容既有页面）", async () => {
  const { Empty } = await load("/src/components/ui/empty.tsx");
  const html = render(createElement(Empty, { text: "暂无数据" }));
  expect(html.includes("暂无数据"), "text 兼容属性必须仍渲染");
});

check("Card：使用 shadow-card / rounded-card token", async () => {
  const { Card, CardHeader, CardTitle, CardContent } = await load("/src/components/ui/card.tsx");
  const html = render(
    createElement(Card, null, createElement(CardHeader, null, createElement(CardTitle, null, "标题")), createElement(CardContent, null, "内容")),
  );
  expect(html.includes("shadow-card"), "Card 必须用 shadow-card token");
  expect(html.includes("rounded-card"), "Card 必须用 rounded-card token");
  expect(html.includes("bg-surface"), "Card 必须用 surface 面");
  expect(html.includes("p-6"), "Card 内边距必须是旧规范 24（p-6）");
});

// ---------- 4. 浮层与主题（源码契约：portal 内容不在 SSR 输出里） ----------
const sourceChecks = [
  ["Popover：shadow-pop + rounded-card + popover 层", "src/components/ui/popover.tsx", ["shadow-pop", "rounded-card", "z-[var(--z-popover)]"]],
  ["Dialog：shadow-pop + rounded-card + modal 层", "src/components/ui/dialog.tsx", ["shadow-pop", "rounded-card", "z-[var(--z-modal)]"]],
  ["Sheet：shadow-pop + modal 层", "src/components/ui/sheet.tsx", ["shadow-pop", "z-[var(--z-modal)]"]],
  ["DropdownMenu：shadow-pop + popover 层", "src/components/ui/dropdown-menu.tsx", ["shadow-pop", "z-[var(--z-popover)]"]],
  ["Select：shadow-pop + popover 层", "src/components/ui/select.tsx", ["shadow-pop", "z-[var(--z-popover)]"]],
  ["Tooltip：shadow-pop + popover 层", "src/components/ui/tooltip.tsx", ["shadow-pop", "z-[var(--z-popover)]"]],
];
for (const [name, file, needles] of sourceChecks) {
  check(name, () => includesAll(read(file), needles, name));
}

check("Toaster：跟随主题（useTheme）+ 统一 success/error 语义色", () => {
  const file = "src/components/ui/sonner.tsx";
  expect(existsSync(join(webRoot, file)), "缺少统一 Toaster 基元");
  const text = read(file);
  includesAll(text, ["useTheme", "theme=", "toastOptions"], "Toaster");
});

check("main.tsx：全局只挂载统一 Toaster", () => {
  const text = read("src/main.tsx");
  expect(text.includes('from "./components/ui/sonner"') || text.includes('from "@/components/ui/sonner"'), "main.tsx 必须用 ui/sonner 的 Toaster");
  expect(!/from "sonner"/.test(text), "main.tsx 不得再直接引入 sonner 的 Toaster");
});

// ---------- 5. 壳层密度 ----------
check("壳层：侧栏 248/72、顶栏 64、内容区 max-w-480 + 24/32 padding", () => {
  const shell = read("src/components/layout/app-shell.tsx");
  const sidebar = read("src/components/layout/sidebar.tsx");
  const topbar = existsSync(src("components/layout/topbar.tsx")) ? read("src/components/layout/topbar.tsx") : "";
  includesAll(sidebar, ["w-sidebar", "h-16", "px-5"], "侧栏");
  includesAll(topbar || shell, ["h-16"], "顶栏");
  includesAll(shell, ["max-w-480", "lg:px-8", "lg:py-8"], "内容区");
});

// ---------- 6. 指标卡与图标语义（ticket 22：视觉打磨 1/2） ----------
check("MetricCard：36 图标方块 + 分类 tint 底色 + 20px 数值 + 13px 标签 + 12px 说明", async () => {
  const { MetricCard } = await load("/src/components/stat-card.tsx");
  const { METRIC_ICONS } = await load("/src/lib/metric-icons.ts");
  const visual = METRIC_ICONS.requests;
  const html = render(
    createElement(MetricCard, {
      label: "请求量",
      value: "1,234",
      hint: "所选区间内用量事件",
      icon: visual.icon,
      tone: visual.tone,
    }),
  );
  expect(html.includes("h-9 w-9"), "图标方块必须是 36×36（h-9 w-9）");
  expect(html.includes("rounded-control"), "图标方块圆角必须是 rounded-control（8px）");
  // W5 ticket 10：指标图标走 ui/icon-badge 的轻盈分类 tint（--badge-*-bg/fg 浅色 wash），
  // 不再所有卡共用 primary 12% 底色；底色与前景必须来自同一分类。
  expect(html.includes("bg-[var(--badge-flow-bg)]"), "tone 底色必须是分类 tint（badge-flow）");
  expect(html.includes("text-[var(--badge-flow-fg)]"), "分类方块里的图标必须用同组前景色");
  expect(/text-metric[^"]*font-semibold/.test(html), "数值必须是 text-metric（20px）半粗");
  expect(html.includes("tnum"), "数值必须 tnum（等宽数字）");
  expect(/text-xs[^"]*text-muted-foreground/.test(html), "标签必须是 13px 中性色");
  expect(html.includes("text-2xs"), "说明必须是 12px");
  expect(html.includes("min-w-0"), "单卡必须 min-w-0，避免栅格把卡片挤爆");
  expect(html.includes("truncate"), "数值/说明必须单行截断");
  expect(html.includes("请求量") && html.includes("1,234") && html.includes("所选区间内用量事件"), "标签/数值/说明必须都渲染");
});

check("MetricCard：dense 档位更紧，trend 显示方向箭头与百分比", async () => {
  const { MetricCard } = await load("/src/components/stat-card.tsx");
  const { METRIC_ICONS } = await load("/src/lib/metric-icons.ts");
  const { Activity } = await import("lucide-react");
  const dense = render(
    createElement(MetricCard, { label: "成本", value: "¥1.0000", icon: Activity, tone: "cost", dense: true }),
  );
  const standard = render(
    createElement(MetricCard, { label: "成本", value: "¥1.0000", icon: Activity, tone: "cost" }),
  );
  expect(dense.includes("p-3") && !dense.includes("p-4"), "dense 档位内边距必须是 12（p-3）");
  expect(standard.includes("p-4"), "标准档位内边距必须是 16（p-4）");
  const up = render(createElement(MetricCard, { label: "请求量", value: "10", icon: Activity, trend: { delta: 12.5 } }));
  expect(up.includes("12.5%"), "trend 必须渲染百分比");
  expect(/text-success-text/.test(up), "正增长 trend 必须用 success 色");
  const down = render(createElement(MetricCard, { label: "请求量", value: "10", icon: Activity, trend: { delta: -3.2 } }));
  expect(down.includes("3.2%"), "下降 trend 也必须渲染百分比（不带负号，方向由箭头表达）");
  expect(/text-danger-text/.test(down), "下降 trend 必须用 danger 色");
});

check("MetricCard：加载骨架、失败重试与 StatCard 向后兼容导出", async () => {
  const { MetricCard, StatCard } = await load("/src/components/stat-card.tsx");
  const { Activity } = await import("lucide-react");
  const failed = render(createElement(MetricCard, { label: "成本", value: undefined, icon: Activity, error: "boom", onRetry: () => {} }));
  expect(failed.includes("加载失败") && failed.includes("重试"), "失败态必须有「加载失败 + 重试」");
  const legacy = render(createElement(StatCard, { label: "用户数", value: "12", hint: "API 消费者" }));
  expect(legacy.includes("用户数") && legacy.includes("12") && legacy.includes("API 消费者"), "StatCard 旧调用（label/value/hint）必须仍可用");
  const legacyTone = render(createElement(StatCard, { label: "余额合计", value: "¥1.0000", tone: "primary" }));
  expect(legacyTone.includes("¥1.0000"), "StatCard 旧 tone=primary 调用必须仍可用");
});

check("metric-icons：统一 icon/tone 映射覆盖指标条全部指标", () => {
  const text = read("src/lib/metric-icons.ts");
  includesAll(
    text,
    ["requests:", "tokens:", "cache:", "charge:", "cost:", "margin:", "latency:", "rpm:", "tpm:", "errors:"],
    "指标映射",
  );
  // ticket 10：缓存=Database（不再是 Zap）、P50=Gauge（不再与冷却的 Timer 冲突）、
  // 成本=CircleDollarSign（不再是泛用 Wallet）、RPM/TPM 各有独立来源。
  includesAll(
    text,
    ["Activity", "Layers", "Database", "Receipt", "CircleDollarSign", "TrendingUp", "Gauge", "Timer", "Zap", "TriangleAlert"],
    "lucide 图标",
  );
  // 指标分类色来自 ui/icon-badge 的轻盈 badge 色板，不再借用状态语义色（info/primary/success/warning）。
  includesAll(text, ['tone: "flow"', 'tone: "token"', 'tone: "cache"', 'tone: "cost"', 'tone: "latency"', 'tone: "brand"'], "分类色");
  for (const legacyTone of ['tone: "info"', 'tone: "primary"', 'tone: "success"', 'tone: "warning"']) {
    expect(!text.includes(legacyTone), "指标图标不得再用状态语义色 " + legacyTone);
  }
});

check("指标条：grid gap-3 + 2/3/4/6 列响应式（xl 起六列，八卡 6+2 两行）", () => {
  includesAll(
    read("src/components/dashboard/metric-cards.tsx"),
    ["grid-cols-2", "gap-3", "sm:grid-cols-3", "lg:grid-cols-4", "xl:grid-cols-6"],
    "八卡指标条",
  );
  // W4-I：billing 的 cost/unpriced/my-spend 面板是零引用孤儿，已删除；
  // 指标条契约仍在 dashboard 与 quick-start 两处生效。
  includesAll(read("src/pages/quick-start.tsx"), ["grid-cols-2", "gap-3"], "quick-start 指标条");
});

check("页面接线：upstream_detail 用 MetricCard + 统一图标映射", () => {
  includesAll(read("src/pages/upstream_detail.tsx"), ["MetricCard", "@/lib/metric-icons"], "upstream_detail 接线");
});

check("术语：UI 文案统一「词元 / 花费」（src 下无 Tokens、无「收费」）", () => {
  const bad = [];
  for (const file of sourceFiles()) {
    const text = readFileSync(file, "utf8");
    if (/(^|[^A-Za-z_])Tokens/.test(text)) bad.push(rel(file) + "：Tokens");
    if (text.includes("收费")) bad.push(rel(file) + "：收费");
    if (/[\u4e00-\u9fa5]\s*tokens/.test(text)) bad.push(rel(file) + "：中文串里的 tokens");
  }
  expect(bad.length === 0, "仍有旧术语：\n       " + bad.join("\n       "));
});

// ---------- 4. 表格列元数据与操作列冻结（W5 ticket 06 / DESIGN-AUDIT 四期 §2） ----------
/** 走 DataTable/ModelsTable/PriceTable 且带行操作的文件：操作列必须声明 sticky:"right"（最后一列 + 尾部冻结）。 */
const ACTION_COLUMN_FILES = [
  "src/pages/upstreams.tsx",
  "src/pages/client_keys.tsx",
  "src/pages/audits.tsx",
  "src/pages/config_revisions.tsx",
  "src/pages/logs.tsx",
  "src/pages/roles.tsx",
  "src/components/users/users-panel.tsx",
  "src/components/upstreams/models-panel.tsx",
  "src/pages/models.tsx",
  "src/components/pricing/upstream-prices.tsx",
  "src/components/pricing/cache-prices.tsx",
];
/** 不走三套表格组件的裸表但带行操作：必须复用共享冻结列类（窄屏横向滚动时同样冻结）。 */
const RAW_ACTION_TABLE_FILES = [
  "src/components/upstreams/keys-panel.tsx",
  "src/components/governance/gateway-policies/mcp-tab.tsx",
];

check("表格列元数据：DataTable 的 align/sticky 头身同用，冻结列在最后一列", async () => {
  const { DataTable } = await load("/src/components/data-table.tsx");
  const columns = [
    { accessorKey: "name", header: "名称", meta: { align: "right" } },
    { id: "actions", header: "操作", meta: { sticky: "right", hideable: false }, cell: () => "编辑" },
  ];
  const html = render(
    createElement(DataTable, { columns, data: [{ name: "alpha" }], emptyText: "暂无数据" }),
  );
  expect(/<th[^>]*class="[^"]*text-right/.test(html), "表头必须应用 align=right（头身同用）");
  expect(/<td[^>]*class="[^"]*text-right/.test(html), "表体必须应用 align=right（头身同用）");
  expect(/<th[^>]*class="[^"]*sticky right-0/.test(html), "表头冻结列必须有 sticky right-0");
  expect(/<td[^>]*class="[^"]*sticky right-0/.test(html), "表体冻结列必须有 sticky right-0");
  expect(/<th[^>]*class="[^"]*bg-surface-2/.test(html), "冻结列表头底色必须跟随表头行（bg-surface-2）");
  expect(/<td[^>]*class="[^"]*bg-surface/.test(html), "冻结列单元格必须是不透明底色（bg-surface）");
  expect(html.includes("shadow-[inset_1px_0_0_var(--border)]"), "冻结列必须有左侧分割阴影");
  expect(/<th[^>]*class="[^"]*align-middle/.test(html), "表头必须垂直居中（align-middle）");
  expect(/<td[^>]*class="[^"]*align-middle/.test(html), "表体必须垂直居中（align-middle）");
  expect(html.indexOf("操作") > html.indexOf("名称"), "操作列必须是最后一列");
});

check("表格列元数据：ModelsTable 的 align/sticky 头身同用，冻结列在最后一列", async () => {
  const { ModelsTable } = await load("/src/components/models/table.tsx");
  const columns = [
    { key: "name", label: "名称", className: "text-right", cell: () => "alpha" },
    { key: "actions", label: "操作", hideable: false, align: "right", sticky: "right", cell: () => "编辑" },
  ];
  const html = render(
    createElement(ModelsTable, {
      columns,
      rows: [{ id: "a" }],
      totalCount: 1,
      storageKey: "slipstream.test",
      tabKey: "t",
      searchText: "",
      onSearchChange: () => {},
      searchPlaceholder: "搜索",
      emptyText: "暂无数据",
      onClearFilters: () => {},
    }),
  );
  expect(/<th[^>]*class="[^"]*sticky right-0/.test(html), "表头冻结列必须有 sticky right-0");
  expect(/<td[^>]*class="[^"]*sticky right-0/.test(html), "表体冻结列必须有 sticky right-0");
  expect(/<th[^>]*class="[^"]*text-right/.test(html), "表头必须应用 align=right（头身同用）");
  expect(/<td[^>]*class="[^"]*text-right/.test(html), "表体必须应用 align=right（头身同用）");
  expect(/<td[^>]*class="[^"]*bg-surface/.test(html), "冻结列单元格必须是不透明底色（bg-surface）");
  expect(/<th[^>]*class="[^"]*align-middle/.test(html), "表头必须垂直居中（align-middle）");
  expect(/<td[^>]*class="[^"]*align-middle/.test(html), "表体必须垂直居中（align-middle）");
  expect(/<td[^>]*class="[^"]*h-8/.test(html), "模型表紧凑行高必须与表头同档（h-8）");
  expect(html.indexOf("操作") > html.indexOf("名称"), "操作列必须是最后一列");
});

check("表格列元数据：PriceTable 的 align/sticky 头身同用，冻结列在最后一列", async () => {
  const { PriceTable } = await load("/src/components/pricing/table.tsx");
  const columns = [
    { key: "name", label: "名称", cell: () => "alpha" },
    { key: "actions", label: "操作", hideable: false, align: "right", sticky: "right", cell: () => "编辑" },
  ];
  const html = render(
    createElement(PriceTable, {
      columns,
      rows: [{ id: "a" }],
      totalCount: 1,
      sectionKey: "t",
      searchText: "",
      onSearchChange: () => {},
      searchPlaceholder: "搜索",
      emptyText: "暂无数据",
      onClearFilters: () => {},
      rowKey: (row) => row.id,
    }),
  );
  expect(/<th[^>]*class="[^"]*sticky right-0/.test(html), "表头冻结列必须有 sticky right-0");
  expect(/<td[^>]*class="[^"]*sticky right-0/.test(html), "表体冻结列必须有 sticky right-0");
  expect(/<th[^>]*class="[^"]*text-right/.test(html), "表头必须应用 align=right（头身同用）");
  expect(/<td[^>]*class="[^"]*text-right/.test(html), "表体必须应用 align=right（头身同用）");
  expect(/<td[^>]*class="[^"]*align-middle/.test(html), "表体必须垂直居中（align-middle）");
  expect(/<td[^>]*class="[^"]*h-8/.test(html), "价目表紧凑行高必须与表头同档（h-8）");
  expect(html.indexOf("操作") > html.indexOf("名称"), "操作列必须是最后一列");
});

check("表格列元数据：三套表格共用 lib/table-columns 的 align/sticky 契约", () => {
  includesAll(
    read("src/lib/table-columns.ts"),
    [
      "TableColumnAlign",
      "TableColumnSticky",
      "align?:",
      "sticky?:",
      "FROZEN_COLUMN_CELL_CLASS",
      "FROZEN_COLUMN_HEADER_CLASS",
      "--row-hover",
    ],
    "共享列元数据",
  );
  for (const file of [
    "src/components/data-table.tsx",
    "src/components/models/table.tsx",
    "src/components/pricing/table.tsx",
  ]) {
    expect(
      /from "@\/lib\/table-columns"/.test(read(file)),
      file + " 必须复用 @/lib/table-columns 的列元数据",
    );
  }
});

check("表格操作列：全站带行操作的表都声明 sticky:\"right\"，裸表复用冻结列类", () => {
  const problems = [];
  for (const file of ACTION_COLUMN_FILES) {
    const text = read(file);
    const actions = (text.match(/(?:id|key): "actions"/g) ?? []).length;
    const sticky = (text.match(/sticky: "right"/g) ?? []).length;
    if (actions === 0) problems.push(file + "：未找到 id/key: actions 列");
    else if (sticky < actions) problems.push(file + "：操作列缺少 sticky: \"right\"（" + actions + " 列 / " + sticky + " 声明）");
  }
  for (const file of RAW_ACTION_TABLE_FILES) {
    const text = read(file);
    if (!text.includes('from "@/lib/table-columns"')) problems.push(file + "：未复用共享冻结列类");
    if (!text.includes("FROZEN_COLUMN_HEADER_CLASS")) problems.push(file + "：表头未使用 FROZEN_COLUMN_HEADER_CLASS");
    if (!text.includes("FROZEN_COLUMN_CELL_CLASS")) problems.push(file + "：单元格未使用 FROZEN_COLUMN_CELL_CLASS");
  }
  expect(problems.length === 0, "操作列冻结不完整：\n       " + problems.join("\n       "));
});

check("表格行节奏：表头/正文同高且垂直居中，行悬浮色与冻结列同步", async () => {
  const { TH, TD, TR } = await load("/src/components/ui/table.tsx");
  const th = render(createElement(TH, null, "列头"));
  const td = render(createElement(TD, null, "值"));
  const tr = render(createElement(TR, null, createElement(TD, null, "行")));
  expect(/<th[^>]*class="[^"]*h-9/.test(th), "表头行高必须与正文同档（h-9）");
  expect(/<th[^>]*class="[^"]*align-middle/.test(th), "表头必须垂直居中");
  expect(/<td[^>]*class="[^"]*h-9/.test(td), "正文行高必须 h-9（与表头同档）");
  expect(/<td[^>]*class="[^"]*align-middle/.test(td), "正文必须垂直居中");
  expect(/class="[^"]*group/.test(tr) && /--row-hover/.test(tr), "表体行必须提供 group + --row-hover，供冻结列同步悬浮底色");
  const css = read("src/index.css");
  includesAll(css, ["--row-hover:", "--z-sticky-column:", "--z-sticky-head:"], "表格冻结列 token");
  expect((css.match(/--row-hover:/g) ?? []).length >= 2, "行悬浮色必须浅/深各一套");
});

// ---------- 7. 数字与格式化单一来源（ticket 08） ----------
// 本仓前端没有测试运行器：数字口径的边界值在这里用 vite SSR 加载真实模块断言，
// 「不得再出现本地 formatter」用源码扫描兜住，避免口径再次分裂。
const NUM_FORMATTER_NAMES = [
  "fmtInt", "fmtCount", "fmtRpm", "fmtPct", "fmtPctPoint", "fmtMoney", "fmtMoneyAvg",
  "fmtMoney6", "fmtFixed", "formatCount", "fmtCny", "fmtYuan", "fmtMicroYuan",
  "fmtPrice", "fmtPricePerM", "fmtPriceAmount", "fmtUnitPriceMicro", "fmtThroughput",
  "fmtCachePct", "fmtSignedMicro", "compactMoney", "formatDuration", "fmtSeconds",
  "formatSize", "fmtFileSize",
];

check("数字格式：整数一律千分位、四舍五入到整数（计数/词元/TPM/尝试次数）", async () => {
  const fmt = await load("/src/lib/format.ts");
  expect(fmt.fmtInt(0) === "0", "fmtInt(0) 应为 0");
  expect(fmt.fmtInt(565920) === "565,920", "fmtInt(565920) 应为 565,920（不得出现 565.92K 紧凑格式）");
  expect(fmt.fmtInt(1234567) === "1,234,567", "fmtInt(1234567) 应为千分位整数");
  expect(fmt.fmtInt(565920.4) === "565,920", "fmtInt 必须先取整再千分位");
  expect(fmt.fmtInt(-1234.6) === "-1,235", "fmtInt 负数也要千分位且四舍五入");
  expect(fmt.fmtInt(null) === "—" && fmt.fmtInt(Number.NaN) === "—", "fmtInt 缺值/非有限值应显示「—」");
  expect(fmt.formatCount === undefined, "formatCount 旧别名必须删除（统一用 fmtInt）");
});

check("数字格式：图表轴紧凑计数只保留整数（无 K/M/B 小数）", async () => {
  const fmt = await load("/src/lib/format.ts");
  expect(fmt.fmtCount(999) === "999", "千位以内仍用千分位整数");
  expect(fmt.fmtCount(565920) === "566K", "565920 应四舍五入为 566K，不得有小数");
  expect(fmt.fmtCount(1_500_000) === "2M", "1.5M 应取整为 2M");
  expect(fmt.fmtCount(999_999) === "1M", "进位到 1000K 时必须升到 M");
  expect(fmt.fmtCount(Number.NaN) === "—", "fmtCount 非有限值应显示「—」");
});

check("数字格式：RPM 两位小数、百分比一位小数", async () => {
  const fmt = await load("/src/lib/format.ts");
  expect(fmt.fmtRpm(2572.014583) === "2,572.01", "RPM 必须固定两位小数（整数部分千分位）");
  expect(fmt.fmtRpm(0) === "0.00", "RPM 0 也要两位小数");
  expect(fmt.fmtRpm(null) === "—", "RPM 缺值显示「—」");
  expect(fmt.fmtPct(0.4148) === "41.5%", "比例（0–1）必须一位小数百分比");
  expect(fmt.fmtPct(0) === "0.0%" && fmt.fmtPct(1) === "100.0%", "百分比边界值固定一位小数");
  expect(fmt.fmtPct(null) === "—", "百分比缺值显示「—」");
  expect(fmt.fmtPctPoint(41.48) === "41.5%", "已是百分数的值（如 cache_ratio）直接一位小数");
});

check("数字格式：金额表格两位、单请求均值四位、取消六位小数", async () => {
  const fmt = await load("/src/lib/format.ts");
  expect(fmt.fmtMoney(2_000_000, "CNY") === "¥2.00", "金额默认两位小数");
  expect(fmt.fmtMoney(-1_500_000, "CNY") === "-¥1.50", "负数符号必须在货币符号之前");
  expect(fmt.fmtMoney(1_500_000, "USD") === "$1.50", "币种符号按 currency 选择");
  expect(fmt.fmtMoney(null) === "—", "金额缺值显示「—」，不渲染 0");
  expect(fmt.fmtMoneyAvg(3_400, "CNY") === "¥0.0034", "单请求金额/均值必须四位小数");
  expect(fmt.fmtMoneyAvg(1_234_567) === "¥1.2346", "单请求金额四位小数四舍五入");
  expect(fmt.fmtMoney6 === undefined && fmt.fmtYuan === undefined && fmt.fmtMicroYuan === undefined, "6 位小数与旧别名必须删除");
  expect(fmt.fmtCny(2_000_000) === "¥2.00", "fmtCny 仍走两位小数");
});

check("数字格式：单价 2 位、不足 0.01 升 4 位；单价统一从 lib/format 出", async () => {
  const fmt = await load("/src/lib/format.ts");
  expect(fmt.fmtPricePerM("2") === "¥2.00/M", "模型行进价两位小数 + /M");
  expect(fmt.fmtPricePerM("0.005") === "¥0.0050/M", "不足 0.01 的单价必须升到 4 位");
  expect(fmt.fmtPricePerM(null) === "—", "未配置单价显示「—」");
  expect(fmt.fmtPriceAmount("2", "USD") === "$2.00", "公开模型售价按币种两位小数");
  expect(fmt.fmtUnitPriceMicro(2_000_000, "CNY") === "¥2.00", "微单位单价按两位小数展示");
  expect(fmt.fmtUnitPriceMicro(5_000, "CNY") === "¥0.0050", "微单位小单价升到四位");
});

check("数字格式：吞吐与文件大小格式化也收敛到 lib/format", async () => {
  const fmt = await load("/src/lib/format.ts");
  expect(fmt.fmtThroughput(42.34) === "42.3", "吞吐 <100 保留一位小数");
  expect(fmt.fmtThroughput(1234.5) === "1,235", "吞吐 >=100 取整并千分位（不得用 toLocaleString 自拼）");
  expect(fmt.fmtThroughput(0) === "—", "无吞吐显示「—」");
  expect(fmt.fmtFileSize(800) === "800 B", "文件大小 B 档");
  expect(fmt.fmtFileSize(1536) === "1.5 KB", "文件大小 KB 档一位小数");
  expect(fmt.fmtFileSize(2 * 1024 * 1024) === "2.0 MB", "文件大小 MB 档一位小数");
});

check("数字格式：组件/页面不得重复实现数字 formatter（lib/format 单一来源）", () => {
  const offenders = [];
  for (const file of sourceFiles()) {
    if (rel(file) === "src/lib/format.ts") continue;
    const text = readFileSync(file, "utf8");
    for (const name of NUM_FORMATTER_NAMES) {
      if (new RegExp("function\\s+" + name + "\\s*\\(").test(text)) offenders.push(rel(file) + "：" + name);
    }
  }
  expect(offenders.length === 0, "仍有本地数字 formatter：\n       " + offenders.join("\n       "));
});

check("数字格式：不得用 toLocaleString 自拼千分位（统一走 fmtInt）", () => {
  const bad = [];
  for (const file of sourceFiles()) {
    if (rel(file) === "src/lib/format.ts") continue;
    if (/\.toLocaleString\(\s*(?:"en-US")?\s*\)/.test(readFileSync(file, "utf8"))) bad.push(rel(file));
  }
  expect(bad.length === 0, "以下文件绕过 fmtInt 自拼千分位：\n       " + bad.join("\n       "));
});

check("数字格式：K/M/B 紧凑计数只允许图表轴使用（trend-panel）", () => {
  const allowed = new Set(["src/lib/format.ts", "src/components/dashboard/trend-panel.tsx"]);
  const bad = [];
  for (const file of sourceFiles()) {
    const path = rel(file);
    if (allowed.has(path)) continue;
    if (/\bfmtCount\b/.test(readFileSync(file, "utf8"))) bad.push(path);
  }
  expect(bad.length === 0, "K/M/B 紧凑格式只留给图表轴，其余应为 fmtInt：" + bad.join("、"));
});

check("数字格式：图表与价目模块只做 re-export/换算，不再包 formatter", () => {
  const chart = read("src/components/dashboard/chart-format.ts");
  expect(!/function\s+(?:fmt|format)/.test(chart), "chart-format 不得再定义 formatter，只能从 lib/format re-export");
  expect(chart.includes('from "@/lib/format"'), "chart-format 必须从 lib/format 转发");
  const money = read("src/components/pricing/money.ts");
  expect(!/function\s+fmt/.test(money), "pricing/money 只保留 micro 换算，展示函数统一在 lib/format");
  const logsFormat = read("src/components/logs/format.ts");
  expect(!/function\s+fmtThroughput|function\s+fmtCachePct/.test(logsFormat), "吞吐/缓存比例 formatter 必须上收 lib/format");
});

check("看板 KPI：计数/TPM 千分位整数、RPM 两位、百分比一位（不再用 K/M/B）", () => {
  const text = read("src/components/dashboard/metric-cards.tsx");
  includesAll(
    text,
    ["fmtInt(requests)", "fmtInt(errorCount)", "fmtInt(totalTokens)", "fmtInt(tpm)", "fmtRpm(rpm)", "fmtRpm(peakRpm)", "fmtInt(peakTpm)", "fmtPct(cacheFraction)", "fmtPct(marginRate)"],
    "看板 KPI 数字口径",
  );
  expect(!/\bfmtCount\(/.test(text), "KPI 不得再使用 K/M/B 紧凑计数");
});

check("看板 KPI 渲染：大数走千分位整数，RPM 两位、百分比一位", async () => {
  const { DashboardKpis } = await load("/src/components/dashboard/metric-cards.tsx");
  const data = {
    currency: "CNY",
    totals: {
      requests: 1_234_567,
      error_count: 12,
      input_tokens: 400_000,
      cache_read_tokens: 150_000,
      cache_write_tokens: 15_920,
      output_tokens: 0,
      tokens: 565_920,
      active_minutes: 480,
      peak_rpm: 123.456,
      peak_tpm: 4567.89,
    },
  };
  const latency = { total: { p50_ms: 234.5, p95_ms: 890 }, paired_samples: 120, min_samples: 5 };
  const html = render(createElement(DashboardKpis, { data, latency, loading: false, error: null, onRetry: () => {} }));
  expect(html.includes("565,920"), "词元必须千分位整数（不得 565.92K）");
  expect(html.includes("1,234,567"), "请求量必须千分位整数");
  expect(html.includes("2,572.01"), "RPM 必须两位小数");
  expect(html.includes("123.46"), "最高峰 RPM 必须两位小数");
  expect(html.includes("1,179"), "TPM 必须千分位整数");
  expect(html.includes("41.5%"), "缓存命中率必须一位小数百分比");
  expect(!/[0-9]+\.[0-9]+[KMB]/.test(html), "KPI 不得出现带小数的 K/M/B 紧凑格式");
});

check("看板 KPI 图标：八卡八形 + 分类 tint 双重编码（缓存/P50 不用 info、不再四卡共用 primary）", async () => {
  const { DashboardKpis } = await load("/src/components/dashboard/metric-cards.tsx");
  const { METRIC_ICONS } = await load("/src/lib/metric-icons.ts");
  const data = {
    currency: "CNY",
    totals: {
      requests: 1_234_567,
      error_count: 12,
      input_tokens: 400_000,
      cache_read_tokens: 150_000,
      cache_write_tokens: 15_920,
      output_tokens: 0,
      tokens: 565_920,
      active_minutes: 480,
      peak_rpm: 123.456,
      peak_tpm: 4567.89,
      charge_micro: 12_345_678,
      cost_micro: 8_765_432,
    },
  };
  const latency = { total: { p50_ms: 234.5, p95_ms: 890 }, paired_samples: 120, min_samples: 5 };
  // 费用 / 成本·毛利率 卡受权限控制；预填 /admin/auth/me 缓存让八卡全部渲染。
  const { PermissionsProvider } = await load("/src/lib/permissions.ts");
  const { AUTH_ME_QUERY_KEY } = await load("/src/lib/auth.ts");
  queryClient.setQueryData(AUTH_ME_QUERY_KEY, {
    id: "u-1",
    username: "admin",
    name: "管理员",
    role: "admin",
    status: "active",
    permissions: ["billing:spend", "billing:cost"],
  });
  const html = render(
    createElement(
      PermissionsProvider,
      null,
      createElement(DashboardKpis, { data, latency, loading: false, error: null, onRetry: () => {} }),
    ),
  );

  // ① 文字 + 图标形状双编码：八张卡的标签文字都在，图标形状八卡八形、各自对应指标语义。
  const labels = ["请求量", "词元", "缓存", "费用", "成本 · 毛利率", "P50 延迟", "RPM 请求/分", "TPM 词元/分"];
  for (const label of labels) expect(html.includes(label), "缺少 KPI 卡片：" + label);
  // 只取每个 svg 的第一个图标类名：lucide 还会把别名（如 layers-3）追加进 class，别把别名当图形。
  const icons = [...html.matchAll(/class="lucide lucide-([a-z0-9-]+)/g)].map((match) => match[1]);
  const uniqueIcons = [...new Set(icons)];
  expect(uniqueIcons.length === 8, "八卡图标形状必须互不相同，实际：" + uniqueIcons.join("、"));
  includesAll(
    uniqueIcons.join("、"),
    ["activity", "layers", "database", "receipt", "circle-dollar-sign", "gauge", "timer", "zap"],
    "KPI 图标语义",
  );
  expect(!uniqueIcons.includes("wallet"), "成本不再用泛用的 Wallet 图标");
  expect(html.includes("h-4 w-4"), "指标图标必须 16px（h-4 w-4）");

  // ② 配色：轻盈分类 tint，至少 6 种可区分色；缓存紫、P50 绿，都不再是 info 蓝灰。
  const badgeTones = [...html.matchAll(/bg-\[var\(--badge-([a-z]+)-bg\)\]/g)].map((match) => match[1]);
  // brand 分类走 primary 15% 浅底（ui/icon-badge 既有定义），其余分类走 badge 色板。
  const brandCount = (html.match(/bg-primary\/15/g) || []).length;
  expect(badgeTones.length + brandCount === 8, "八卡图标底色必须全部走分类 tint（badge 色板 + brand）");
  const uniqueTones = [...new Set(badgeTones)];
  const distinctTints = uniqueTones.length + (brandCount > 0 ? 1 : 0);
  expect(distinctTints >= 6, "分类 tint 至少 6 种可区分色，实际：" + uniqueTones.join("、") + (brandCount > 0 ? "、brand" : ""));
  expect(uniqueTones.includes("cache"), "缓存必须用 cache 分类色（紫），不得再是 info 灰");
  expect(uniqueTones.includes("latency"), "P50 延迟必须用 latency 分类色（绿），不得再是 info 灰");
  expect(!badgeTones.includes("info"), "KPI 图标不得再用 info 灰");
  expect(brandCount <= 1, "最多一张卡用 primary/brand，不能再四张卡共用 primary");

  // ③ 成本/毛利率/费用三个金钱语义图标互相区分。
  expect(METRIC_ICONS.cost.icon !== METRIC_ICONS.margin.icon, "成本与毛利率图标必须区分");
  expect(METRIC_ICONS.cost.icon !== METRIC_ICONS.charge.icon, "成本与费用图标必须区分");
  expect(METRIC_ICONS.latency.icon !== METRIC_ICONS.rpm.icon, "P50 与 RPM 图标必须区分");
});

check("日志：费用列两行（金额 + 明细），金额两位、毛利一位", () => {
  const text = read("src/pages/logs.tsx");
  includesAll(text, ["fmtMoney(item.charge_micro", "fmtMoney(item.cost_micro", "利 ", "fmtPct(marginPct)"], "日志费用列");
  expect(!text.includes("fmtMoney6"), "日志费用列不得再用 6 位小数");
  const detail = read("src/components/logs/log-detail-drawer.tsx");
  expect(detail.includes("fmtMoneyAvg("), "单请求金额必须四位小数（fmtMoneyAvg）");
  expect(!detail.includes("fmtMoney6"), "日志详情不得再用 6 位小数");
});

// ---------- 日志：请求尝试路由链（ticket 04） ----------
const ATTEMPT_LONG_ERROR = "upstream connection reset by peer while reading the response stream";

check("日志路由链：每行上游/模型/状态/耗时/错误摘要，展开可看上游地址与错误全文", async () => {
  const { RequestAttemptChain } = await load("/src/components/logs/request-attempt-chain.tsx");
  const html = render(
    createElement(RequestAttemptChain, {
      attempts: [
        {
          attempt: 1,
          upstream_ref: "ups_zai",
          upstream_name: "zai-01",
          model: "glm-5.3",
          status_code: 500,
          error_type: "500",
          error_message: ATTEMPT_LONG_ERROR,
          duration_ms: 60,
          outcome: "error",
          started_at_ms: 1_800_000_000_012,
        },
        {
          attempt: 2,
          upstream_ref: "ups_or",
          upstream_name: "or-01",
          model: "glm-5.3",
          status_code: 200,
          error_type: "",
          error_message: "",
          duration_ms: 85,
          outcome: "ok",
          started_at_ms: 1_800_000_000_085,
        },
      ],
      totalDurationMs: 145,
    }),
  );
  includesAll(
    html,
    [
      "路由链 · 2 次尝试",
      "总耗时",
      "0.15s",
      "第 1 轮",
      "第 2 轮",
      "zai-01",
      "or-01",
      "glm-5.3",
      "0.06s",
      "0.09s",
      "upstream 500: upstream connection reset",
      "ups_zai",
      "ups_or",
      "上游地址",
      "错误全文",
      ATTEMPT_LONG_ERROR,
    ],
    "路由链行",
  );
  expect(html.includes("<details"), "每次尝试必须能展开详情行（details）");
  expect(
    !html.includes("upstream 500: " + ATTEMPT_LONG_ERROR),
    "折叠行的错误摘要必须截断，不能整段铺开",
  );
});

check("日志路由链：无 attempts 显示「无链路记录」，不伪造链路", async () => {
  const { RequestAttemptChain } = await load("/src/components/logs/request-attempt-chain.tsx");
  const html = render(createElement(RequestAttemptChain, { attempts: [] }));
  expect(html.includes("无链路记录"), "无 attempts 必须显示「无链路记录」");
  expect(!html.includes("次尝试"), "无 attempts 不得渲染尝试轮数或伪造链路");
  expect(!html.includes("<details"), "无 attempts 不得渲染尝试详情");
});

check("日志页：模型旁「N 次尝试」按钮打开 popover（ticket 04 接线）", async () => {
  const { RequestAttemptChainPopover } = await load("/src/components/logs/request-attempt-chain.tsx");
  const trigger = render(
    createElement(RequestAttemptChainPopover, {
      eventId: "mev_1005",
      attemptsCount: 3,
      totalDurationMs: 180,
    }),
  );
  includesAll(trigger, ["3 次尝试", "查看 3 次尝试的路由链"], "尝试按钮");
  const page = read("src/pages/logs.tsx");
  includesAll(
    page,
    ["RequestAttemptChainPopover", 'id: "attempts"', "无链路记录", "has_attempts"],
    "日志页尝试列接线",
  );
  const drawer = read("src/components/logs/log-detail-drawer.tsx");
  includesAll(
    drawer,
    ["request-attempt-chain", "RequestAttemptChain", "NoChainRecord", "use-log-attempts"],
    "详情抽屉复用路由链组件",
  );
  expect(
    !drawer.includes('queryKey: ["log-attempts"'),
    "抽屉不得自己再拉一份路由链数据，必须复用共享 hook",
  );
  expect(!drawer.includes("attemptDotClass"), "抽屉不得再维护第二套尝试行渲染");
});

check("mock：多尝试失败行与行级错误摘要可用于演示路由链", async () => {
  const { mockRequest } = await load("/src/lib/mock.ts");
  const page = await mockRequest("/admin/logs?page_size=200", { method: "GET" });
  const withChain = page.items.find((item) => item.has_attempts && item.http_status >= 400);
  expect(Boolean(withChain), "mock 必须有一行上游失败但带 attempts 的日志");
  expect(withChain.attempts_count > 0, "失败行的 attempts_count 必须 > 0");
  const chain = await mockRequest("/admin/logs/" + withChain.event_id + "/attempts", {
    method: "GET",
  });
  expect(chain.attempts.length === withChain.attempts_count, "mock 尝试链长度必须与 attempts_count 一致");
  const lastFailed = [...chain.attempts].reverse().find((attempt) => attempt.status_code >= 400);
  expect(Boolean(lastFailed), "mock 尝试链必须包含失败尝试");
  expect(
    withChain.error.startsWith("upstream " + lastFailed.status_code),
    "失败行的行级错误摘要必须与最后一次失败尝试一致，实际：" + withChain.error,
  );
  const noChain = page.items.find((item) => !item.has_attempts);
  expect(Boolean(noChain), "mock 必须保留无 attempts 的历史行（显示无链路记录）");
  expect(noChain.attempts_count === 0, "无 attempts 行的 attempts_count 必须是 0");
});

check("金额：全站组件不再出现 6 位小数格式化", () => {
  const bad = [];
  for (const file of sourceFiles()) {
    const path = rel(file);
    if (!path.startsWith("src/components/") && !path.startsWith("src/pages/")) continue;
    const text = readFileSync(file, "utf8");
    if (text.includes("fmtMoney6") || /\.toFixed\(6\)/.test(text)) bad.push(path);
  }
  expect(bad.length === 0, "仍在使用 6 位小数：" + bad.join("、"));
});

check("设计审计 §5：数字口径更新为千分位整数 / RPM 2 位 / 百分比 1 位 / 金额 2 位、单请求 4 位", () => {
  const text = read("../docs/DESIGN-AUDIT.md");
  includesAll(text, ["千分位整数", "RPM", "2 位小数", "1 位小数", "单请求", "图表轴"], "DESIGN-AUDIT §5");
  expect(!/6 位小数/.test(text), "DESIGN-AUDIT 不得再保留金额 6 位小数的旧规则");
});

check("术语表 §5：RPM 2 位、TPM 整数、缓存命中率 1 位", () => {
  const text = read("../docs/GLOSSARY.md");
  includesAll(text, ["RPM", "TPM", "千分位整数", "1 位小数"], "GLOSSARY §5 数字口径");
});

// ---------- run ----------
const failures = [];
server = await createServer({
  configFile: join(webRoot, "vite.config.ts"),
  root: webRoot,
  logLevel: "silent",
  server: { middlewareMode: true },
  appType: "custom",
});

try {
  for (const { name, fn } of checks) {
    try {
      await fn();
      console.log("ok   - " + name);
    } catch (error) {
      failures.push({ name, message: error?.message ?? String(error) });
      console.log("FAIL - " + name + "\n       " + (error?.message ?? error));
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
