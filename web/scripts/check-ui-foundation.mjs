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
check("index.html：页签标题为「驭流 Slipstream · 模型接口网关」", () => {
  const html = read("index.html");
  expect(/<title>驭流 Slipstream · 模型接口网关<\/title>/.test(html), "title 未改回驭流品牌全称（含新对外名）");
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

check("指标条：grid gap-3 + 2/3/4 列响应式（lg 起四列，八卡 4+4 两行）", () => {
  includesAll(
    read("src/components/dashboard/metric-cards.tsx"),
    ["grid-cols-2", "gap-3", "sm:grid-cols-3", "lg:grid-cols-4"],
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
  expect(
    /<td[^>]*class="[^"]*bg-\[var\(--row-bg,var\(--surface\)\)\]/.test(html),
    "冻结列单元格必须是不透明底色（行背景变量 --row-bg，默认回落 --surface）",
  );
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
  expect(
    /<td[^>]*class="[^"]*bg-\[var\(--row-bg,var\(--surface\)\)\]/.test(html),
    "冻结列单元格必须是不透明底色（行背景变量 --row-bg，默认回落 --surface）",
  );
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

// ---------- 4.5 表格规范（W6 ticket 10） ----------
check("DataTable：无自定义 cell 时回退渲染 accessor 默认值（修配置版本操作人整列空白）", async () => {
  const { DataTable } = await load("/src/components/data-table.tsx");
  const columns = [
    { accessorKey: "operator", header: "操作人" },
    { accessorKey: "count", header: "计数" },
  ];
  const html = render(
    createElement(DataTable, {
      columns,
      data: [{ operator: "admin", count: 3 }],
      emptyText: "暂无数据",
    }),
  );
  expect(/<td[^>]*>admin<\/td>/.test(html), "无自定义 cell 的列必须回退渲染 accessorKey 取到的字符串值");
  expect(/<td[^>]*>3<\/td>/.test(html), "数字默认值也要渲染（0 等假值不得被丢掉）");
});

check("配置版本：版本列左对齐且表头与内容一致（不再整列右对齐）", () => {
  const text = read("src/pages/config_revisions.tsx");
  const column = text.slice(text.indexOf('accessorKey: "id"'), text.indexOf("operator", text.indexOf('accessorKey: "id"')));
  expect(column.length > 0 && column.includes("版本"), "未找到版本列定义");
  expect(!column.includes("text-right"), "版本列不得强制右对齐（user story 46：头身左对齐一致）");
  expect(column.includes("tnum"), "版本列保留 tnum 等宽数字");
});

check("排序指示：共享三态组件——未排序 ArrowUpDown、升序 ArrowUpNarrowWide、降序 ArrowDownNarrowWide", async () => {
  const { SortIndicator } = await load("/src/components/ui/sort-indicator.tsx");
  const unsorted = render(createElement(SortIndicator, { direction: false }));
  expect(unsorted.includes("lucide-arrow-up-down"), "未排序必须渲染 ArrowUpDown（上窄下宽之前的状态一眼可辨）");
  const asc = render(createElement(SortIndicator, { direction: "asc" }));
  expect(asc.includes("lucide-arrow-up-narrow-wide"), "升序必须渲染 ArrowUpNarrowWide（上窄下宽箭头）");
  expect(!asc.includes("lucide-arrow-up-down"), "激活态不得残留未排序图标");
  const desc = render(createElement(SortIndicator, { direction: "desc" }));
  expect(desc.includes("lucide-arrow-down-narrow-wide"), "降序必须渲染 ArrowDownNarrowWide（下窄上宽箭头）");
  expect(!desc.includes("lucide-arrow-up-narrow-wide"), "降序不得复用升序图标");
});

check("DataTable：可排序列常驻未排序图标（ArrowUpDown），禁排序列不显示，激活态带 aria-sort", async () => {
  const { DataTable } = await load("/src/components/data-table.tsx");
  const columns = [
    { accessorKey: "name", header: "名称" },
    { accessorKey: "id", header: "编号", enableSorting: false },
  ];
  const html = render(
    createElement(DataTable, { columns, data: [{ name: "a", id: "1" }], emptyText: "暂无" }),
  );
  const count = html.split("lucide-arrow-up-down").length - 1;
  expect(count === 1, "可排序列必须常驻 1 个未排序 ArrowUpDown 图标（当前 " + count + " 个）");
  const idStart = html.lastIndexOf("<th", html.indexOf(">编号<"));
  const idTh = html.slice(idStart, html.indexOf("</th>", html.indexOf(">编号<")));
  expect(!idTh.includes("lucide"), "禁排序列不得渲染任何排序图标");
  expect(!idTh.includes("cursor-pointer"), "禁排序列不得有排序点击态");
  expect(read("src/components/data-table.tsx").includes("aria-sort"), "激活排序列的 th 必须设置 aria-sort");
});

check("表格操作列：sticky 列默认右对齐（头身同侧）、单元格内容 justify-end、末列收窄 padding 贴右边缘", async () => {
  const { DataTable } = await load("/src/components/data-table.tsx");
  const columns = [
    { accessorKey: "name", header: "名称" },
    { id: "actions", header: "操作", enableSorting: false, meta: { sticky: "right", hideable: false }, cell: () => "编辑" },
  ];
  const html = render(createElement(DataTable, { columns, data: [{ name: "a" }], emptyText: "暂无" }));
  const thStart = html.lastIndexOf("<th", html.indexOf(">操作<"));
  const th = html.slice(thStart, html.indexOf("</th>", html.indexOf(">操作<")));
  const tdStart = html.lastIndexOf("<td", html.indexOf(">编辑<"));
  const td = html.slice(tdStart, html.indexOf("</td>", html.indexOf(">编辑<")));
  expect(th.includes("text-right"), "操作列表头必须右对齐（sticky 列默认 right，头身同侧）");
  expect(th.includes("pr-2"), "末列表头必须收窄右 padding（贴边节奏）");
  expect(td.includes("text-right"), "操作列单元格必须右对齐");
  expect(td.includes("pr-2"), "末列单元格必须收窄右 padding（最后一个按钮贴近右边缘）");
  expect(td.includes("flex justify-end"), "操作列单元格内容必须 flex justify-end 靠右");
  expect(
    td.includes("bg-[var(--row-bg,var(--surface))]"),
    "冻结列单元格背景必须走行背景变量 --row-bg（行色时无白底断层），默认回落 --surface",
  );
});

check("ModelsTable：操作列同样右对齐贴边（justify-end + pr-2 + 默认右对齐）", async () => {
  const { ModelsTable } = await load("/src/components/models/table.tsx");
  const columns = [
    { key: "name", label: "名称", cell: () => "alpha" },
    { key: "actions", label: "操作", hideable: false, sticky: "right", cell: () => "编辑" },
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
  const th = html.slice(html.lastIndexOf("<th", html.indexOf(">操作<")), html.indexOf("</th>", html.indexOf(">操作<")));
  const td = html.slice(html.lastIndexOf("<td", html.indexOf(">编辑<")), html.indexOf("</td>", html.indexOf(">编辑<")));
  expect(th.includes("text-right"), "ModelsTable 操作列表头必须右对齐");
  expect(th.includes("pr-2"), "ModelsTable 末列表头必须收窄右 padding");
  expect(td.includes("text-right"), "ModelsTable 操作列单元格必须右对齐");
  expect(td.includes("pr-2"), "ModelsTable 末列单元格必须收窄右 padding");
  expect(td.includes("flex justify-end"), "ModelsTable 操作列内容必须 justify-end 靠右");
  expect(
    td.includes("bg-[var(--row-bg,var(--surface))]"),
    "ModelsTable 冻结列单元格背景必须走行背景变量",
  );
});

check("table-order：partitionClosedLast 稳定分区——关闭行置尾、启用行保持原序、不原地改入参", async () => {
  const { partitionClosedLast } = await load("/src/lib/table-order.ts");
  const rows = [
    { id: "a", closed: false },
    { id: "b", closed: true },
    { id: "c", closed: false },
    { id: "d", closed: true },
  ];
  const out = partitionClosedLast(rows, (row) => row.closed);
  expect(out.map((row) => row.id).join("") === "acbd", "关闭行置尾且启用行保持原相对顺序（稳定分区）");
  expect(rows.map((row) => row.id).join("") === "abcd", "不得原地修改入参（页面 rows 可能被复用）");
  const untouched = partitionClosedLast([{ id: "x" }], () => false);
  expect(untouched.length === 1 && untouched[0].id === "x", "无关闭行时位置不变（冷却行不置尾的前提）");
});

check("行色：ModelsTable 行级 rowTone——冷却微黄、关闭微灰，TR 同步 --row-bg 供冻结列着色", async () => {
  const { ModelsTable } = await load("/src/components/models/table.tsx");
  const columns = [{ key: "name", label: "名称", cell: (row) => row.name }];
  const html = render(
    createElement(ModelsTable, {
      columns,
      rows: [{ id: "w", name: "冷却行标记" }, { id: "n", name: "关闭行标记" }],
      totalCount: 2,
      storageKey: "slipstream.test",
      tabKey: "t",
      searchText: "",
      onSearchChange: () => {},
      searchPlaceholder: "搜索",
      emptyText: "暂无数据",
      onClearFilters: () => {},
      rowTone: (row) => (row.id === "w" ? "warning" : "neutral"),
    }),
  );
  expect(html.includes("bg-[var(--warning-soft)]"), "冷却行必须微黄底色（--warning-soft）");
  expect(html.includes("bg-[var(--neutral-soft)]"), "关闭行必须微灰底色（--neutral-soft）");
  expect(html.includes('--row-bg:var(--warning-soft)'), "冷却行 TR 必须设 --row-bg=warning-soft（冻结列同步着色）");
  expect(html.includes('--row-bg:var(--neutral-soft)'), "关闭行 TR 必须设 --row-bg=neutral-soft（冻结列同步着色）");
});

check("置尾：ModelsTable 默认视图关闭行排在启用行之后（分页切片前分区）", async () => {
  const { ModelsTable } = await load("/src/components/models/table.tsx");
  const columns = [{ key: "name", label: "名称", cell: (row) => row.name }];
  const html = render(
    createElement(ModelsTable, {
      columns,
      rows: [
        { id: "a", name: "甲启用" },
        { id: "b", name: "乙关闭" },
        { id: "c", name: "丙启用" },
      ],
      totalCount: 3,
      storageKey: "slipstream.test",
      tabKey: "t",
      searchText: "",
      onSearchChange: () => {},
      searchPlaceholder: "搜索",
      emptyText: "暂无数据",
      onClearFilters: () => {},
      closedLast: (row) => row.id === "b",
    }),
  );
  const posA = html.indexOf("甲启用");
  const posB = html.indexOf("乙关闭");
  const posC = html.indexOf("丙启用");
  expect(posA >= 0 && posB >= 0 && posC >= 0, "三行都必须渲染");
  expect(posA < posC && posC < posB, "默认视图关闭行「乙」必须排在启用行「甲/丙」之后");
});

check("置尾：DataTable 客户端默认（未排序）视图支持 closedLast 置尾", async () => {
  const { DataTable } = await load("/src/components/data-table.tsx");
  const columns = [{ accessorKey: "name", header: "名称" }];
  const html = render(
    createElement(DataTable, {
      columns,
      data: [{ name: "甲启用" }, { name: "乙关闭" }, { name: "丙启用" }],
      emptyText: "暂无",
      closedLast: (row) => row.name === "乙关闭",
    }),
  );
  const posA = html.indexOf("甲启用");
  const posB = html.indexOf("乙关闭");
  const posC = html.indexOf("丙启用");
  expect(posA >= 0 && posB >= 0 && posC >= 0, "三行都必须渲染");
  expect(posA < posC && posC < posB, "DataTable 默认视图关闭行必须置尾");
});

check("模型管理：两张表都接入行色与关闭置尾（rowTone + closedLast 走同一套模型可用性语义）", () => {
  const text = read("src/pages/models.tsx");
  const toneCalls = (text.match(/rowTone=\{modelRowTone\}/g) ?? []).length;
  const lastCalls = (text.match(/closedLast=\{modelRowRank\}/g) ?? []).length;
  expect(toneCalls >= 2, "上游模型与公开模型两张表都必须传 rowTone={modelRowTone}（当前 " + toneCalls + " 处）");
  expect(lastCalls >= 2, "两张表都必须传 closedLast={modelRowRank}（当前 " + lastCalls + " 处）");
  const vocab = read("src/components/models/availability.ts");
  expect(vocab.includes("modelRowTone") && vocab.includes("modelRowRank"), "行色/置尾语义必须收敛在 availability 模块");
  const toneFn = vocab.slice(vocab.indexOf("export function modelRowTone"), vocab.indexOf("export function modelRowRank"));
  expect(toneFn.length > 0, "未找到 modelRowTone 函数");
  expect(
    toneFn.indexOf('state === "closed"') < toneFn.indexOf("isCooling(row)"),
    "行色判定必须关闭优先于冷却（closed 行即使有残留冷却也是微灰）",
  );
});

check("模型管理：两张表都删掉状态列——状态改由行底色 + 操作文案 + 名字旁状态图标表达（W7 ticket 10）", () => {
  const text = read("src/pages/models.tsx");
  const upstreamStart = text.indexOf("function UpstreamTab");
  const publicStart = text.indexOf("function PublicTab");
  expect(upstreamStart >= 0 && publicStart > upstreamStart, "未找到上游/公开两个 Tab 函数");
  const upstreamSlice = text.slice(upstreamStart, publicStart);
  const publicSlice = text.slice(publicStart);
  expect(
    !upstreamSlice.includes('key: "status"'),
    "上游模型表不得保留状态列（与操作列启停按钮重复；spec C11：用户已明确删除重复状态列）",
  );
  expect(
    !publicSlice.includes('key: "status"'),
    "公开模型表不得保留状态列（与操作列启停按钮重复）",
  );
  // 状态信息不能跟着列一起消失：名字旁出图标，周期规则摘要搬进名字格。
  expect(upstreamSlice.includes("StatusIcon"), "上游模型名旁必须挂状态图标（normal 不出图标）");
  expect(publicSlice.includes("StatusIcon"), "公开模型名旁必须挂状态图标");
  expect(upstreamSlice.includes("周期："), "周期规则摘要必须保留（随状态列删除搬到模型名下方）");
});

check("状态图标：normal 不出图标；closed/cooling/unknown 三态图标 + 悬浮文案（冷却时间 yyyy-mm-dd hh:mm:ss）", async () => {
  const { StatusIcon } = await load("/src/components/ui/status-icon.tsx");
  const normal = render(createElement(StatusIcon, { kind: "normal" }));
  expect(!normal.includes("data-status-icon"), "normal 状态不得渲染状态图标");
  expect(!normal.includes("<svg"), "normal 状态不得留下图标占位（正常模型不增加视觉噪音）");

  const closed = render(createElement(StatusIcon, { kind: "closed" }));
  expect(closed.includes('data-status-icon="closed"'), "关闭态必须渲染 closed 状态图标");
  expect(closed.includes('aria-label="已关闭，人工启用后恢复"'), "关闭态悬浮文案必须是「已关闭，人工启用后恢复」");
  expect(closed.includes("lucide-ban"), "关闭态图标必须是 Ban");
  expect(closed.includes('data-hover-info="trigger"'), "状态图标必须挂统一悬浮详情触发元素");
  expect(closed.includes('tabindex="0"'), "状态图标必须可聚焦（键盘用户要能读到状态）");

  const cooling = render(createElement(StatusIcon, { kind: "cooling", cooldownUntilMs: 1795000000000 }));
  expect(cooling.includes('data-status-icon="cooling"'), "冷却态必须渲染 cooling 状态图标");
  expect(
    /aria-label="冷却中，\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} 后解除"/.test(cooling),
    "冷却态悬浮文案必须是「冷却中，yyyy-mm-dd hh:mm:ss 后解除」，实际：" + cooling,
  );
  expect(cooling.includes("lucide-snowflake"), "冷却态图标必须是 Snowflake");

  const unknown = render(createElement(StatusIcon, { kind: "unknown" }));
  expect(unknown.includes('data-status-icon="unknown"'), "未知态必须渲染 unknown 状态图标");
  expect(unknown.includes('aria-label="状态未知"'), "未知态悬浮文案必须是「状态未知」");
});

check("模型状态投影：normal/cooling/closed 直出；控制台不认识的状态判 unknown（不装作正常）", async () => {
  const { modelStatusKind } = await load("/src/components/models/availability.ts");
  expect(modelStatusKind({ enabled: true, availability: { state: "normal" } }) === "normal", "normal 必须直出 normal");
  expect(modelStatusKind({ enabled: false, availability: { state: "closed" } }) === "closed", "closed 必须直出 closed");
  expect(
    modelStatusKind({ enabled: true, availability: { state: "cooling", cooldown_until_ms: Date.now() + 60000 } }) === "cooling",
    "cooling 必须直出 cooling",
  );
  expect(
    modelStatusKind({ enabled: true, availability: { state: "degraded" } }) === "unknown",
    "控制台不认识的状态必须判 unknown（不能装作正常）",
  );
  expect(modelStatusKind({ enabled: false }) === "closed", "没有投影时按行自身的启停兜底");
  expect(modelStatusKind({}) === "unknown", "既没有投影也没有启停信息时判 unknown");
});

check("模型管理：操作列内容单行不换行——flex-wrap 会把末按钮甩到第二行左缘，贴边失效（768 实测 149px）", () => {
  const text = read("src/pages/models.tsx");
  const wraps = (text.match(/flex flex-wrap gap-1/g) ?? []).length;
  expect(wraps === 0, "模型表操作列内容不得 flex-wrap（当前 " + wraps + " 处）：换行时末按钮回绕到下一行左缘，最后一个按钮不再贴右边缘");
});

// ---------- 4.6 表格规范推广全站（W6 ticket 11） ----------
// 票 10 在模型管理两表上立了规矩（操作列右对齐贴边 + 单行、关闭行微灰置尾、冷却行微黄、
// 三态排序图标）；本节把同一套规矩推广到其余全部数据表并钉住，防止逐页手写再次分裂。

check("表格操作列单行：全站带行操作的表操作单元格内容不得 flex-wrap（末按钮回绕第二行左缘，贴边失效）", () => {
  // 只匹配各文件操作列内容的确切类串；工具条/表单等非操作列的 flex-wrap 用别的类串，不受影响。
  const OFFENDING = [
    ["src/pages/client_keys.tsx", "flex\\s+flex-wrap\\s+items-center\\s+gap-1\\.5"],
    ["src/pages/roles.tsx", "flex\\s+flex-wrap\\s+items-center\\s+gap-1\\.5"],
    ["src/components/users/users-panel.tsx", "flex\\s+flex-wrap\\s+items-center\\s+gap-1\\.5"],
    ["src/pages/upstreams.tsx", "flex\\s+flex-wrap\\s+gap-1\\b"],
    ["src/components/upstreams/models-panel.tsx", "flex\\s+flex-wrap\\s+gap-1\\b"],
    ["src/components/upstreams/keys-panel.tsx", "flex\\s+flex-wrap\\s+gap-1\\b"],
  ];
  const problems = [];
  for (const [file, pattern] of OFFENDING) {
    const count = (read(file).match(new RegExp(pattern, "g")) ?? []).length;
    if (count > 0) problems.push(file + "：操作列内容 flex-wrap（" + count + " 处）");
  }
  expect(problems.length === 0, "操作列必须单行不换行：\n       " + problems.join("\n       "));
});

check("连接密钥：状态列只表达启停 → 删除重复状态列；关闭行微灰 + 默认置尾", () => {
  const text = read("src/pages/client_keys.tsx");
  expect(!text.includes('accessorKey: "status"'), "连接密钥状态列只表达启停（启用/关闭徽标与操作列启停按钮重复），必须删除（user story 40）");
  expect(text.includes("closedLast={keyClosedLast}"), "连接密钥必须传 closedLast={keyClosedLast}（关闭密钥默认置尾）");
  expect(text.includes("rowTone={keyRowTone}"), "连接密钥必须传 rowTone={keyRowTone}（关闭行微灰）");
});

check("用户管理：状态列删除（与操作列启停重复）——状态由行底色 + 操作文案表达", () => {
  const text = read("src/components/users/users-panel.tsx");
  expect(!text.includes('accessorKey: "status"'), "用户表不得保留状态列（与操作列启停按钮重复；spec C11）");
  expect(!text.includes('status: "状态"'), "列设置菜单里不得再有「状态」项（列已删）");
  expect(text.includes("closedLast={view === \"list\" ? userClosedLast : undefined}"), "closedLast 必须只在不列表视图传入：树视图保持层级顺序不置尾（user story 42）");
  expect(text.includes("rowTone={userRowTone}"), "用户表必须传 rowTone={userRowTone}（关闭/已删除行微灰）");
  // 状态没跟着列一起丢：关闭/已删除由行底色与操作文案表达。
  expect(text.includes("已删除"), "已删除用户仍要在操作列给出「已删除」文案");
  expect(text.includes('disabledNow ? "启用" : "关闭"'), "操作列的启停文案必须随状态切换");
});

check("上游渠道：状态列已下线（与操作列启停重复），状态由行底色 + 操作文案 + 名称徽标表达", () => {
  const text = read("src/pages/upstreams.tsx");
  expect(!text.includes('accessorKey: "enabled"'), "上游渠道表不得有状态列");
  expect(text.includes("rowTone={upstreamRowTone}"), "上游渠道表必须传 rowTone={upstreamRowTone}（关闭行微灰）");
  expect(text.includes("partitionClosedLast("), "关闭上游仍要整页置尾");
});

check("上游渠道：server 分页模式页面层先分区再切片——关闭行排到最后一页，行色微灰", () => {
  const text = read("src/pages/upstreams.tsx");
  expect(text.includes('from "@/lib/table-order"'), "上游渠道必须在页面层引入 partitionClosedLast（server 模式 DataTable 只见当前页）");
  expect(text.includes("partitionClosedLast("), "pagedRows 必须先分区再 slice：关闭上游整页置尾，而不是只在当前页内置尾");
  expect(text.includes("rowTone={upstreamRowTone}"), "上游渠道表必须传 rowTone={upstreamRowTone}（关闭行微灰）");
});

check("上游详情模型表：重复状态列删除，行色与置尾复用模型可用性语义", () => {
  const text = read("src/components/upstreams/models-panel.tsx");
  expect(!text.includes('accessorKey: "enabled"'), "上游详情模型表状态列只表达启停（enabled 徽标与操作列启停按钮重复），必须删除");
  expect(text.includes("rowTone={modelRowTone}"), "上游详情模型表必须复用 modelRowTone（关闭微灰/冷却微黄，语义不另起一套）");
  expect(text.includes("closedLast={modelRowRank}"), "上游详情模型表必须复用 modelRowRank（关闭置尾、冷却不置尾）");
});

check("日志页：SortHeader 换共享三态 SortIndicator（未排序 ArrowUpDown 常驻），两态 ArrowUp/ArrowDown 移除", () => {
  const text = read("src/pages/logs.tsx");
  expect(text.includes('SortIndicator'), "日志服务端排序列必须复用共享 SortIndicator（三态语义不另起一套）");
  expect(!/import\s*\{[^}]*\bArrowUp\b[^}]*\}\s*from\s*"lucide-react"/.test(text), "日志页不得再从 lucide 引两态 ArrowUp（未排序也要有可排序指示）");
  expect(!/const Arrow = /.test(text), "日志页不得保留 asc/desc 二选一的旧图标逻辑");
  // SortIndicator 自带 aria-label（未排序/升序/降序）；外层按钮已有「按…排序」可访问名，
  // 图标必须 aria-hidden，否则按钮可访问名变成「按词元排序 未排序」，exact 匹配的验收断言全断。
  expect(/aria-hidden="true"[^>]*>\s*<SortIndicator/.test(text) || text.includes('<span aria-hidden="true"><SortIndicator'), "SortIndicator 必须包在 aria-hidden 内，保持「按…排序」按钮可访问名不变");
});

check("PriceTable：可排序列换共享三态 SortIndicator，两态 ArrowUp/ArrowDown 移除", () => {
  const text = read("src/components/pricing/table.tsx");
  expect(text.includes("SortIndicator"), "价目表可排序列必须复用共享 SortIndicator");
  expect(!/import\s*\{[^}]*\bArrowUp\b[^}]*\}\s*from\s*"lucide-react"/.test(text), "PriceTable 不得再从 lucide 引两态 ArrowUp/ArrowDown 做排序指示");
  expect(/<SortIndicator direction=\{sortKey === col\.key \? sortDir : false\} \/>/.test(text), "未排序态必须渲染 direction=false（常驻 ArrowUpDown），不能只在激活时出图标");
});

