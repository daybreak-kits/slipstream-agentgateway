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

check("index.css：字号四档 + metric 19 + h1 22（修正 metric > h1 反转）", () => {
  const css = read("src/index.css");
  includesAll(css, [
    "--text-2xs: 11px;", "--text-2xs--line-height: 16px;",
    "--text-2sm: 13px;", "--text-2sm--line-height: 20px;",
    "--text-metric: 19px;", "--text-metric--line-height: 26px;",
    "--text-h1: 22px;", "--text-h1--line-height: 28px;",
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

check("BrandLockup：两行品牌锁（驭流 14/600 + SLIPSTREAM 11/500 大写 0.16em）+ logo 36", async () => {
  const { BrandLockup } = await load("/src/components/layout/sidebar.tsx");
  const html = render(createElement(BrandLockup, { collapsed: false }));
  expect(html.includes("/logo-v10-contrast.svg"), "logo 必须用产品内主用文件 logo-v10-contrast.svg");
  expect(/alt=""/.test(html), "logo 是装饰性图片，alt 必须为空");
  expect(/aria-hidden="true"/.test(html), "logo 必须 aria-hidden");
  expect(html.includes("h-9 w-9"), "logo 必须是 36×36（h-9 w-9）");
  expect(html.includes("驭流"), "第一行中文名缺失");
  expect(html.includes(">Slipstream<"), "第二行英文名缺失（文本内容为 Slipstream）");
  expect(/text-sm[^"]*font-semibold[^"]*tracking-tight/.test(html), "中文名必须是 14px/600/tracking-tight");
  expect(/text-2xs[^"]*uppercase[^"]*tracking-\[0\.16em\]/.test(html), "英文名必须是 11px/全大写/0.16em");
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
check("MetricCard：36 图标方块 + tone 12% 底色 + 19px 数值 + 12px 标签 + 11px 说明", async () => {
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
  expect(/bg-primary\/12/.test(html), "tone 底色必须是主色 12% 透明度");
  expect(html.includes("text-primary"), "彩色方块里的图标必须是主色");
  expect(/text-metric[^"]*font-semibold/.test(html), "数值必须是 text-metric（19px）半粗");
  expect(html.includes("tnum"), "数值必须 tnum（等宽数字）");
  expect(/text-xs[^"]*text-muted-foreground/.test(html), "标签必须是 12px 中性色");
  expect(html.includes("text-2xs"), "说明必须是 11px");
  expect(html.includes("min-w-0"), "单卡必须 min-w-0，避免栅格把卡片挤爆");
  expect(html.includes("truncate"), "数值/说明必须单行截断");
  expect(html.includes("请求量") && html.includes("1,234") && html.includes("所选区间内用量事件"), "标签/数值/说明必须都渲染");
});

check("MetricCard：dense 档位更紧，trend 显示方向箭头与百分比", async () => {
  const { MetricCard } = await load("/src/components/stat-card.tsx");
  const { METRIC_ICONS } = await load("/src/lib/metric-icons.ts");
  const { Activity } = await import("lucide-react");
  const dense = render(
    createElement(MetricCard, { label: "成本", value: "¥1.0000", icon: Activity, tone: "warning", dense: true }),
  );
  const standard = render(
    createElement(MetricCard, { label: "成本", value: "¥1.0000", icon: Activity, tone: "warning" }),
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
  includesAll(text, ["requests:", "tokens:", "cost:", "charge:", "margin:", "latency:", "cache:", "errors:"], "指标映射");
  includesAll(text, ["Activity", "Layers", "Wallet", "Receipt", "TrendingUp", "Timer", "Zap", "TriangleAlert"], "lucide 图标");
  includesAll(text, ['tone: "primary"', 'tone: "success"', 'tone: "warning"', 'tone: "danger"', 'tone: "info"'], "tone 语义色");
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