check("PriceTable：sticky 操作列单元格内容由表格统一 flex justify-end 包装（与 DataTable/ModelsTable 同一机制）", async () => {
  const { PriceTable } = await load("/src/components/pricing/table.tsx");
  const columns = [
    { key: "name", label: "名称", cell: (row) => row.name },
    { key: "actions", label: "操作", hideable: false, sticky: "right", cell: () => "编辑" },
  ];
  const html = render(
    createElement(PriceTable, {
      columns,
      rows: [{ id: "a", name: "alpha" }],
      totalCount: 1,
      sectionKey: "t11",
      searchText: "",
      onSearchChange: () => {},
      searchPlaceholder: "搜索",
      emptyText: "暂无数据",
      onClearFilters: () => {},
      rowKey: (row) => row.id,
    }),
  );
  const td = html.slice(html.lastIndexOf("<td", html.indexOf(">编辑<")), html.indexOf("</td>", html.indexOf(">编辑<")));
  expect(td.includes("flex justify-end"), "PriceTable 操作列内容必须由表格统一 justify-end 包装，页面不再各自手写");
});

check("PriceTable：可排列表头常驻未排序 ArrowUpDown（SSR 渲染）", async () => {
  const { PriceTable } = await load("/src/components/pricing/table.tsx");
  const columns = [
    { key: "name", label: "名称", cell: (row) => row.name },
    { key: "price", label: "单价", sortable: true, sortValue: (row) => row.price, cell: (row) => String(row.price) },
    { key: "note", label: "备注", cell: () => "-" },
  ];
  const html = render(
    createElement(PriceTable, {
      columns,
      rows: [{ id: "a", name: "alpha", price: 2 }],
      totalCount: 1,
      sectionKey: "t11",
      searchText: "",
      onSearchChange: () => {},
      searchPlaceholder: "搜索",
      emptyText: "暂无数据",
      onClearFilters: () => {},
      rowKey: (row) => row.id,
    }),
  );
  const priceTh = html.slice(html.lastIndexOf("<th", html.indexOf(">单价<")), html.indexOf("</th>", html.indexOf(">单价<")));
  const noteTh = html.slice(html.lastIndexOf("<th", html.indexOf(">备注<")), html.indexOf("</th>", html.indexOf(">备注<")));
  expect(priceTh.includes("lucide-arrow-up-down"), "可排序列未排序时必须常驻 ArrowUpDown 图标");
  expect(!noteTh.includes("lucide"), "不可排序列不得渲染排序图标");
});

check("上游详情密钥裸表：操作列表头右对齐、单元格内容由 KeysTable 统一 justify-end 包装", () => {
  const text = read("src/components/upstreams/keys-panel.tsx");
  expect(text.includes('FROZEN_COLUMN_HEADER_CLASS + " text-right"'), "裸表操作列表头必须右对齐（与内容同侧）");
  expect(text.includes("ACTION_CELL_WRAPPER_CLASS"), "KeysTable 必须用共享 ACTION_CELL_WRAPPER_CLASS 包装操作单元格内容，两个调用点不再各自手写");
});

check("日志页 SortHeader（SSR）：未排序 ArrowUpDown 常驻、升序 ArrowUpNarrowWide，按钮可访问名不被图标污染", async () => {
  const { SortHeader } = await load("/src/pages/logs.tsx");
  const unsorted = render(
    createElement(SortHeader, {
      label: "词元", field: "total_tokens",
      sort: { field: "started_at", order: "desc" },
      onSort: () => {},
    }),
  );
  expect(unsorted.includes("lucide-arrow-up-down"), "未排序的排序列必须常驻 ArrowUpDown（此前只在激活时出图标）");
  expect(/aria-label="按词元排序"/.test(unsorted), "按钮可访问名必须是「按词元排序」");
  expect(unsorted.includes("aria-hidden=\"true\""), "SortIndicator 必须包在 aria-hidden 内：图标状态标签不得进入按钮可访问名");
  const asc = render(
    createElement(SortHeader, {
      label: "词元", field: "total_tokens",
      sort: { field: "total_tokens", order: "asc" },
      onSort: () => {},
    }),
  );
  expect(asc.includes("lucide-arrow-up-narrow-wide"), "升序必须渲染 ArrowUpNarrowWide（上窄下宽）");
  expect(!asc.includes("lucide-arrow-up-down"), "激活态不得残留未排序图标");
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
  expect(fmt.fmtInt(null) === "-" && fmt.fmtInt(Number.NaN) === "-", "fmtInt 缺值/非有限值应显示半角横线「-」");
  expect(fmt.formatCount === undefined, "formatCount 旧别名必须删除（统一用 fmtInt）");
});

check("数字格式：图表轴紧凑计数只保留整数（无 K/M/B 小数）", async () => {
  const fmt = await load("/src/lib/format.ts");
  expect(fmt.fmtCount(999) === "999", "千位以内仍用千分位整数");
  expect(fmt.fmtCount(565920) === "566K", "565920 应四舍五入为 566K，不得有小数");
  expect(fmt.fmtCount(1_500_000) === "2M", "1.5M 应取整为 2M");
  expect(fmt.fmtCount(999_999) === "1M", "进位到 1000K 时必须升到 M");
  expect(fmt.fmtCount(Number.NaN) === "-", "fmtCount 非有限值应显示「-」");
});

check("数字格式：RPM 两位小数、百分比一位小数", async () => {
  const fmt = await load("/src/lib/format.ts");
  expect(fmt.fmtRpm(2572.014583) === "2,572.01", "RPM 必须固定两位小数（整数部分千分位）");
  expect(fmt.fmtRpm(0) === "0.00", "RPM 0 也要两位小数");
  expect(fmt.fmtRpm(null) === "-", "RPM 缺值显示「-」");
  expect(fmt.fmtPct(0.4148) === "41.5%", "比例（0–1）必须一位小数百分比");
  expect(fmt.fmtPct(0) === "0.0%" && fmt.fmtPct(1) === "100.0%", "百分比边界值固定一位小数");
  expect(fmt.fmtPct(null) === "-", "百分比缺值显示「-」");
  expect(fmt.fmtPctPoint(41.48) === "41.5%", "已是百分数的值（如 cache_ratio）直接一位小数");
});

check("数字格式：金额表格两位、单请求均值四位、取消六位小数", async () => {
  const fmt = await load("/src/lib/format.ts");
  expect(fmt.fmtMoney(2_000_000, "CNY") === "¥2.00", "金额默认两位小数");
  expect(fmt.fmtMoney(-1_500_000, "CNY") === "-¥1.50", "负数符号必须在货币符号之前");
  expect(fmt.fmtMoney(1_500_000, "USD") === "$1.50", "币种符号按 currency 选择");
  expect(fmt.fmtMoney(null) === "-", "金额缺值显示「-」，不渲染 0");
  expect(fmt.fmtMoneyAvg(3_400, "CNY") === "¥0.0034", "单请求金额/均值必须四位小数");
  expect(fmt.fmtMoneyAvg(1_234_567) === "¥1.2346", "单请求金额四位小数四舍五入");
  expect(fmt.fmtMoney6 === undefined && fmt.fmtYuan === undefined && fmt.fmtMicroYuan === undefined, "6 位小数与旧别名必须删除");
  expect(fmt.fmtCny(2_000_000) === "¥2.00", "fmtCny 仍走两位小数");
});

check("数字格式：单价 2 位、不足 0.01 升 4 位；单价统一从 lib/format 出", async () => {
  const fmt = await load("/src/lib/format.ts");
  expect(fmt.fmtPricePerM("2") === "¥2.00/M", "模型行进价两位小数 + /M");
  expect(fmt.fmtPricePerM("0.005") === "¥0.0050/M", "不足 0.01 的单价必须升到 4 位");
  expect(fmt.fmtPricePerM(null) === "-", "未配置单价显示「-」");
  expect(fmt.fmtPriceAmount("2", "USD") === "$2.00", "公开模型售价按币种两位小数");
  expect(fmt.fmtUnitPriceMicro(2_000_000, "CNY") === "¥2.00", "微单位单价按两位小数展示");
  expect(fmt.fmtUnitPriceMicro(5_000, "CNY") === "¥0.0050", "微单位小单价升到四位");
});

check("数字格式：吞吐与文件大小格式化也收敛到 lib/format", async () => {
  const fmt = await load("/src/lib/format.ts");
  expect(fmt.fmtThroughput(42.34) === "42.3", "吞吐 <100 保留一位小数");
  expect(fmt.fmtThroughput(1234.5) === "1,235", "吞吐 >=100 取整并千分位（不得用 toLocaleString 自拼）");
  expect(fmt.fmtThroughput(0) === "-", "无吞吐显示「-」");
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

check("日志路由链：每轮状态/上游/模型/耗时，失败箭头在行首，成功奖杯在行首", async () => {
  const { RequestAttemptChain } = await load("/src/components/logs/request-attempt-chain.tsx");
  const html = render(
    createElement(RequestAttemptChain, {
      attempts: [
        {
          attempt: 1,
          upstream_id: "ups_zai",
          upstream_name: "zai-01",
          upstream_key_seq: 1,
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
          upstream_id: "ups_or",
          upstream_name: "or-01",
          upstream_key_seq: 1,
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
      "路由链",
      "总耗时",
      "0.15s",
      "第 1 轮：",
      "第 2 轮：",
      "zai-01#1",
      "or-01#1",
      "glm-5.3",
      "0.06s",
      "0.09s",
      "ups_zai",
      "ups_or",
      "上游 ID",
      "错误：",
      ATTEMPT_LONG_ERROR,
    ],
    "路由链行",
  );
  expect(html.includes("<details"), "失败轮必须能展开错误详情（details）");
  expect(html.includes("lucide-chevron-down"), "失败轮行首使用下箭头");
  expect(html.includes("lucide-trophy"), "成功轮行首使用奖杯图标");
  expect(html.includes("text-danger"), "失败轮行首箭头为红色");
  expect(html.includes("text-success"), "成功轮行首奖杯为绿色");
  expect(
    html.split("<details").length - 1 === 1,
    "成功轮不得渲染可展开控件，只有失败轮可展开",
  );
  expect(!html.includes("路由链 ·"), "标题只写「路由链」，尝试次数放到模型旁触发器");
});

check("日志路由链：无 attempts 显示「无链路记录」，不伪造链路", async () => {
  const { RequestAttemptChain } = await load("/src/components/logs/request-attempt-chain.tsx");
  const html = render(createElement(RequestAttemptChain, { attempts: [] }));
  expect(html.includes("无链路记录"), "无 attempts 必须显示「无链路记录」");
  expect(!html.includes("次尝试"), "无 attempts 不得渲染尝试轮数或伪造链路");
  expect(!html.includes("<details"), "无 attempts 不得渲染尝试详情");
});

check("日志页：模型格 attempts>0 分叉图标开 popover，独立尝试列删除（W7 ticket 06 接线）", async () => {
  const { RequestAttemptChainPopover } = await load("/src/components/logs/request-attempt-chain.tsx");
  const trigger = render(
    createElement(RequestAttemptChainPopover, {
      eventId: "mev_1005",
      attemptsCount: 3,
      totalDurationMs: 180,
    }),
  );
  includesAll(trigger, ['data-slot="log-attempts-trigger"', "查看 3 次尝试的路由链", "·", "尝试 3 次", "aria-label"], "分叉图标按钮");
  const page = read("src/pages/logs.tsx");
  includesAll(page, ["RequestAttemptChainPopover", "has_attempts"], "日志页模型格分叉图标接线");
  expect(!page.includes('id: "attempts"'), "独立尝试列必须删除");
  expect(!page.includes('header: "尝试"'), "不得再有「尝试」表头");
  expect(!page.includes('attempts: "尝试"'), "列设置不得再有尝试列展示名");
  expect(!page.includes("请求模型未记录"), "requested_model 缺失不得回退到占位文案");
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
  const { createMemoryLogs } = await load("/src/lib/control-plane/memory-logs.ts");
  const logs = createMemoryLogs();
  const page = await logs.list({ query: "", pageSize: 200, offset: 0, sort: "started_at", order: "desc" });
  const withChain = page.items.find((item) => item.has_attempts && item.http_status >= 400);
  expect(Boolean(withChain), "mock 必须有一行上游失败但带 attempts 的日志");
  expect(withChain.attempts_count > 0, "失败行的 attempts_count 必须 > 0");
  const chain = await logs.attempts(withChain.event_id);
  expect(chain.attempts.length === withChain.attempts_count, "mock 尝试链长度必须与 attempts_count 一致");
  const { rowErrorText } = await load("/src/components/logs/error-summary.ts");
  const lastFailed = [...chain.attempts].reverse().find((attempt) => attempt.status_code >= 400);
  expect(Boolean(lastFailed), "mock 尝试链必须包含失败尝试");
  expect(withChain.error === "", "带尝试链的失败行 error 只保留原始日志文本，UI 摘要由前端拼装");
  const composed = rowErrorText(withChain);
  expect(
    composed === "upstream " + lastFailed.status_code + ": " + lastFailed.error_message,
    "行级错误摘要必须由前端从 last_failure_* 事实字段拼装，实际：" + composed,
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

// ---------- 5. 上游「路由与模型」测试入口（W5 ticket 07） ----------
check("上游详情 Tab：四页签含「路由与模型」，旧「路由与映射」全站清零", async () => {
  const shared = await load("/src/components/upstreams/shared.ts");
  expect(Array.isArray(shared.UPSTREAM_TABS), "shared.ts 必须导出 UPSTREAM_TABS（Tab 文案单一来源）");
  expect(shared.UPSTREAM_TABS.length === 4, "上游详情必须四个 Tab，实际 " + shared.UPSTREAM_TABS.length);
  const labels = shared.UPSTREAM_TABS.map((item) => item.label);
  includesAll(labels.join("、"), ["连接与模型", "路由与模型", "请求与响应", "其他设置"], "上游详情 Tab");
  const routing = shared.UPSTREAM_TABS.find((item) => item.key === "routing");
  expect(routing && routing.label === "路由与模型", "路由与模型 Tab 的 key 必须是 routing");
  const stale = [];
  for (const file of sourceFiles()) {
    if (readFileSync(file, "utf8").includes("路由与映射")) stale.push(rel(file));
  }
  expect(stale.length === 0, "仍有旧文案「路由与映射」：" + stale.join("、"));
});

check("列表页「测试」：只跳转详情「路由与模型」Tab，不再发测试请求/不再全局 pending", async () => {
  const text = read("src/pages/upstreams.tsx");
  includesAll(text, ["upstreamRoutingHref"], "列表页测试跳转");
  expect(!text.includes("ENDPOINTS.upstreamTest"), "列表页不得再调用 test-connection 端点");
  expect(!text.includes("test.mutate"), "列表页不得再持有 test-connection mutation");
  expect(!text.includes("test.isPending"), "列表页不得用全局 pending 禁用所有行");
  expect(!text.includes("测试中…"), "列表页不再出现「测试中…」");
  const shared = await load("/src/components/upstreams/shared.ts");
  const href = shared.upstreamRoutingHref("up_01");
  expect(href === "/upstreams/up_01?tab=routing", "跳转地址必须带 ?tab=routing，实际 " + href);
});

check("密钥数：旧库未迁移时提示运行 migrate_multikey_v2（has_api_key 不再回退 api_key_enc）", () => {
  const page = read("src/pages/upstreams.tsx");
  includesAll(page, ["migrate_multikey_v2", "旧库"], "旧库密钥迁移提示");
  const types = read("src/types.ts");
  expect(!types.includes("legacy?: boolean"), "UpstreamKey.legacy 已不再由后端返回，必须删除");
});

check("详情页 URL 参数：?tab=routing 定位「路由与模型」，非法值回落连接与模型", async () => {
  const shared = await load("/src/components/upstreams/shared.ts");
  expect(typeof shared.resolveUpstreamTab === "function", "shared.ts 必须导出 resolveUpstreamTab");
  expect(shared.resolveUpstreamTab("routing") === "routing", "?tab=routing 必须解析为 routing");
  expect(shared.resolveUpstreamTab("transforms") === "transforms", "合法页签必须原样解析");
  expect(shared.resolveUpstreamTab(null) === "connection", "缺省页签必须是连接与模型");
  expect(shared.resolveUpstreamTab("routingx") === "connection", "非法页签必须回落连接与模型");
  const page = read("src/pages/upstream_detail.tsx");
  includesAll(page, ["useSearchParams", "resolveUpstreamTab", "UPSTREAM_TABS"], "详情页 URL 参数接线");
});

check("路由与模型面板：单模型/全部测试 + 密钥选择 + 串行进度可取消 + 结果仅会话内", () => {
  const panel = read("src/components/upstreams/models-panel.tsx");
  includesAll(
    panel,
    [
      "全部测试", "拉取模型", "测试结果", "选择测试密钥", "清空结果",
      "probe.run(", "probe.cancel", "probe.clear", "probe.session",
    ],
    "路由与模型面板接线",
  );
  // 逐模型 POST models/probe、会话状态与取消在探测模块里；结果/进度组件在 view 模块（面板只组合）。
  const probe = read("src/components/upstreams/model-probe.ts");
  includesAll(
    probe,
    ["probeModels", "AbortController", "MODEL_PROBE_REQUEST_TIMEOUT_MS", "probeReducer"],
    "模型探测模块接线",
  );
  const view = read("src/components/upstreams/model-probe-view.tsx");
  includesAll(view, ["取消测试", "ModelProbeProgress", "ModelProbeBadge"], "模型探测展示组件");
  const detail = read("src/pages/upstream_detail.tsx");
  expect(!detail.includes("获取上游模型"), "模型拉取入口已移入「路由与模型」面板（拉取模型）");
});

check("模型探测纯逻辑：结果徽章语义/失败与超时分类/串行进度/取消", async () => {
  const probe = await load("/src/components/upstreams/model-probe.ts");
  const item = (patch) => ({ model_id: "um_01", model: "glm-5.3", ok: true, status: 200, latency_ms: 123, error_type: "", message: "", ...patch });
  const ok = probe.probeResultView(item({}));
  expect(ok.label === "连通" && ok.tone === "success", "成功行必须是 连通/success，实际 " + ok.label + "/" + ok.tone);
  expect(ok.latencyText === "123 ms", "成功行必须显示延迟，实际 " + ok.latencyText);
  const fail = probe.probeResultView(item({ ok: false, status: 401, error_type: "http", message: "上游返回 HTTP 401：invalid key（sk-***）" }));
  expect(fail.label === "失败" && fail.tone === "danger", "HTTP 失败行必须是 失败/danger");
  expect(fail.detail.includes("HTTP 401") && fail.detail.includes("sk-***"), "失败行必须展示后端已脱敏的错误信息");
  const timeout = probe.probeResultView(item({ ok: false, status: 0, error_type: "timeout", message: "请求超时（20 秒）" }));
  expect(timeout.label === "超时" && timeout.tone === "warning", "超时行必须是 超时/warning");
  const refused = probe.probeResultView(item({ ok: false, status: 0, error_type: "connection", message: "连接失败：boom" }));
  expect(refused.label === "连接失败" && refused.tone === "danger", "连接失败行必须是 连接失败/danger");

  let session = probe.emptyProbeSession();
  expect(session.running === false && session.done === 0 && session.total === 0, "空会话必须是未运行/0 进度");
  session = probe.probeReducer(session, { type: "start", total: 22, keyId: "" });
  expect(session.running === true && session.total === 22, "start 后必须进入运行中并记录总数");
  session = probe.probeReducer(session, { type: "begin", modelId: "um_01" });
  expect(session.currentModelId === "um_01", "begin 必须标记当前模型");
  session = probe.probeReducer(session, { type: "item", item: item({}) });
  expect(session.done === 1 && session.results.um_01.ok === true, "item 必须累加进度并保存会话结果");
  expect(session.currentModelId === null, "item 后必须清空当前模型");
  const summary = probe.probeSummary(session);
  expect(summary.done === 1 && summary.total === 22 && summary.ok === 1 && summary.failed === 0, "进度摘要必须如实统计");
  expect(summary.percent === 5, "1/22 进度必须四舍五入为 5%，实际 " + summary.percent);
  session = probe.probeReducer(session, { type: "finish", cancelled: true });
  expect(session.running === false && session.cancelled === true, "finish(cancelled) 必须结束运行并标记已取消");
  const cleared = probe.probeReducer(session, { type: "reset" });
  expect(cleared.running === false && cleared.done === 0 && Object.keys(cleared.results).length === 0, "reset 必须清空会话结果");

  // 行内单模型「测试」只更新该行、不清空本次会话其他结果；「全部测试」整体重测。
  let merged = probe.probeReducer(probe.emptyProbeSession(), { type: "start", total: 1, keyId: "", reset: false });
  merged = probe.probeReducer(merged, { type: "item", item: item({ model_id: "um_a" }) });
  merged = probe.probeReducer(merged, { type: "start", total: 1, keyId: "", reset: false });
  merged = probe.probeReducer(merged, {
    type: "item",
    item: item({ model_id: "um_b", ok: false, status: 500, error_type: "http", message: "上游返回 HTTP 500" }),
  });
  expect(Object.keys(merged.results).length === 2, "单模型测试必须保留本次会话其他行的结果");
  const rerun = probe.probeReducer(merged, { type: "start", total: 2, keyId: "", reset: true });
  expect(Object.keys(rerun.results).length === 0, "全部测试必须整体重测（清空旧结果）");
});

check("模型探测展示：失败行红色错误、超时琥珀、进度 N/M 与取消入口（SSR）", async () => {
  const probe = await load("/src/components/upstreams/model-probe.ts");
  const probeView = await load("/src/components/upstreams/model-probe-view.tsx");
  const okHtml = render(createElement(probeView.ModelProbeBadge, { item: { model_id: "a", model: "glm", ok: true, status: 200, latency_ms: 123, error_type: "", message: "" } }));
  expect(okHtml.includes("连通"), "成功徽章必须渲染「连通」");
  expect(okHtml.includes("bg-success-soft"), "成功徽章必须用 success 语义色");
  expect(okHtml.includes("123 ms"), "成功徽章必须显示延迟");
  const failHtml = render(createElement(probeView.ModelProbeBadge, { item: { model_id: "b", model: "glm", ok: false, status: 401, latency_ms: 80, error_type: "http", message: "上游返回 HTTP 401：invalid key" } }));
  expect(failHtml.includes("失败") && failHtml.includes("bg-danger-soft"), "失败徽章必须是 danger 语义色");
  expect(failHtml.includes("HTTP 401"), "失败行必须展示脱敏错误信息");
  expect(failHtml.includes("text-danger-text"), "失败信息必须用危险语义色");
  const timeoutHtml = render(createElement(probeView.ModelProbeBadge, { item: { model_id: "c", model: "glm", ok: false, status: 0, latency_ms: 0, error_type: "timeout", message: "请求超时（20 秒）" } }));
  expect(timeoutHtml.includes("超时") && timeoutHtml.includes("bg-warning-soft"), "超时徽章必须是 warning 语义色");

  let session = probe.probeReducer(probe.emptyProbeSession(), { type: "start", total: 22, keyId: "" });
  session = probe.probeReducer(session, { type: "begin", modelId: "um_03" });
  const html = render(createElement(probeView.ModelProbeProgress, { session, onCancel: () => {} }));
  expect(html.includes("/22"), "进度必须显示 N/M");
  expect(html.includes("取消测试"), "运行中必须有取消入口");
  expect(html.includes("bg-info") || html.includes("bg-primary"), "进度条必须用信息蓝/主色");
});

check("原语复用：脏表单底栏不透明、进度用 ui/spinner；冷却模式卡用 ToggleGroup 单选", () => {
  const dirty = read("src/components/ui/dirty-field.tsx");
  expect(!dirty.includes("backdrop-blur") && !dirty.includes("bg-surface/95"), "脏表单底栏必须不透明（不做半透明 + 背景模糊）");
  expect(!dirty.includes("animate-spin") && !dirty.includes("Loader2"), "脏表单进度必须复用 ui/spinner，不手写旋转动画");
  includesAll(dirty, ["@/components/ui/spinner", "<Spinner"], "脏表单进度指示器");
  const cooldown = read("src/components/models/cooldown-panel.tsx");
  includesAll(cooldown, ["ToggleGroup", "ToggleGroupItem", 'type="single"'], "冷却模式卡必须复用 ui/toggle-group 单选");
  expect(!cooldown.includes("function ModeCard"), "冷却模式不得再手写 aria-pressed 按钮");
});

// ---------- 8. 公开模型成员编排术语：上游渠道/模型（W5 ticket 14） ----------
check("成员编排：展示名统一「上游渠道/模型」，术语不单用「渠道」", async () => {
  const { memberChipLabel } = await load("/src/components/models/member-chip.ts");
  expect(memberChipLabel("zai-01", "glm-5.3") === "zai-01/glm-5.3", "成员展示名必须是「上游渠道/模型」");
  expect(memberChipLabel(undefined, "glm-5.3") === "glm-5.3", "上游渠道缺失时只显示模型名");
  const page = read("src/components/models/public-model-page.tsx");
  includesAll(page, ["MemberChipFlow"], "公开模型单页成员段必须用成员表格（MemberChipFlow）");
  expect(!page.includes("MemberBoard"), "成员段必须替换掉一行一模型的 MemberBoard（ticket 13 遗留）");
  const flow = read("src/components/models/member-chip-flow.tsx");
  includesAll(
    flow,
    ["优先级", "搜索上游渠道或模型", 'data-slot="member-table"', 'data-slot="member-table-head"', 'data-slot="member-row"', 'data-slot="member-candidate-chip"', "@/components/ui/button", "末位兜底"],
    "成员表格结构",
  );
  for (const file of [
    "src/components/models/member-chip.ts",
    "src/components/models/member-chip-flow.tsx",
    "src/components/models/member-editor.tsx",
    "src/components/models/public-model-page.tsx",
  ]) {
    const text = read(file);
    expect(!text.includes('" · "'), file + " 仍在用「模型名 · 上游名」拼接成员名");
    expect(!/(?<!上游)渠道/.test(text), file + " 出现单用「渠道」，UI 文案必须写「上游渠道」");
  }
});

// ---------- 五期：分流图隐藏阶段（ticket 01）----------
check("分流图隐藏阶段：前端不做跨接重连，隐藏集合作为后端 collapse 参数", () => {
  const chart = read("src/components/dashboard/flow-chart.tsx");
  expect(!chart.includes("splice"), "flow-chart.tsx 仍在前端 splice 重接桑基边（W5 已改后端 collapse 投影）");
  includesAll(chart, ["hiddenStages", "canHideMore", "至少保留两个可见阶段"], "分流图隐藏阶段守卫");
  const reports = read("src/components/dashboard/use-reports.ts");
  includesAll(reports, ["collapse", "narrowedKey"], "flow collapse 请求参数");
  const panel = read("src/components/dashboard/trend-panel.tsx");
  includesAll(panel, ["hiddenStages", "collapse: hiddenStages"], "看板 hiddenStages 接线");
});

check("分流图隐藏阶段：mock 按路径投影 collapse（W6 票 17），隐藏到两段即禁用请求", () => {
  const mocks = read("src/lib/control-plane/memory/report-fixtures.ts");
  includesAll(mocks, ["FLOW_PATHS", "flowChainOf", "flowMatchNodes"], "mock 路径投影与闭包复用");
  const panel = read("src/components/dashboard/trend-panel.tsx");
  expect(
    /FLOW_STAGES\.length - hiddenStages\.length >= 2/.test(panel),
    "隐藏后不足两段时必须禁用 flow 请求（至少保留 2 段）",
  );
});

// ---------- W6 ticket 17：分流图重构与搜索/focus ----------
check("分流图票 17：replaceMerge 替换 series、轴右竖排、搜索左、无已隐藏芯片块", () => {
  const chart = read("src/components/dashboard/flow-chart.tsx");
  includesAll(
    chart,
    [
      'id: "flow-sankey"',
      "replaceMerge: [\"series\"]",
      'data-slot="flow-stage-axis"',
      'data-slot="flow-search-input"',
      "仅显示搜索目标",
      "chart-frame",
    ],
    "分流图票 17 结构",
  );
  expect(!chart.includes("已隐藏："), "flow-chart 不得再渲染「已隐藏」芯片块（卡片高度跳动源）");
  const dash = read("src/pages/dashboard.tsx");
  expect(!dash.includes("RequestChain"), "看板不得再引用 RequestChain（独立请求链路面板已删，组件留给登录页）");
  includesAll(dash, ["查看分流"], "页头必须保留查看分流入口");
  includesAll(
    read("src/lib/reports/flow-search.ts"),
    ["flowChainOf", "flowSearchView", "flowMatchNodes"],
    "搜索闭包纯函数层",
  );
  const panel = read("src/components/dashboard/trend-panel.tsx");
  includesAll(panel, ["FLOW_SERVER_SEARCH_MIN_NODES", "serverNarrowed"], "大数据搜索必须走后端 q（前端不硬算）");
  const hooks = read("src/components/dashboard/use-reports.ts");
  includesAll(hooks, ["focus", "q", "topN"], "flow hook 透传 focus/q/topN（后端聚合过滤）");
});

// ---------- 六期：错误治理（W6 ticket 07）----------
// 查询 4xx 不自动重试、查询错误不逐查询弹 toast、一次失败只产生一条通知。
// retry 策略与通知去重都是纯函数，用 SSR 加载器跑真实实现断言行为；
// 接线（main.tsx / api.ts）按本文件惯例用源码契约钉住。
check("查询重试策略：4xx 不重试，5xx/网络错误最多重试 1 次", async () => {
  const { queryRetry, QUERY_RETRY_MAX } = await load("/src/lib/query-retry.ts");
  expect(queryRetry(0, { status: 404 }) === false, "4xx 第一次失败就必须放弃（重试必然再失败）");
  expect(queryRetry(0, { status: 500 }) === true, "5xx 第一次失败允许重试一次");
  expect(queryRetry(QUERY_RETRY_MAX, { status: 500 }) === false, "5xx 达到上限后停止重试");
  expect(queryRetry(0, new Error("network down")) === true, "无状态码的网络类错误按 5xx 上限重试");
});

check("错误通知去重：同因失败窗口内只产生一条通知", async () => {
  const store = await load("/src/lib/notification-store.ts");
  store.clearNotifications();
  const push = store.pushErrorNotificationOnce;
  const key = "INTERNAL_ERROR|internal server error";
  const first = push({ title: "查询失败", description: "INTERNAL_ERROR：x", dedupeKey: key }, 1_000);
  const dup = push({ title: "查询失败", description: "INTERNAL_ERROR：y", dedupeKey: key }, 2_000);
  const other = push({ title: "查询失败", description: "NOT_FOUND：z", dedupeKey: "NOT_FOUND|z" }, 2_100);
  expect(first === true && dup === false, "窗口内同因失败必须去重（第二次不落新通知）");
  expect(other === true, "不同原因的失败各记一条");
  expect(store.getNotificationsSnapshot().length === 2, "一次失败只产生一条通知");
  const afterWindow = push(
    { title: "查询失败", description: "INTERNAL_ERROR：w", dedupeKey: key },
    1_000 + store.ERROR_DEDUPE_WINDOW_MS + 1,
  );
  expect(afterWindow === true, "窗口外的新失败要再次提示");
  store.clearNotifications();
});

check("错误治理接线：main.tsx retry 接策略函数，control-plane 请求层查询失败进通知中心", () => {
  const main = read("src/main.tsx");
  expect(main.includes("queryRetry"), "main.tsx 必须把 queries.retry 接到 lib/query-retry 的策略函数");
  const adapter = read("src/lib/control-plane/http-adapter.ts");
  includesAll(
    adapter,
    ["pushErrorNotificationOnce", "reportFailure(err, isQuery)"],
    "http-adapter.ts：查询失败走通知中心去重",
  );
  // 查询错误不逐查询弹 toast：每个 toast.error 都必须直接落在非查询（写操作）分支里。
  const toasts = (adapter.match(/toast\.error/g) ?? []).length;
  const guarded = (adapter.match(/if \(!isQuery\) \{\s*toast\.error/g) ?? []).length;
  expect(toasts > 0 && toasts === guarded, "http-adapter.ts 的每个 toast.error 都必须在 !isQuery（写操作）分支内");
});

// ---------- 六期：模型试验思考等级与模型能力声明（W6 ticket 18）----------
// 档位收敛与 chat 判定是纯函数，SSR 加载真实实现断言行为；控件可见性渲染
// 真实面板断言 DOM（Select 选项在 SSR 不落 DOM，选项集合由纯函数检查兜住）。
const t18ChatInfo = () => ({
  name: "glm-5.3",
  model_type: "chat",
  sources: ["glm-5.3"],
  parameters: {
    max_input_tokens: 200000,
    max_output_tokens: 128000,
    reasoning_level: "high",
    reasoning_levels: ["default", "low", "high", "xhigh"],
    default_reasoning_level: "low",
    input_types: ["text"],
    output_types: ["text"],
    tool_call: true,
    reasoning: true,
    attachment: false,
    structured_output: true,
  },
});
const t18EmbeddingInfo = () => ({
  name: "embed-v4",
  model_type: "embedding",
  sources: ["embed-v4"],
  parameters: {
    ...t18ChatInfo().parameters,
    reasoning_levels: [],
    default_reasoning_level: "",
  },
});

check("思考档位全集与标签：default..max 七档，default 的语义是「不发送」", async () => {
  const lib = await load("/src/lib/playground.ts");
  expect(
    JSON.stringify(lib.REASONING_LEVELS) ===
      JSON.stringify(["default", "none", "low", "medium", "high", "xhigh", "max"]),
    "档位集合必须是 default/none/low/medium/high/xhigh/max 的既定顺序",
  );
  for (const level of lib.REASONING_LEVELS) {
    expect(
      typeof lib.REASONING_LEVEL_LABELS[level] === "string" &&
        lib.REASONING_LEVEL_LABELS[level].length > 0,
      "每个档位都要有中文标签：" + level,
    );
  }
  expect(
    lib.REASONING_LEVEL_LABELS.default.includes("不发送"),
    "default 档位标签必须说明「不发送」语义",
  );
});

check("档位收敛：有声明按声明保序，未声明回退全部档位，非法值不产生空选择器", async () => {
  const { reasoningLevelOptions, normalizeDeclaredDefault } = await load("/src/lib/playground.ts");
  expect(
    JSON.stringify(reasoningLevelOptions(["low", "default"])) === JSON.stringify(["low", "default"]),
    "有声明时按声明保序收敛",
  );
  expect(reasoningLevelOptions([]).length === 7, "空声明回退全部七档");
  expect(reasoningLevelOptions(undefined).length === 7, "缺声明字段回退全部七档");
  expect(reasoningLevelOptions(["ultra"]).length === 7, "声明只有未知值时回退全部档位");
  expect(normalizeDeclaredDefault("high") === "high", "已声明默认档原样采用");
  expect(
    normalizeDeclaredDefault("") === "default" && normalizeDeclaredDefault(undefined) === "default",
    "未声明默认档回退 default",
  );
  expect(normalizeDeclaredDefault("ultra") === "default", "非法默认档回退 default");
});

check("chat 判定：model_type === chat 才显示思考档位", async () => {
  const { isChatModel } = await load("/src/lib/playground.ts");
  expect(isChatModel(t18ChatInfo()) === true, "chat 模型必须判定为 chat");
  expect(isChatModel(t18EmbeddingInfo()) === false, "embedding 模型不得判定为 chat");
  expect(isChatModel(null) === false && isChatModel(undefined) === false, "无模型数据不得判定为 chat");
});

check("参数面板：仅 chat 模型渲染思考档位控件，厂商开关移除", async () => {
  const { ParamsPanel } = await load("/src/components/playground/params-panel.tsx");
  const { EMPTY_PLAYGROUND_PARAMS } = await load("/src/lib/playground-params.ts");
  const props = (modelInfo) => ({
    value: { ...EMPTY_PLAYGROUND_PARAMS },
    onChange: () => {},
    disabled: false,
    mockMode: false,
    onOpenModels: () => {},
    modelInfo,
  });
  const chatHtml = render(createElement(ParamsPanel, props(t18ChatInfo())));
  expect(chatHtml.includes("思考档位"), "chat 模型必须显示思考档位控件");
  expect(chatHtml.includes("不发送"), "default 档位语义「不传」必须有提示文案");
  expect(!chatHtml.includes("thinking 开关"), "厂商私有开关已从思考档位控件移除");
  const embeddingHtml = render(createElement(ParamsPanel, props(t18EmbeddingInfo())));
  expect(!embeddingHtml.includes("思考档位"), "embedding 等非 chat 模型不得出现思考档位控件");
  const noInfoHtml = render(createElement(ParamsPanel, props(null)));
  expect(!noInfoHtml.includes("思考档位"), "无模型能力数据时不显示思考档位控件");
});

check("模型对话框：底部档位随模型能力收敛（Radix Dialog 走 Portal，SSR 不落 DOM，按源码契约钉住）", () => {
  const src = read("src/components/playground/model-dialog.tsx");
  includesAll(
    src,
    ["reasoningLevelOptions(modelInfo?.parameters.reasoning_levels)", "isChatModel(modelInfo)"],
    "对话框档位行必须按模型声明收敛且仅 chat 模型显示",
  );
  expect(!src.includes('"不指定"') && !src.includes("thinking 开关"), "旧的不指定/厂商开关档位必须移除");
  expect(src.includes("默认档不发送 reasoning_effort"), "default 档位语义要有提示文案");
  const page = read("src/pages/playground.tsx");
  includesAll(page, ["normalizeDeclaredDefault", "modelInfo={activeModelInfo}"], "页面必须把模型能力传给对话框并按声明默认档初始化");
});

check("上游模型编辑器：思考档位集合与默认档声明控件就位", () => {
  const src = read("src/components/models/upstream-model-drawer.tsx");
  includesAll(
    src,
    ["REASONING_LEVELS", "reasoning_levels", "default_reasoning_level"],
    "上游模型编辑器必须能声明档位集合与默认档",
  );
  expect(src.includes('placeholder="留空 = 不声明"') === false, "推理档位自由文本输入必须移除（改为声明档位集合）");
});

// ---------- 六期：模型试验输出参数真实转发（W6 ticket 19）----------
// stop 解析与上限口径是纯函数，SSR 加载真实实现断言行为；面板控件用 SSR
// 渲染断言 DOM。前后端转发白名单同源：后端由 pytest 的 stub 上游实测钉住，
// 这里钉前端发送面，两边期望列表都来自票 19 的契约。

check("stop 解析：逗号拆分保序去空，旧换行输入折算成同一语义（一次性迁移）", async () => {
  const { parseStopSequences } = await load("/src/lib/playground.ts");
  expect(
    JSON.stringify(parseStopSequences("a, b , c")) === JSON.stringify(["a", "b", "c"]),
    "逗号拆分、逐项 trim、保序",
  );
  expect(
    JSON.stringify(parseStopSequences("a\nb")) === JSON.stringify(["a", "b"]),
    "旧换行输入必须折算成逗号语义（票19 一次性迁移）",
  );
  expect(
    JSON.stringify(parseStopSequences("a,\nb,c")) === JSON.stringify(["a", "b", "c"]),
    "逗号与换行混合时同属分隔符",
  );
  expect(
    parseStopSequences("").length === 0 && parseStopSequences(undefined).length === 0,
    "空输入不发 stop",
  );
  expect(
    JSON.stringify(parseStopSequences("a,,b")) === JSON.stringify(["a", "b"]),
    "空项不进请求体（校验层负责提示）",
  );
});

check("stop 行内校验：超 4 条与空条目各自有提示，正常输入放行", async () => {
  const { validateChatParams } = await load("/src/lib/playground.ts");
  const { EMPTY_PLAYGROUND_PARAMS } = await load("/src/lib/playground-params.ts");
  const base = { ...EMPTY_PLAYGROUND_PARAMS };
  const over = validateChatParams({ ...base, stop: "a,b,c,d,e" });
  expect(over.valid === false, "5 条必须拦截");
  expect((over.message ?? "").includes("4"), "超限提示必须说明 4 条上限");
  const empty = validateChatParams({ ...base, stop: "a,,b" });
  expect(empty.valid === false, "空条目必须拦截");
  expect((empty.message ?? "").includes("空"), "空条目提示必须说明空条目");
  const trailing = validateChatParams({ ...base, stop: "a,b," });
  expect(trailing.valid === false, "尾逗号产生的空条目同样拦截");
  const ok = validateChatParams({ ...base, stop: "a, b, c, d" });
  expect(ok.valid === true, "恰好 4 条合法输入必须放行");
  const newline = validateChatParams({ ...base, stop: "a\nb\nc\nd" });
  expect(newline.valid === true, "旧换行输入折算后同样放行");
  expect(
    validateChatParams({ ...base, stop: "a,b,c,d,e\n" }).valid === false,
    "换行折算后超限仍然拦截",
  );
});

check("输出上限：登记值优先，未登记回退安全默认 32768", async () => {
  const { maxOutputTokensFor, validateChatParams, DEFAULT_MAX_OUTPUT_TOKENS } = await load(
    "/src/lib/playground.ts",
  );
  const { EMPTY_PLAYGROUND_PARAMS } = await load("/src/lib/playground-params.ts");
  expect(maxOutputTokensFor(128000) === 128000, "登记值直接采用");
  expect(maxOutputTokensFor(0) === DEFAULT_MAX_OUTPUT_TOKENS, "0 = 未声明，回退默认");
  expect(
    maxOutputTokensFor(null) === DEFAULT_MAX_OUTPUT_TOKENS &&
      maxOutputTokensFor(undefined) === DEFAULT_MAX_OUTPUT_TOKENS,
    "无能力数据回退默认",
  );
  const registered = validateChatParams(
    { ...EMPTY_PLAYGROUND_PARAMS, maxTokens: "128000" },
    { maxOutputTokens: 128000 },
  );
  expect(registered.valid === true, "登记上限内的值放行");
  const over = validateChatParams(
    { ...EMPTY_PLAYGROUND_PARAMS, maxTokens: "128001" },
    { maxOutputTokens: 128000 },
  );
  expect(over.valid === false, "超登记上限拦截");
  const fallbackOk = validateChatParams(
    { ...EMPTY_PLAYGROUND_PARAMS, maxTokens: "32768" },
    { maxOutputTokens: null },
  );
  expect(fallbackOk.valid === true, "无登记数据时安全默认内的值放行");
  const fallbackOver = validateChatParams(
    { ...EMPTY_PLAYGROUND_PARAMS, maxTokens: "32769" },
    { maxOutputTokens: null },
  );
  expect(fallbackOver.valid === false, "无登记数据时按安全默认拦截");
  expect(
    validateChatParams(
      { ...EMPTY_PLAYGROUND_PARAMS, maxCompletionTokens: "128001" },
      { maxOutputTokens: 128000 },
    ).valid === false,
    "max_completion_tokens 同受登记上限约束",
  );
});

check("参数面板：stop 单行 input、上限回退如实标注（SSR 渲染）", async () => {
  const { ParamsPanel } = await load("/src/components/playground/params-panel.tsx");
  const { EMPTY_PLAYGROUND_PARAMS } = await load("/src/lib/playground-params.ts");
  const props = (modelInfo) => ({
    value: { ...EMPTY_PLAYGROUND_PARAMS },
    onChange: () => {},
    disabled: false,
    mockMode: false,
    onOpenModels: () => {},
    modelInfo,
  });
  const src = read("src/components/playground/params-panel.tsx");
  expect(!src.includes("每行一条"), "stop 的每行一条文案必须移除（改为逗号分隔）");
  expect(src.includes("逗号分隔"), "stop 占位与文案必须是逗号分隔语义");
  const html = render(createElement(ParamsPanel, props(null)));
  expect(html.includes('id="playground-stop"'), "stop 字段保留原 id");
  expect(!/<textarea[^>]*id="playground-stop"/.test(html), "stop 必须是单行 input，不再是多行 textarea");
  expect(html.includes("未登记"), "无能力数据时必须如实标注上限回退");
  const registeredHtml = render(createElement(ParamsPanel, props(t18ChatInfo())));
  expect(!registeredHtml.includes("未登记"), "已登记上限时不显示回退标注");
  expect(
    src.includes("maxOutputTokensFor(modelInfo?.parameters.max_output_tokens)"),
    "面板上限必须取所选模型登记值（不得再传 null）",
  );
});

check("发送路径：页面校验用所选模型登记值，面板说明与控制面转发范围一致", () => {
  const page = read("src/pages/playground.tsx");
  includesAll(
    page,
    ["maxOutputTokens: activeModelInfo?.parameters.max_output_tokens"],
    "发送前校验的上限必须来自所选模型登记值",
  );
  expect(!page.includes("maxOutputTokens: DEFAULT_MAX_OUTPUT_TOKENS"), "不得再写死默认上限");
  const panel = read("src/components/playground/params-panel.tsx");
  expect(
    panel.includes("控制面透传") && !panel.includes("待数据面支持后生效"),
    "面板说明必须反映票19 之后控制面已透传全部参数的现状",
  );
  const lib = read("src/lib/playground.ts");
  includesAll(
    lib,
    ["body.extra_fields = params.extraFields"],
    "额外字段必须整包随 extra_fields 上行，由控制面合并（拍平进顶层会被 schema 丢弃）",
  );
  expect(!lib.includes("RESERVED_BODY_KEYS"), "保留键裁决已收敛到后端 relay，前端不得再有一份平行名单");
  includesAll(
    lib,
    [
      '"temperature"',
      '"top_p"',
      '"top_k"',
      '"frequency_penalty"',
      '"presence_penalty"',
      '"seed"',
      '"max_tokens"',
      '"max_completion_tokens"',
      '"stop"',
      '"n"',
      '"response_format"',
      '"logprobs"',
      '"top_logprobs"',
      '"user"',
      '"reasoning_effort"',
    ],
    "前端发送白名单必须覆盖后端 schema/relay 的全部标准参数（后端由 pytest 钉住）",
  );
});

// ---------- 九、公开模型编辑页紧凑布局与脏标记（W6 ticket 14）----------
check("公开模型紧凑布局：基本信息三列、策略三张横向卡片", () => {
  const page = read("src/components/models/public-model-page.tsx");
  // 基本信息三列（名称/备注/启用）：桌面 md 三列，窄屏单列堆叠；策略不再混进基本信息。
  includesAll(
    page,
    ['data-slot="basic-fields-grid"', "grid grid-cols-1", "md:grid-cols-3", 'data-slot="field-name"', 'data-slot="field-note"', 'data-slot="field-enabled"'],
    "基本信息三列",
  );
  // 策略三张横向卡片：三种模式一排可比较，窄屏堆叠。
  includesAll(page, ['data-slot="strategy-cards"', "md:grid-cols-3", 'data-slot="strategy-card"'], "策略三横卡");
  const dirty = read("src/components/ui/dirty-field.tsx");
  expect(!dirty.includes("pl-2.5"), "脏字段不得再加左 padding（pl-2.5 会改变字段宽度）");
});

check("公开模型页头保存：保存/状态/未保存数量固定页头、只读摘要折叠、脏标记绝对定位", () => {
  const page = read("src/components/models/public-model-page.tsx");
  includesAll(
    page,
    ["sticky top-0", 'data-slot="header-save"', "DirtySummary", "DirtyCountBadge", "DirtySaveButton", 'data-slot="readonly-summary"', "<details"],
    "页头保存与只读摘要折叠",
  );
  expect(!page.includes("DirtyFooter"), "保存动作条已上移页头，公开模型页不得再渲染底部 DirtyFooter");
  // DirtyField（W7 ticket 12 收口）：去掉左侧 2px 警示线，变脏只换浅黄背景；
  // 标记槽绝对定位不占布局（不插下方行、不加左 padding）。
  const dirty = read("src/components/ui/dirty-field.tsx");
  includesAll(
    dirty,
    ['data-slot="dirty-marker"', "absolute", "bg-warning-soft", "已修改", "恢复"],
    "绝对定位标记槽与文字/图标信号",
  );
  expect(!dirty.includes("dirty-bar"), "脏字段不得再渲染左侧警示线 dirty-bar（W7 ticket 12 A 方案）");
  expect(!/inset-y-0 left-0|w-0\.5/.test(dirty), "不得用绝对定位竖条变相恢复左侧警示线");
  expect(!/\bmt-0\.5\b/.test(dirty), "标记槽不得用文档流 margin（插行会推挤布局）");
  // PageHeader（W7 ticket 12 预置回归）：说明行与 actions 行解耦——说明列宽不再
  // 随 actions 变化，脏态徽章变宽不得把说明挤到折行（页头高度必须稳定）。
  const header = read("src/components/layout/page-header.tsx");
  includesAll(header, ['data-slot="page-head-row"', "text-pretty", "max-w-[76ch]"], "页头标题行与说明行");
  expect(
    header.indexOf('data-slot="page-head-row"') !== -1
      && header.lastIndexOf("text-pretty") > header.indexOf('data-slot="page-head-row"'),
    "说明必须在 page-head-row 之后独立成行（与 actions 宽度解耦）",
  );
  expect(!header.includes("flex flex-wrap items-end justify-between gap-3"), "不得恢复说明与 actions 同行互斥占宽的旧布局");
});

check("成员编排容器：桌面左6右6栅格、两栏 min(60vh,560px) 内部滚动、列头固定", () => {
  const flow = read("src/components/models/member-chip-flow.tsx");
  includesAll(
    flow,
    [
      'data-slot="member-board-grid"',
      "lg:grid-cols-12",
      'data-slot="member-board-left"',
      'data-slot="member-board-right"',
      "lg:col-span-6",
      'data-slot="member-column-head"',
      'data-slot="member-scroll"',
      "max-h-[min(60vh,560px)]",
      "overflow-y-auto",
    ],
    "成员编排两栏容器",
  );
});

// ---------- 十、公开模型成员编排行内编辑与分组候选（W6 ticket 15）----------
check("成员编排行内编辑：行内字段按策略收敛、候选按上游分组 chip、搜索固定滚动区外", () => {
  const flow = read("src/components/models/member-chip-flow.tsx");
  // 行内编辑：priority 常驻；weight 仅 weighted、when 仅 conditional——其余模式的字段
  // 完全不渲染（不是 disabled 摆着误导），票15 的核心契约。
  includesAll(
    flow,
    ['data-slot="member-row"', 'aria-label="priority"', 'aria-label="weight"', 'aria-label="when"', 'data-slot="member-row-remove"'],
    "行内编辑行",
  );
  expect(!flow.includes("@/components/ui/combobox"), "候选区不得再用 Combobox 单控件（票15 换按上游分组 chip）");
  expect(!flow.includes("MemberChipEditor"), "行内编辑直接落在成员行上，不得保留点击展开式编辑器");
  // 候选：按上游渠道分组渲染（candidateGroups + filterCandidateGroups 复用），chip 点击即加入。
  includesAll(
    flow,
    ["candidateGroups(", "filterCandidateGroups(", 'data-slot="member-candidate-group"', 'data-slot="member-candidate-chip"', "加入成员"],
    "候选分组 chip",
  );
  // 搜索框固定在滚动区外：右栏里搜索框必须出现在 member-scroll 之前（列头槽位）。
  const right = flow.slice(flow.indexOf('data-slot="member-board-right"'));
  const searchAt = right.indexOf('aria-label="搜索上游渠道或模型"');
  const scrollAt = right.indexOf('data-slot="member-scroll"');
  expect(searchAt >= 0 && scrollAt > searchAt, "候选搜索框必须渲染在 member-scroll 之前（固定在滚动区外）");
  // 大列表：候选超预算截断渲染并提供「展开全部」，避免上千模型把页面拉到无限长。
  includesAll(flow, ["CANDIDATE_CHIP_BUDGET", "展开全部"], "大列表预算截断");
});

// ---------- W7 ticket 05：已选成员表格化（输入前置 + chevron 展开 + 候选原位 + 列头对齐）----------
check("成员表格（W7 票05）：输入前置表头按策略收敛、行内 chevron、候选原位双态、列头对齐槽位", async () => {
  const flowView = await load("/src/components/models/member-chip-flow.tsx");
  const upstreamModels = [
    { id: "um_01", upstream_id: "up_01", name: "glm-5.3", upstream_name: "zai-01", model_type: "chat", enabled: true, created_at_ms: 0 },
    { id: "um_02", upstream_id: "up_01", name: "glm-5.3-flash", upstream_name: "zai-01", model_type: "chat", enabled: true, created_at_ms: 0 },
    { id: "um_03", upstream_id: "up_01", name: "glm-4.6", upstream_name: "zai-01", model_type: "chat", enabled: true, created_at_ms: 0 },
  ];
  const members = [
    { upstream_model_id: "um_01", priority: "1", weight: "2", when: "" },
    { upstream_model_id: "um_02", priority: "2", weight: "1", when: "" },
  ];
  const renderMode = (mode) =>
    render(createElement(flowView.MemberChipFlow, { members, upstreamModels, fallbackNames: new Map(), mode, onChange: () => {} }));
  const failover = renderMode("failover");
  const weighted = renderMode("weighted");
  const conditional = renderMode("conditional");
  // 表头按策略收敛且输入前置：展开/优先级在最左，成员信息靠后；字段按当前策略出现。
  includesAll(failover, ["展开", "优先级", "成员 / 上游"], "failover 表头");
  expect(!failover.includes("权重") && !failover.includes("表达式"), "failover 不得出现权重/表达式表头");
  includesAll(weighted, ["权重"], "weighted 表头出现中文「权重」");
  includesAll(conditional, ["表达式"], "conditional 表头出现中文「表达式」");
  // 每行显式展开控件（chevron），展开态由 aria-expanded 表达。
  expect((failover.match(/data-slot="member-row-expand"/g) ?? []).length === 2, "每行一个展开 chevron");
  expect(failover.includes('aria-expanded="false"'), "chevron 必须 aria-expanded 标记展开态");
  expect(failover.includes('data-slot="member-row-detail"') === false, "收起态不得渲染展开区");
  // 候选原位双态：全量渲染，已选灰显（data-selected）+ ×（aria-label 变取消选择）。
  expect((failover.match(/data-slot="member-candidate-chip"/g) ?? []).length === 3, "候选全量原位渲染");
  expect((failover.match(/data-selected="true"/g) ?? []).length === 2, "已选候选必须灰显标记");
  includesAll(failover, ["取消选择成员 zai-01/glm-5.3", "加入成员 zai-01/glm-4.6", 'aria-pressed="true"', 'aria-pressed="false"'], "候选灰显双态");
  // 左右两栏对齐槽位：左表格表头与右候选表头都固定在列头行（h-9）之后，y 对齐由浏览器验收断言。
  includesAll(failover, ['data-slot="member-column-head"', 'data-slot="member-table-head"', 'data-slot="member-candidate-head"'], "列头对齐槽位");
});

// ---------- 十一、通知中心紧凑布局与密钥弹窗二元按钮（W6 ticket 13）----------
// 行结构与 hover 详情是真实渲染面：NotificationRow 与 BrandLockup 同惯例导出，
// SSR 渲染真实 DOM 断言；面板容器走 Radix Portal（SSR 不落 DOM），宽度约束按
// 源码契约钉住，窄屏行为由 responsive_matrix 的 notification.375 专项兜住。
const t13Notification = (overrides) => ({
  id: "matrix-1",
  kind: "error",
  title: "查询失败",
  description: "INTERNAL_ERROR：矩阵模拟上游 5xx 的超长正文，用于验证单行省略与 hover 完整详情可达",
  at: Date.UTC(2026, 10, 21, 9, 30, 0),
  read: true,
  ...overrides,
});

check("通知行：时间在标题行尾（time[datetime]）、图标与标题垂直居中、正文单行省略", async () => {
  const { NotificationRow } = await load("/src/components/layout/notification-center.tsx");
  const html = render(createElement(NotificationRow, { item: t13Notification() }));
  expect(/<time[^>]+datetime="2026-11-21T/i.test(html), "时间必须是带 datetime 的 time 元素（机器可读）");
  // 时间在标题行尾：DOM 顺序 title → time → 正文（li 的 title 属性也含全文，所以按元素锚点定序）。
  const titleAt = html.indexOf('data-slot="notification-title"');
  const timeAt = html.indexOf('data-slot="notification-time"');
  const descAt = html.indexOf('data-slot="notification-desc"');
  expect(titleAt >= 0 && timeAt > titleAt && descAt > timeAt, "时间必须在标题行内（title 元素之后、正文元素之前）");
  const headTag = html.match(/<div[^>]*data-slot="notification-head"[^>]*>/)?.[0] ?? "";
  expect(headTag.includes("flex items-center justify-between"), "标题行必须 flex items-center justify-between（时间行尾对齐）");
  const timeTag = html.match(/<time[^>]*data-slot="notification-time"[^>]*>/)?.[0] ?? "";
  expect(timeTag.includes("shrink-0"), "时间必须 shrink-0，不得被长标题挤压换行");
  // 图标垂直居中：16px 图标对 20px 标题行高（text-2sm），mt-0.5 = (20-16)/2 恰好居中。
  expect(/mt-0\.5 h-4 w-4/.test(html), "图标必须 mt-0.5 + h-4 w-4（对 20px 标题行高垂直居中）");
  // 正文单行省略：truncate 且不得再有 line-clamp-2。
  const descTag = html.match(/<p[^>]*data-slot="notification-desc"[^>]*>/)?.[0] ?? "";
  expect(descTag.includes("truncate"), "正文必须单行 truncate");
  expect(!html.includes("line-clamp"), "正文不得再 line-clamp-2（紧凑布局契约）");
  // hover 完整详情：行 title 属性 = 标题 + 正文全文（原生 tooltip 的输入）。
  expect(
    /title="查询失败：INTERNAL_ERROR：矩阵模拟上游 5xx[^"]*"/.test(html),
    "行必须带完整详情 title 属性（hover 可读全文）",
  );
});

check("通知行：无正文时 hover 详情只有标题；面板窄屏宽度约束在位（票09 补断言）", async () => {
  const { NotificationRow } = await load("/src/components/layout/notification-center.tsx");
  const html = render(
    createElement(NotificationRow, { item: t13Notification({ kind: "success", description: undefined }) }),
  );
  expect(/title="查询失败"/.test(html), "无正文时行 title 仍要有标题详情");
  expect(!html.includes('data-slot="notification-desc"'), "无正文不得渲染空正文行");
  const centerSrc = read("src/components/layout/notification-center.tsx");
  expect(
    centerSrc.includes("w-[min(20rem,calc(100vw-2rem))]"),
    "面板必须保留票09 的 min(20rem, 100vw-2rem) 宽度约束（窄屏占满可用宽度）",
  );
});

check("密钥弹窗：只有复制与关闭两个同尺寸按钮，复制反馈为已复制", () => {
  const src = read("src/components/users/one-time-secret-dialog.tsx");
  // Radix Dialog 走 Portal，SSR 不落 DOM（同 model-dialog 先例）：按源码契约钉住。
  expect((src.match(/<Button/g) ?? []).length === 2, "弹窗 footer 只能有复制与关闭两个按钮");
  expect(!src.includes("再次复制") && !src.includes("showRecopy"), "同义的「再次复制」必须移除（与「复制」同动作同入口）");
  expect(!/\bsize=/.test(src), "复制与关闭必须同尺寸（默认 h-10，不得一个 sm 一个 default）");
  expect(/<Button[^>]*>\s*复制\s*<\/Button>/.test(src), "缺少复制按钮（主操作，default 尺寸）");
  expect(/<Button[^>]*>\s*关闭\s*<\/Button>/.test(src), "缺少关闭按钮（ghost 变体，default 尺寸）");
  expect(src.includes('toast.success("已复制")'), "复制成功文案必须是「已复制」");
  expect(!src.includes("useState"), "关闭即失效：弹窗不得在前端缓存明文");
  const clientKeys = read("src/pages/client_keys.tsx");
  expect(!clientKeys.includes("showRecopy"), "调用方不得再传 showRecopy");
});

// ---------- 十二、登录页视觉与自适应（W6 ticket 12）----------
// 登录页是未登录用户看到的第一个界面：三态主题、渐变背景、密码显隐、错误零位移、
// 三档宽度都钉在这里。SSR 渲染真实 LoginPage（useQuery 失败回落表单，正好是登录态），
// 通知中心推送等无法 SSR 的契约用源码接线断言兜底。
const renderLogin = async () => {
  const { LoginPage } = await load("/src/pages/login.tsx");
  const { AUTH_ME_QUERY_KEY } = await load("/src/lib/auth.ts");
  // 共享 queryClient 在前面的 KPI 检查里可能已缓存 me：登录页拿到 me.data 会渲染
  // <Navigate> 而不是表单，先清掉再渲染，保证落到登录表单分支。
  queryClient.removeQueries({ queryKey: AUTH_ME_QUERY_KEY });
  return render(createElement(LoginPage));
};

/** 从源码里截出 data-slot 元素的开标签，断言类与属性走的是同一处声明。 */
const loginTagOf = (source, slot) => {
  const at = source.indexOf('data-slot="' + slot + '"');
  expect(at >= 0, "登录页缺少 data-slot=" + slot);
  return source.slice(at, source.indexOf(">", at) + 1);
};

check("登录页：可见但克制的多层柔光渐变——login-gradient 工具类就位、纯静态、单层强度受控", () => {
  const css = read("src/index.css");
  expect(css.includes("@utility login-gradient"), "index.css 必须定义 @utility login-gradient");
  const start = css.indexOf("@utility login-gradient");
  const block = css.slice(start, css.indexOf("}", start) + 1);
  expect(block.includes("gradient("), "login-gradient 必须是渐变背景（不是纯色）");
  expect(block.includes("color-mix(in oklab"), "渐变必须用 color-mix 半透明混合（低饱和，不遮正文）");
  expect(block.includes("var(--"), "渐变色必须走语义 token，明暗主题自适应");
  expect(!/animation|animate|@keyframes/.test(block), "login-gradient 必须静态：不得含 animation/keyframes（票12：静态不动画）");
  // W7 票13：多层柔光——至少三层 radial 色场，单层混合强度受上限约束（克制、低饱和）。
  const layerSegments = block.split(/(?=(?:radial|linear|conic)-gradient\()/g).filter((part) => /gradient\(/.test(part));
  const radialSegments = layerSegments.filter((part) => part.startsWith("radial-gradient("));
  expect(radialSegments.length >= 3, "login-gradient 至少要 3 层 radial-gradient 柔光色场，实际 " + radialSegments.length);
  for (const segment of radialSegments) {
    const mixes = [...segment.matchAll(/color-mix\(in oklab, var\(--[\w-]+\) (\d+)%, transparent\)/g)].map((m) => Number(m[1]));
    expect(mixes.length >= 1, "色场层必须用 color-mix 走语义 token 混色：" + segment.trim());
    for (const percent of mixes) {
      expect(percent <= 22, "单层色场强度 " + percent + "% 超过 22% 上限（低饱和、克制、不压正文）：" + segment.trim());
    }
  }
  const page = read("src/pages/login.tsx");
  expect(page.includes("login-gradient"), "登录页根容器必须使用 login-gradient");
  expect(!page.includes("animate-"), "登录页不得使用任何 animate-* 动效类（背景静态）");
  // 浏览器验收按 data-slot 选根容器（不以类名存在为准）：截图取样与计算样式落到同一元素。
  expect(page.includes('data-slot="login-root"'), "登录页根容器必须带 data-slot=login-root（浏览器验收按槽位取样）");
});

check("登录页：三态主题复用全站 useTheme——不另起 theme 存储，选项带 aria-pressed", async () => {
  const page = read("src/pages/login.tsx");
  expect(page.includes('from "@/lib/theme"'), "登录页必须复用 @/lib/theme 的 useTheme（全站同一份主题状态与持久化）");
  expect(!page.includes("localStorage"), "登录页不得直接读写 localStorage（主题持久化归 lib/theme 单一来源）");
  expect(!page.includes("slipstream.theme"), "登录页不得私存主题 key（与 index.html 反闪烁脚本/lib/theme 同源）");
  const html = await renderLogin();
  expect(html.includes('data-slot="login-theme"'), "登录页必须渲染三态主题切换器（login-theme）");
  for (const name of ["浅色", "深色", "跟随系统"]) {
    expect(html.includes('aria-label="' + name + '"'), "主题切换器缺少选项：" + name);
  }
  expect((html.match(/aria-pressed="/g) ?? []).length >= 3, "三态选项必须带 aria-pressed 可访问状态");
});

check("登录页：密码显隐切换——Eye/EyeOff 图标按钮带 aria-pressed 与槽位", async () => {
  const page = read("src/pages/login.tsx");
  expect(/import\s*\{[^}]*\bEye\b/.test(page) && page.includes("EyeOff"), "登录页必须用 lucide Eye/EyeOff 图标做显隐切换");
  const html = await renderLogin();
  expect(html.includes('type="password"'), "密码框默认隐藏（type=password）");
  expect(html.includes('data-slot="login-password-toggle"'), "显隐按钮必须带 login-password-toggle 槽位");
  expect(html.includes('aria-label="显示密码"'), "显隐按钮默认可访问名必须是「显示密码」");
  expect(html.includes('aria-label="隐藏密码"') === false, "默认态不得泄漏显示态可访问名（aria-label 随状态切换）");
  expect(html.includes('aria-pressed="false"'), "显隐按钮必须带 aria-pressed 初始态（false）");
  expect(page.includes("aria-pressed={showPassword}"), "显隐按钮必须接线 aria-pressed={showPassword}（可访问状态）");
  expect(page.includes('showPassword ? "隐藏密码" : "显示密码"'), "可访问名必须随显隐状态切换");
});

check("登录页：错误区固定预留高度——字段 aria-invalid 标红、详情进通知中心", () => {
  const page = read("src/pages/login.tsx");
  const errorTag = loginTagOf(page, "login-error");
  expect(/\bh-10\b/.test(errorTag), "错误区必须固定 h-10 高度（错误出现时按钮零位移，user story 50）");
  expect(errorTag.includes('aria-live="polite"'), "错误区必须 aria-live=polite（出现时播报，不抢焦点）");
  expect((page.match(/aria-invalid=\{Boolean\(error\)\}/g) ?? []).length >= 2, "用户名与密码两个输入都必须接线 aria-invalid={Boolean(error)}");
  expect(page.includes("border-danger"), "出错字段必须有 danger 红边（border-danger）");
  expect(page.includes("pushErrorNotificationOnce"), "登录失败详情必须进通知中心（复用票07 pushErrorNotificationOnce）");
  expect(page.includes('from "@/lib/notification-store"'), "通知推送必须走 lib/notification-store 单一来源（不另起通知通道）");
});

check("登录页：底部提示区预留固定空间——单行省略、hover 显示完整详情", () => {
  const page = read("src/pages/login.tsx");
  const hintTag = loginTagOf(page, "login-hint");
  expect(hintTag.includes("title="), "提示区必须带 title 展示完整详情（hover 可读）");
  expect(/\btruncate\b/.test(hintTag), "提示区必须 truncate 超长省略（不换行推挤）");
  expect(/\bh-5\b/.test(hintTag), "提示区必须预留固定 h-5 高度（不随文案增减位移）");
});

check("登录页：登录框三档宽度 384/460/576（1x/1.2x/1.5x）+ 矮视口压缩契约", () => {
  const page = read("src/pages/login.tsx");
  includesAll(page, ["max-w-[384px]", "md:max-w-[460px]", "2xl:max-w-[576px]"], "登录框三档宽度（user story 32）");
  const css = read("src/index.css");
  expect(css.includes("@media (max-height: 480px)"), "index.css 必须有矮视口压缩规则（667×375 横屏提交按钮免滚可见，user story 33）");
  const mediaStart = css.indexOf("@media (max-height: 480px)");
  const mediaBlock = css.slice(mediaStart, css.indexOf("}", mediaStart) + 1);
  expect(mediaBlock.includes("login-landscape-hide"), "矮视口规则必须隐藏登录页装饰行（login-landscape-hide）");
  expect(page.includes("login-landscape-hide"), "登录页装饰行必须挂 login-landscape-hide（横屏压缩）");
});

check("登录页 SSR：渐变根容器、三档宽度列、错误区/提示区始终渲染（预留空间）", async () => {
  const html = await renderLogin();
  expect(html.includes("login-gradient"), "登录页根容器必须有 login-gradient");
  expect(
    html.includes("max-w-[384px]") && html.includes("md:max-w-[460px]") && html.includes("2xl:max-w-[576px]"),
    "登录框列必须带三档宽度类（渲染输出可见，不只源码声明）",
  );
  expect(html.includes('data-slot="login-error"') && html.includes('data-slot="login-hint"'), "错误区与底部提示区必须始终渲染（无错误时也占位）");
});

// ---------- 10. 统一悬浮详情 HoverInfo（W7 ticket 08） ----------
// spec「交互与界面-参数」：hover / 键盘 focus / 触屏轻点三路打开同一内容；portal 到页面顶层；
// 视口碰撞自动翻转/收拢；有可访问名称；禁用与空值是稳定态；关闭后焦点回到触发元素。
check("HoverInfo：触发元素带槽位、可聚焦，浮层内容走 Portal 不落 SSR DOM", async () => {
  const { HoverInfo } = await load("/src/components/ui/hover-info.tsx");
  const html = render(
    createElement(HoverInfo, { content: "完整参数说明" }, createElement("span", null, "输入 128,000")),
  );
  expect(html.includes('data-hover-info="trigger"'), "触发元素必须带 data-hover-info=trigger（不覆盖调用方的 data-slot）");
  expect(html.includes("输入 128,000"), "触发元素自身内容必须渲染");
  expect(html.includes('tabindex="0"'), "触发元素必须可聚焦（键盘用户要能读到详情）");
  expect(!html.includes("完整参数说明"), "浮层内容必须走 Portal（SSR 不落 DOM）");
});

check("HoverInfo：显式 label 变成触发元素的可访问名称", async () => {
  const { HoverInfo } = await load("/src/components/ui/hover-info.tsx");
  const html = render(
    createElement(
      HoverInfo,
      { content: "已关闭，人工启用后恢复", label: "查看模型状态" },
      createElement("span", null, "关闭"),
    ),
  );
  expect(html.includes('aria-label="查看模型状态"'), "显式 label 必须写进触发元素的 aria-label");
});

check("HoverInfo：源码契约——Portal 到 body、hover 250ms 延迟、碰撞翻转与收拢", () => {
  const src = read("src/components/ui/hover-info.tsx");
  includesAll(src, ["createPortal", "document.body"], "浮层 Portal 挂载点");
  expect(/HOVER_INFO_DELAY_MS\s*=\s*250/.test(src), "hover 打开延时常量必须是 250ms");
  includesAll(
    src,
    ['role="tooltip"', "getBoundingClientRect", "innerWidth", "innerHeight"],
    "浮层定位与视口碰撞处理",
  );
  includesAll(src, ["maxHeight", "overflow"], "视口放不下时必须收拢（限高 + 滚动）");
});

check("接线：指标卡说明文字改用 HoverInfo（原生 title 换成可聚焦的悬浮详情）", () => {
  const src = read("src/components/stat-card.tsx");
  expect(src.includes("HoverInfo"), "指标卡说明文字必须走统一悬浮详情原语");
  expect(!src.includes("title={hint}"), "指标卡说明文字不得再用原生 title（键盘与触屏读不到）");
});

// ---------- 11. 模型参数列与悬浮详情（W7 ticket 09） ----------
// spec User Story 36/37 + Implementation Decisions「交互与界面-参数」：
// 参数列只显示输入/输出上限（千分位），其余参数进统一 HoverInfo；缺失值写「未配置」；
// 正常值不加提示图标；模型管理页与上游详情页两处模型表同一口径。
check("模型参数列：只显示「输入 xxx / 输出 xxx」，缺失值写「未配置」，不加提示图标", async () => {
  const { ModelParamsCell } = await load("/src/components/models/model-params-cell.tsx");
  const html = render(
    createElement(ModelParamsCell, {
      row: { parameters: { max_input_tokens: 200000, max_output_tokens: 128000 } },
    }),
  );
  expect(html.includes("输入 200,000 / 输出 128,000"), "参数列必须只显示输入/输出上限（千分位）");
  expect(html.includes('data-hover-info="trigger"'), "参数列必须挂统一悬浮详情触发元素");
  expect(!html.includes("<svg"), "正常值不得加提示图标（每行一个图标就是噪音）");
  const missing = render(
    createElement(ModelParamsCell, { row: { parameters: { max_input_tokens: 0, max_output_tokens: 0 } } }),
  );
  expect(missing.includes("输入 未配置 / 输出 未配置"), "缺失值必须有明确说明「未配置」");
  expect(!missing.includes("<input"), "缺失值不得渲染成输入框式占位");
});

check("模型参数明细：完整参数（上下文/模态/能力/思考档位）进悬浮详情，缺失值同样写明", async () => {
  const { parameterDetailRows } = await load("/src/components/models/model-vocab.ts");
  const rows = parameterDetailRows({
    parameters: {
      max_input_tokens: 200000,
      max_output_tokens: 128000,
      reasoning_level: "high",
      reasoning_levels: ["low", "medium", "high"],
      default_reasoning_level: "medium",
      input_types: ["text", "image"],
      output_types: ["text"],
      tool_call: true,
      reasoning: true,
      attachment: false,
      structured_output: true,
    },
  });
  const labels = rows.map((row) => row.label);
  includesAll(labels.join("、"), ["最大输入词元", "最大输出词元", "输入类型", "输出类型", "能力", "推理档位", "思考档位"], "明细字段");
  const value = (label) => (rows.find((row) => row.label === label) || {}).value;
  expect(value("最大输入词元") === "200,000", "输入上限要带千分位");
  expect(value("最大输出词元") === "128,000", "输出上限要带千分位");
  expect(value("输入类型") === "text / image", "模态要按现有数据字段逐项列出");
  expect(value("能力") === "工具调用 / 推理 / 结构化输出", "能力只列已开启项");
  expect(!value("能力").includes("附件"), "未开启的能力不得出现在详情里");
  expect(value("思考档位") === "low / medium / high（默认 medium）", "思考档位与默认档位要如实透出");
  const blank = parameterDetailRows({ parameters: { max_input_tokens: 0, max_output_tokens: 0 } });
  const blankValue = (label) => (blank.find((row) => row.label === label) || {}).value;
  expect(blankValue("最大输入词元") === "未配置", "详情里缺失的上限也要说明「未配置」");
  expect(blankValue("最大输出词元") === "未配置", "详情里缺失的上限也要说明「未配置」");
  expect(blankValue("推理档位") === "未配置", "详情里缺失的档位也要说明「未配置」");
  expect(blankValue("能力") === "无", "一项能力都没开时写「无」，不留空");
});

check("接线：两处模型表同一参数列口径，旧的堆叠摘要下线", () => {
  const models = read("src/pages/models.tsx");
  const panel = read("src/components/upstreams/models-panel.tsx");
  includesAll(models, ["ModelParamsCell"], "模型管理页参数列");
  includesAll(panel, ["ModelParamsCell"], "上游详情模型表参数列");
  expect(!models.includes("parameterSummary"), "模型管理页不得再用旧的堆叠摘要");
  expect(!panel.includes("parameterSummary"), "上游详情模型表不得再用旧的堆叠摘要");
  const vocab = read("src/components/models/model-vocab.ts");
  expect(!vocab.includes("export function parameterSummary"), "旧的堆叠摘要函数必须下线（否则两套口径并存）");
  expect(models.includes('label: "参数"'), "模型管理页参数列表头必须是「参数」");
  expect(panel.includes('header: "参数"'), "上游详情模型表参数列表头必须是「参数」");
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
