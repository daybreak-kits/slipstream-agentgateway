# 旧系统 UI 规范与品牌勘察（llmapi/web，v1 终态快照）

> 状态：只读勘察报告。对象是旧仓 `llmapi`（Slipstream 前身）的 UI 规范正文、品牌资产、token 清单、页面模式与导航结构；末章对照新仓 `slipstream/web` 给出逐条差异。
> 规范正文基准：`llmapi/docs/ui-standards.md` v1（2026-11-14 定稿，830 行），配套 `ui-adoption-map.md`（现状台账）、`ui-stack.md`（技术栈取舍）、ADR-064（全量 shadcn + Tailwind 4）、ADR-066（token 语义与批 4 映射）。
> **本文不复制色值的第二真源**：凡「某 token 是什么色」直接标 `llmapi/web/src/index.css:行号`，改样式时以代码为准。
> 本文不修改旧仓任何文件，也不修改新仓代码。

## 0. 读法：三条会害你踩坑的前置

### 0.1 证据等级

| 标记 | 含义 |
|---|---|
| 【直读】 | 本次直接读到源码/文件内容，行号为实测 |
| 【转引】 | 来自旧仓文档的实测记录（文档作者当时跑过命令），本文未复跑 |

### 0.2 旧文档里的 `index.css` 行号整体过期（+12 ~ +60 偏移）

ADR-064/066 与 ui-standards 大量引用 `index.css:NN`，但那份文件后来从约 300 行长到 **427 行**（【直读】`llmapi/web/src/index.css` lineCount=427），引用未同步。实测对照：

| 文档引用 | 实际位置（【直读】） | 内容 |
|---|---|---|
| `index.css:14-16` | 14-16 ✅ 一致 | `--radius-control/card/badge` |
| `index.css:20-23` | 20-23 ✅ 一致 | `--radius-sm/md/lg/xl` |
| `index.css:63` | **81** | `--color-muted: var(--surface-2)` |
| `index.css:99` | **117** | `--color-muted-foreground` |
| `index.css:116` | **134** | `--text-muted: #5b6573` |
| `index.css:196-216` | **217-233** | shadcn 别名层 |
| `index.css:108-217` | **126-235** | `:root` |
| `index.css:219-289` | **237-307** | `.dark` |
| `index.css:25-26` | **43-44** | `--shadow-card` / `--shadow-pop` |
| `index.css:79-94` / `154-169` | **197-212** / **291-306** | chart-1..16 浅/深 |
| `index.css:52-55` | **70-73** | `@theme inline` 说明注释 |

**结论：按 token 名 grep，不要按文档行号跳转。**

### 0.3 旧规范内部有五处自相矛盾（照抄会做错）

1. **字号行高**：§2.2 表写 12px/18、14px/22；ADR-066「token 映射」第 1 节写 12/**16**、14/**20**，并声明「只加档、不覆盖内置档」，因此内置 `text-xs` 与 `text-sm` 取 Tailwind 默认。**以 ADR-066 为准**（`llmapi/docs/adr/ADR-066-token-semantics-adoption.md:43`）。
2. **控件高度命名**：§2.3 表把「lg = 40，对应 `size=default h-10`」，而 §9 第 5 条写「sm 32 / md 36 / lg 44（默认 40 仅用于表单行）」。代码事实是**两套标尺并存**：`size=default` 40、`md` 36、`sm` 32、`lg` 44、`icon` 40×40（【直读】`llmapi/web/src/components/ui/button.tsx:24-28`）。
3. **dense 档 28 只在两处记录**：§11.1.6 与 ADR-066 §2 S5 有 `h-7`(28)，§2.3 表里没有。
4. **组件总数**：ui-standards §3.0 记 42（27+11+4）；ADR-066 决策 6 记 43/44（含测试文件）。目录实读 = **42 个 .tsx**（【直读】`llmapi/web/src/components/ui/`）。
5. **图表色板 ADR 号**：`index.css:196` 注释写 `(ADR-026)`，实为 **ADR-040**（ADR-026 是看板/日志的信息架构）。台账已登记为待修（adoption-map §11 #12）。

### 0.4 路径约定

| 简写 | 实际路径 |
|---|---|
| `ui/x.tsx` | `llmapi/web/src/components/ui/x.tsx` |
| `layout/x.tsx` | `llmapi/web/src/components/layout/x.tsx` |
| `pages/x.tsx` | `llmapi/web/src/pages/x.tsx` |
| `index.css` | `llmapi/web/src/index.css` |
| `新仓:x` | `slipstream/web/src/x` |

---

## 1. 品牌

### 1.1 系统名与定位

| 项 | 值 | 证据 |
|---|---|---|
| 中文名 | **驭流** | `layout/sidebar.tsx:38`（`<p class="text-sm font-semibold tracking-tight text-title">驭流</p>`）【直读】 |
| 英文名 | **Slipstream** | `layout/sidebar.tsx:39`【直读】 |
| 产品定位 | **LLM API 网关** | `llmapi/web/index.html:8`【直读】 |
| 完整页签标题 | `驭流 Slipstream · LLM API 网关` | `llmapi/web/index.html:8`【直读】 |
| 语言 | `lang="zh-CN"` | `llmapi/web/index.html:2`【直读】 |
| 登录页品牌大标题 | 36px / `text-4xl` | 文档 §11.2.1 表（`login.tsx:103`）【转引】 |

### 1.2 副标题的版式（两行锁死）

侧栏品牌区是**上下两行**，不是一行居中：

`@tsx
// layout/sidebar.tsx:37-40 【直读】
<div className={cn("leading-tight", collapsed && "sr-only")}>
  <p className="text-sm font-semibold tracking-tight text-title">驭流</p>
  <p className="text-2xs font-medium uppercase tracking-[0.16em] text-muted-foreground">Slipstream</p>
</div>
`@

- 第一行：中文名，14px/600，字距 `tracking-tight`。
- 第二行：英文名，**11px/500，全大写，字距 0.16em**，弱化为 `text-muted-foreground`。
- 折叠态：整块 `sr-only`，只留 logo（`sidebar.tsx:37`），并把名字塞进 `title`（`sidebar.tsx:35`）——**折叠后名字仍可被屏幕阅读器与 hover 读到**，这是旧规范「键盘/读屏是一等公民」的落点之一。
- 与 §11.2.2 的关系：0.16em 属于「全大写小标签」允许的字距档（规范名义值 0.08em，这里是品牌专用放宽），**只给拉丁字母**；同一模板用在中文字上就是 §11.10 #5 的反例。

### 1.3 logo 资产：三件，各管一件事

`llmapi/web/public/` 下三个 SVG（【直读】目录 + 文件内容）：

| 文件 | 尺寸/结构 | 用途 | 证据 |
|---|---|---|---|
| `logo-v10-contrast.svg` | 512×512，三笔折线，高对比版；带 `role="img"`、`aria-label="驭流标志（浅色背景高对比）"`、`<title>` | **产品内主用法**：favicon + 侧栏标志 | `index.html:5`、`sidebar.tsx:31`【直读】 |
| `logo.svg` | 512×512，同一几何、描边更细（`stroke-width="28"` vs 高对比版 `31.46`） | 通用/浅底导出件；带 C2PA 元数据 | `public/logo.svg:1-3`【直读】 |
| `favicon.svg` | 32×32，圆角 8 的靛蓝方块 + 白色 L 形 + teal 圆点 | 独立 favicon 备件（**未被引用**，index.html 用的是 logo-v10-contrast） | `public/favicon.svg:1-5`【直读】 |

**三色与 token 的一一对应（品牌→设计的真正咬合点）**：

| logo 取色 | 色值 | 对应 token | 证据 |
|---|---|---|---|
| 主折线 | `#4F46E5`（靛蓝） | `--primary`（浅色主题） | `logo.svg:3` / `index.css:137`【直读】 |
| 次折线 | `#818CF8` | `--primary`（深色主题） | `logo.svg:1` / `index.css:248`【直读】 |
| 斜箭头 | `#14B8A6`（teal） | `--login-teal` | `logo.svg:2` / `index.css:188`【直读】 |
| favicon 圆点 | `#2DD4BF` | `--login-teal-bright` | `favicon.svg:4` / `index.css:189`【直读】 |

### 1.4 用法（组件内）

`@tsx
// layout/sidebar.tsx:30-36 【直读】
<img
  src="/logo-v10-contrast.svg"
  alt=""                       // 装饰性：名字在旁边文本里
  aria-hidden="true"
  className="h-9 w-9 shrink-0"  // 36×36
  title={collapsed ? "驭流 Slipstream" : undefined}
/>
`@

规则：
1. **尺寸 36×36（`h-9 w-9`）**，不随侧栏折叠缩放。
2. **`alt=""` + `aria-hidden="true"`**：品牌名由相邻文本承载，避免读屏重复念一遍；只有折叠态（文本 `sr-only`）才用 `title` 兜底。
3. **不做主题切换换图**：单一 contrast 版文件在浅/深两套底色下都成立（`logo-v10-contrast.svg` 的命名本身就是这个决策的产物）。
4. 容器：`h-16 shrink-0`（64px 高），折叠态 `justify-center px-2`、展开态 `justify-between px-5`（`sidebar.tsx:23-28`）。

### 1.5 浅/深色适配

| 面 | 机制 | 证据 |
|---|---|---|
| 主题切换 | class 策略：`.dark` 挂 `<html>`，`@custom-variant dark (&:where(.dark, .dark *))` 固定变体，**不用** `prefers-color-scheme` | `index.css:3-6`【直读】 |
| 防闪（FOUC） | `index.html` 内联脚本在首帧前读 `localStorage["system.storage"].theme`，`dark` 或（`system`/缺省 且 系统深色）→ 加 `.dark` 并设 `documentElement.style.colorScheme` | `index.html:9-28`【直读】 |
| 浏览器 chrome | `<meta name="theme-color" content="#0B0F17">`，与深色 `--bg` 同值 | `index.html:7` / `index.css:238`【直读】 |
| logo | 不换文件；靠「高对比版」+ 三色本身在两种底色上的对比度 | 见 1.3/1.4 |
| 品牌文字 | `text-title`（随主题）、第二行 `text-muted-foreground`（随主题） | `sidebar.tsx:38-39`【直读】 |
| 例外 | **登录页整页不随主题切换**（`--login-*` 固定深蓝 palette，`intentionally theme-independent`）；tooltip / code 面板两主题同值 | `index.css:184-192`、`:170-182`；规范 §11.9.2 第 4 条【转引】 |

### 1.6 页签 title 文案

- **静态一句话**：`驭流 Slipstream · LLM API 网关`（`index.html:8`）。
- **没有路由级 title**：全仓 `document.title` **0 命中**（【直读】grep `document\.title` on `llmapi/web/src` = 0）。页面切换只改顶栏面包屑（`layout/topbar.tsx:84-90`），浏览器页签恒定。
- 这在新仓同样是缺口（见 §6 D-14）：新仓 `PAGE_TITLES`（`新仓:components/layout/nav-items.ts:58-60`）只喂顶栏 `<h1>`，不喂 `document.title`。

---

## 2. Token 全清单

### 2.0 三个事实源（规范 §0/§2.0）

1. `index.css` 的 CSS 变量（颜色、焦点环、图表色板）——`:root` `126-235`、`.dark` `237-307`【直读】。
2. `index.css` 的 `@theme` 语义映射（色名、圆角、字号、阴影、动效、布局宽）——`10-68` + `@theme inline` `73-124`【直读】。
3. `components/ui/` 的基元实现（尺寸、状态、键盘、aria）。

> 页面**不是**事实源。页面里的 `h-7`、`text-[10.5px]`、`rounded-[7px]` 是待收敛技术债，不是可复制配方（§0）。

### 2.1 颜色语义：变量名与用途

#### A. 三层基底（浅 `:root` / 深 `.dark`，值见行号）

| 变量 | 语义 | 类名 | 浅色 | 深色 | 不要用在哪 |
|---|---|---|---|---|---|
| `--bg` | 页面画布 | `bg-bg` / `bg-background` | `:127` | `:238` | 不要用 `surface-2` 当页面底 |
| `--surface` | 卡片/顶栏/侧栏 | `bg-surface` / `bg-card` | `:128` | `:239` | — |
| `--surface-2` | 次级容器、hover、未选中 | `bg-surface-2` / `bg-muted` / `bg-secondary` | `:129` | `:240` | 不做大面积底 |
| `--border` | 内容分隔、可交互边界 | `border-border` | `:130` | `:241` | 不拿去画「强调」 |
| `--border-strong` | 控件边界（input/select 边框） | `border-border-strong` | `:131` | `:242` | 不做内容分隔（太重） |
| `--text-title` | 标题、强调正文 | `text-title` / `text-foreground` | `:132` | `:243` | — |
| `--text-body` | 正文默认 | `text-body` | `:133` | `:244` | — |
| `--text-muted` | 辅助文字（表头、副行、说明） | `text-muted-foreground` | `:134` | `:245` | **不承载正文** |
| `--text-faint` | 极弱文字（占位、轴标签） | `text-faint` | `:135` | `:246` | 不承载可读信息 |

> **`--color-muted` 是表面，不是文字**（ADR-066 决策 1）：`--color-muted: var(--surface-2)`（`:81`），文字层走 `--color-muted-foreground`（`:117` → `--text-muted`）。这条如果不翻转，vendored 件里的 `bg-muted` 会渲染成深灰块。**扩展名**：`--color-title/--color-body/--color-faint` 是本仓自加，shadcn 没有。

#### B. 主色与状态色（三件套：实色 / 文字 / soft 底）

| 组 | 变量 | 浅 | 深 | 用途 |
|---|---|---|---|---|
| 主色 | `--primary` | `:137` | `:248` | 主按钮底、选中、链接 |
| | `--primary-hover` | `:138` | `:249` | hover |
| | `--primary-active` | `:139` | `:250` | active / `accent-foreground` |
| | `--primary-soft` | `:140` | `:251` | 选中底、Badge default、Empty 图标底 |
| | `--primary-on` | `:141` | `:252` | **主色/危险色上的前景**（深色是 `#0b0f17`，不是白） |
| 成功 | `--success` / `-text` / `-soft` | `:143-145` | `:254-256` | Badge、toast、图表达标线 |
| 警告 | `--warning` / `-text` / `-soft` | `:146-148` | `:257-259` | Badge、Alert warning |
| 危险 | `--danger` / `-text` / `-soft` | `:149-151` | `:260-262` | 危险按钮、Alert、错误 toast |
| 中性 | `--info` | `:152` | `:263` | 默认 Badge、辅助信息 |
| 焦点 | `--focus-ring` | `:194` | `:288` | `:focus-visible` 2px outline |

**载体规则（§11.4.2）**：面积 > 一行文字 → soft 底 + text 色；≤ 一行 → 纯文字色；**只有主按钮**允许饱和底 + `on` 色。禁止饱和状态色大面积铺底。

**三分法（全站最常混的三选一，§11.4.1）**：
1. 选中/高亮/品牌强调 → `primary-soft`（Badge default `:12`、Empty 图标底 `empty.tsx:13`）。
2. 次级容器/悬停/未选中 → `surface-2`（button secondary `:15`、ghost hover `:18`、菜单项 hover）。
3. 可交互边界 → `border`；控件边界 → `border-strong`（`input`、combobox 触发器）；内容分隔 → `border`。

#### C. 浮层、代码、登录（固定不翻转）

| 变量 | 值（浅=深） | 用途 | 行号 |
|---|---|---|---|
| `--overlay` | `rgba(11,15,23,.45)` | 弹窗/抽屉遮罩 | `:170` / `:281` |
| `--tooltip-bg` | `rgba(11,15,23,.95)` | tooltip 深色底（两主题同值） | `:171` / `:282` |
| `--tooltip-border` / `-fg` / `-fg-muted` | `#273244` / 浅 `#f1f5f9`·深 `#e5e7eb` / 60%·55% | tooltip 边界与文字 | `:172-175` / `:283-285` |
| `--code-bg` | `#0b0f17` | 代码面板（两主题同值） | `:176` / `:286` |
| `--code-fg` / `-strong` / `-muted` / `-faint` / `-hover` | `#e2e8f0` / `#f8fafc` / `#94a3b8` / `#64748b` / 15% slate | 代码语法层级 | `:178-182` |
| `--login-*`（9 个） | ink/ink-2/accent/teal/teal-bright/green/amber/indigo | 登录页固定深蓝域（**不随主题**） | `:185-192` |

#### D. 图标徽章 6 组 tint（成对 bg/fg）

| 组 | 浅 | 深 |
|---|---|---|
| flow | `#e8efff` / `#1d4ed8`（`:155-156`） | `rgba(96,165,250,.16)` / `#93c5fd`（`:266-267`） |
| token | `#e0f6f7` / `#0e7490`（`:157-158`） | `rgba(34,211,238,.16)` / `#67e8f9`（`:268-269`） |
| cache | `#f0ecfe` / `#6d28d9`（`:159-160`） | `rgba(167,139,250,.16)` / `#c4b5fd`（`:270-271`） |
| cost | `#fdf3e2` / `#b45309`（`:161-162`） | `rgba(251,191,36,.16)` / `#fcd34d`（`:272-273`） |
| error | `#fdeaea` / `#b91c1c`（`:163-164`） | `rgba(248,113,113,.16)` / `#fca5a5`（`:274-275`） |
| latency | `#e6f6ec` / `#15803d`（`:165-166`） | `rgba(74,222,128,.16)` / `#86efac`（`:276-277`） |

规律：**浅色实色 wash + 深色同色相半透明**（§11.4.4）；实色浅底在 `#0b0f17` 上会发白发脏。

#### E. shadcn 别名层（只转发，不新开值）

`:217-233`【直读】：`--background`→bg、`--foreground`→text-title、`--card`/`--popover`→surface、`--primary-foreground`→primary-on、`--secondary`→surface-2、`--muted`→surface-2、`--muted-foreground`→text-muted、`--accent`→primary-soft、`--accent-foreground`→primary-active、`--destructive`→danger、`--input`→border-strong、`--ring`→focus-ring、`--radius`=8px。

由 `@theme inline` 转发成类名（`:108-123`）。**`@theme inline` 的 `inline` 不能省**，否则 `var()` 在定义处求值、深色永远拿不到覆盖（`:70-72` 的注释就是踩坑记录）。

### 2.2 字号：四档 + 两个例外 + 一个域外

`@theme` 注册（`:29-36`），**内置档不改**（ADR-066 的硬约束：改了会连带改 50 处 vendored 件的换行与内高）：

| 档 | 字号/行高 | 类名 | 用在哪 | token |
|---|---:|---|---|---|
| 角标/辅助 | 11 / 16 | `text-2xs` | 图表轴、徽章、chip、副行、品牌第二行 | `:29-30` |
| 元信息 | 12 / 16 | `text-xs`（内置） | 表格副行、卡内说明、分页信息 | Tailwind 默认 |
| **正文默认** | 13 / 20 | `text-2sm` | 按钮、输入、菜单项、表格正文、Label | `:31-32` |
| 强调 | 14 / 20 | `text-sm`（内置） | 卡片标题、段落、页面副标题 | Tailwind 默认 |
| 例外 1 | 19 / 26 | `text-metric` | **仅**指标大数字 | `:33-34` |
| 例外 2 | 22 / 28 | `text-h1` | **仅**页面 h1 | `:35-36` |
| 域外 | 36 / 40 | `text-4xl` | 仅登录页品牌大标题 | 内置 |

规则（§11.2.1）：
- **页面只能用四档**；19/22 只允许出现在基元内部（`MetricStrip`、`PageHeader`），页面不得自己写。
- 判定句：**diff 里出现 `text-[` 即违反**；映射句「取不大于原值的最大档」。
- 字重只有 400/500/600；字距只有三档：normal、标题 `-0.01em`、全大写小标签 `0.08em`（品牌第二行 0.16em 是唯一放宽）。
- **半像素是灾难**：批 4 前实测 657 处 `text-[…px]`，其中 254 处是 10.5/11.5/12.5/13.5——「四档原样只覆盖一半用法」，这才是要收档的真实原因。

数字与等宽（§11.2.3）：数值列 `tabular-nums` + 右对齐；代码/路径 `font-mono`（JetBrains Mono，`:12`）；会随刷新变化的数字块**必须** `tabular-nums`，否则整行跳。

### 2.3 控件高度：一条阶梯，五个档

| 档 | 高度 | 类 | Button（`button.tsx:24-28`） | 允许场景 |
|---|---:|---|---|---|
| dense | 28 | `h-7` | —（仅 input 默认与密集工具条） | 工具条、千行级表格内 |
| sm | 32 | `h-8` | `size="sm"` | 表格行内操作、紧凑表单 |
| md | 36 | `h-9` | `size="md"` | 筛选条、弹窗 footer |
| default | 40 | `h-10` | `size="default"` | 常规表单行 |
| lg | 44 | `h-11` | `size="lg"` | **仅**登录页与空态主 CTA |

硬规则：
1. **同一行内相邻控件必须同高**（§11.1.6）。反例：`combobox` 触发器 `h-9`(36) 与 `Button` 默认 `h-10`(40) 在筛选栏同排——日志页与看板就吃这个亏。
2. 图标按钮是 **32/36/40 正方形**（`size="icon"` = 40×40，`button.tsx:28`），不允许 `h-6/h-7/h-8` 混用；表格行内若必须紧凑用 32 并保持行高。
3. 图标尺寸：按钮内 14/16/18，行内 12/14；`size-4`(16) 是默认值，`strokeWidth={1.75}` 是全站统一线宽（`sidebar.tsx:100`、`topbar.tsx:67`）。

### 2.4 圆角与阴影

**圆角两套标尺同值并存**（ADR-066 决策 2）——语义档回答「这是什么」，数值档回答「多大」，vendored 件写 `rounded-md` 命中的就是 control 档：

| 语义档 | 值 | 数值档 | 值 | 用在哪 | 不能用在 |
|---|---:|---|---:|---|---|
| `--radius-badge` | 6 | `--radius-sm` | 6 | 徽章、分页页码、极小控件 | 卡片、按钮 |
| `--radius-control` | 8 | `--radius-md` | 8 | 按钮、输入、选择、菜单项、图标徽章 | 卡片 |
| `--radius-card` | 12 | `--radius-lg` | 12 | 卡片、弹窗、抽屉、浮层容器 | 控件内部 |
| —（无） | — | `--radius-xl` | **16** | 浮层内嵌容器（弹窗里的区块） | 控件、卡片本体 |
| `rounded-full` | 9999 | — | — | 头像、圆点、开关轨道、Empty 图标底 | 容器 |

（`:14-16` 语义档、`:20-23` 数值档【直读】）

**阴影只有两级**（`:43-44`）：
- `--shadow-card` = `0 1px 2px rgba(17,24,39,.04), 0 8px 24px -18px rgba(17,24,39,.28)` → 卡片静止态。
- `--shadow-pop` = `0 18px 40px -20px rgba(17,24,39,.35), 0 2px 8px rgba(17,24,39,.06)` → 浮层、菜单、toast。
- **禁止自写 `box-shadow`；hover 不加阴影，只改底色/边框**（§2.4）。
- 已知欠账：`shadow-xs`（Tailwind 第三档）13 处未登记（`button.tsx:12/17` 等），要么记为 `--shadow-control` 要么收敛（adoption-map §11 #5）。

**边框 vs 底色：三问定案**（§11.5.3）：① 分隔的是可交互物还是内容块？② 是否浮在其他内容之上（浮 → border + shadow-pop）？③ 去掉这条线还能靠间距/底色分组吗？**能，就别加线。**

**z-index 五档 + 两个未登记任意值**（§2.6/§11.5.4）：

| 层 | z | 内容 |
|---|---:|---|
| 表格吸顶列 | 5 | 低于表头，避免盖住表头 |
| sticky | 10 | 表头、吸顶工具条 |
| tooltip（临时） | 20 | 图表 tooltip（隐患：弹窗内会被遮） |
| topbar | 30 | `topbar.tsx:59` |
| popover | 40 | 下拉、搜索建议、时间选择 |
| modal | 50 | 弹窗、抽屉（`dialog.tsx` overlay/content） |
| search | 60 | 全屏搜索遮罩（`z-[60]`，未登记） |
| toast | 70 | 全局通知（原 `toast.tsx:132`，现已由 sonner 承载） |

### 2.5 间距：基数 4，允许值白名单

- **基数 4px**；允许 `2 / 4 / 6 / 8 / 10 / 12 / 16 / 20 / 24 / 32`；**禁止 `5 / 7 / 9 / 11 / 13 / 14 / 15 / 18 / 28`**（§2.5）。
- 页面左右 padding：移动 16 / 桌面 24；section 间距 24；卡片内 padding 20（紧凑）或 24（常规）。
- 表单：字段纵向 gap 16；label↔控件 6；控件↔帮助/错误 6。按钮组 gap 8。
- 表格：单元格 `px 12/20`、`py 8/12`；行高不低于 44（密集态 40）。
- **任何横向布局必须定义窄屏退化**：`flex-wrap` / grid 降列 / `overflow-x-auto`，不允许靠 `min-w` 把页面撑出屏幕。
- 两档密度（§11.3.1）：紧凑（卡内 `px-3.5 py-3`、控件 32/36、行高 40、区块 16）与常规（卡内 24、控件 40、行高 44、区块 24）。**同一页只允许一档。**

**禁区实测（§11.3.2）**：`py-3.5`/`px-3.5`（14px）合计 33 处，落在 12 与 16 之间——「单看略松一点更透气，合起来就是第 9 种间距值」。

### 2.6 图表：16 槽固定色板

**来源**：ADR-040（16 槽循环复用，**取消「其他」聚合段**）→ `index.css` `197-212`（浅）/ `291-306`（深）【直读】。

| 槽 | 浅色 | 深色 | 槽 | 浅色 | 深色 |
|---:|---|---|---:|---|---|
| 1 | `#2563eb` | `#60a5fa` | 9 | `#ea580c` | `#fb923c` |
| 2 | `#0d9488` | `#2dd4bf` | 10 | `#059669` | `#34d399` |
| 3 | `#d97706` | `#fbbf24` | 11 | `#b45309` | `#eab308` |
| 4 | `#dc2626` | `#f87171` | 12 | `#a16207` | `#c084fc` |
| 5 | `#7c3aed` | `#a78bfa` | 13 | `#0284c7` | `#38bdf8` |
| 6 | `#0891b2` | `#22d3ee` | 14 | `#be123c` | `#fb7185` |
| 7 | `#65a30d` | `#a3e635` | 15 | `#0f766e` | `#5eead4` |
| 8 | `#db2777` | `#f472b6` | 16 | `#7c2d12` | `#fdba74` |

六条分配规则（§11.4.3）：
| 规则 | 内容 |
|---|---|
| R1 | 固定 16 槽，顺位取色，**永不新开第 17 色** |
| R2 | 主色靛蓝**不入板**（`:196` 注释 `primary indigo excluded`） |
| R3 | 按**当期请求量降序**分配；0 请求的系列不占槽（`lib/chart-colors.ts:22-28`） |
| R4 | 超过 16 系列循环复用，不折叠 |
| R5 | 隐藏系列**不重排**颜色：先在完整列表分配，绘制时跳过 |
| R6 | 深色有独立亮度集，**never reuse the light values**（`:290` 注释） |

**R3 是已登记未修的缺陷**：颜色跟着「当期排序」走 → 模型今天第 3、明天第 2 就换色；掉到 0 请求被 filter 掉会让后面整体前移。用户记的是「蓝色 = A 模型」，代码记的是位置。拟修法：槽位绑**稳定键**（首次出现顺序 或 模型 id 哈希取模 16）。唯一用法入口：`assignCategoryColors`（`chart-colors.ts:17-29`），**不要按指标类型重新定义颜色，不要新增第 17 色**。

### 2.7 动效

| 场景 | 时长/缓动 | 实现 |
|---|---|---|
| 颜色/边框/底色 | 150ms | `transition-colors duration-150`（`button.tsx:8`） |
| 浮层进入 | 200ms ease-out | `--animate-fade-in` / `--animate-fade-up`（`:46-47`） |
| 弹窗进入 | 200ms ease-out，位移 8px | `dialog` 的 `data-[state=open]:animate-in` + `animate-fade-up` |
| 加载 / 骨架 | 循环 | `spinner.tsx` `animate-spin`、`skeleton.tsx` `animate-pulse` |

- 上限 **300ms**；只允许 `fade-up`、`fade-in` 两种内置动画。
- **keyframes 必须写在 `@theme` 内**才会随 `--animate-*` 一起输出（`:49` 注释；写进 `@layer utilities` 不生效）。
- 必须动：hover/focus 底色、浮层进出、加载指示、toast 进入。
- 禁止动：数值补间、列表重排位移、首屏大入场、滚动联动/视差、hover 抬升。
- 欠账：**没有 `prefers-reduced-motion` 全局兜底**，只有 4 处逐件 `motion-reduce:animate-none`。

---

## 3. 页面模式 recipe

> 说明：下表区分**已有基元**与**[待新增]**。旧仓 §3.3 里 `PageHeader`、`Drawer`、`EmptyState`、`Skeleton` 曾长期挂 [待新增]；批 4/5 后 `Empty`/`Skeleton`/`Spinner`/`Dialog`/`Sheet` 已落地，**`PageHeader` 与 `DataTable` 到终态仍无基元**（页面各自拼）。

### 3.1 PageHeader（无基元；三条硬约束）

事实状态：无 `components/ui/page-header.tsx`；各页自己写 `<h1>` + 说明 + 右侧动作。约束来自 §2.2/§4：

`@tsx
// 目标写法（旧仓无此基元时的最小合规版）
<header className="flex flex-wrap items-start justify-between gap-4">
  <div className="min-w-0">
    <h1 className="text-h1 font-semibold text-title">渠道管理</h1>
    <p className="mt-1 text-2sm text-muted-foreground">上游连接、密钥与模型映射</p>
  </div>
  <div className="flex items-center gap-2">{/* 最多一个 primary */}</div>
</header>
`@

1. h1 **只有 22/28（`text-h1`）一档**，页面不得自写 19/22。
2. 右侧动作组**最多一个 primary**，其余 outline/ghost/link；危险动作用 `danger` 且二次确认。
3. 窄屏必须换行（`flex-wrap`），不允许把动作挤出屏幕。

### 3.2 MetricStrip（已有基元 `ui/metric-pills.tsx`）

API（`metric-pills.tsx:6-28`）：`{ items: MetricPillItem[]; loading?; error?; className? }`，item = `{ key,label,icon,tone,value,hint?,title?,estimated?,estimatedTitle? }`。

`@tsx
<MetricStrip
  items={[
    { key: "requests", label: "请求", icon: Activity, tone: "flow", value: formatCount(n), hint: "较昨日 +12%" },
    { key: "cost", label: "成本", icon: CircleDollarSign, tone: "cost", value: formatUsdFine(usd), estimated: true },
  ]}
  loading={isPending}
  error={error ? describeApiError(error) : null}
/>
`@

- 网格：`grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5`（`:31`）——2/3/5 列自适应。
- 卡内：`rounded-card border border-border bg-surface px-3.5 py-3`（`:37`，**紧凑档**）。
- 标签行：`IconBadge tone size="sm"` + 11px 标签（`:41-44`）；`estimated` 时右侧放 `EqualApproximately` 图标 + `title/aria-label`（`:45-57`）。
- 数值：`text-[19px] font-semibold leading-none tracking-[-0.01em] tabular-nums text-title`（`:61`，批 4 后为 `text-metric`）；loading 时 `animate-pulse text-muted-foreground` 且值是「…」。
- hint：11px 单行截断 + `title`（`:67`）；错误：整条横跨（`sm:col-span-2 lg:col-span-3 xl:col-span-5`）的 11px `text-danger-text`（`:73`），**不是**把卡片变红。
- 容器 `aria-label="日志度量"`（`:32`）是硬编码，复用到别的页面要改成 prop。
- **禁止**：自己再写一套 KPI 卡（§1 单一来源）；把 19px 换成分数；用 `fontSize={9}` 压标签。

### 3.3 DataTable（无统一基元：`Table` 原子 + `Pagination` 自拼）

组成：`PageHeader` + 筛选条（搜索/状态/时间范围/更多）+ `ui/table.tsx` 原子 + `ui/pagination.tsx` + 行操作。

标准顺序（§4.2）：
1. PageHeader（标题 + 主动作）。
2. 筛选条：`Combobox`/`Select`/`TimeRangePicker` + 「清除筛选」；**筛选项写进 URL**，刷新可恢复。
3. 表格：`<TableWrap>`（横向滚动容器）→ `<Table>` → `TableHeader/TableBody/TableRow/TableHead/TableCell`；行操作靠右、危险操作二次确认、批量操作在选中后出现。
4. 分页：`Pagination`（总数 + 每页 select + 翻页 + 页码；`nav aria-label="分页"`、当前页 `aria-current="page"`）。

状态矩阵（§4.2/§11.8.1）：
| 态 | 处理 |
|---|---|
| 首次加载 | 骨架（尺寸 = 最终内容）或整块 loading |
| 切换筛选 | **保留旧数据并弱化**，不要清空跳骨架 |
| 空（无数据） | `Empty` + 「新建」CTA |
| 空（无匹配） | `Empty` + 「清除筛选」CTA（**必须区分**） |
| 错误 | `Alert destructive` + 重试，**不清空筛选** |

硬规则：**禁止原生 `<table>`**（§9 第 4 条，应用层已清零）；表头 `aria-sort`、全选 checkbox 的 `indeterminate` 与 `aria-label` 必须给；行内按钮原生 Tab 可达；`tr` 上不许挂 `aria-expanded`（挂第一列按钮）。

### 3.4 Modal（`ui/dialog.tsx`，15 处调用）

`@tsx
<Dialog open={open} onOpenChange={setOpen}>
  <DialogContent className="max-h-[min(720px,85vh)] overflow-y-auto">
    <DialogHeader>
      <DialogTitle>创建渠道</DialogTitle>
      <DialogDescription>连接上游并映射模型；保存后可测试连通性。</DialogDescription>
    </DialogHeader>
    {/* 表单 */}
    <DialogFooter className="border-t bg-surface-2">
      <Button variant="outline" onClick={() => setOpen(false)}>取消</Button>
      <Button variant="default" disabled={pending} aria-busy={pending}>创建渠道</Button>
    </DialogFooter>
  </DialogContent>
</Dialog>
`@

- **必须**：`role=dialog` + `aria-modal` + 可读 title（`aria-labelledby`）；打开后焦点入内、Tab 循环、Escape 关闭、关闭后焦点归还触发元素（受控打开时由 `lib/dialog-opener-focus.tsx` 统一归还，页面不再各写）。
- 长表单：`max-h` + 内部滚动；头部 `border-b` + footer `bg-surface-2 border-t` 两者并用。
- 提交中：按钮 loading + disabled，**不可重复提交**；有未保存修改时关闭要确认。
- 禁止：`window.confirm`、点遮罩丢改动、只有 placeholder 没有 label、错误只在 toast 里出现。

### 3.5 Drawer（`ui/sheet.tsx`）

两种：`side="right"`（详情抽屉，宽 360/480）与 `side="left"`（移动端导航）。

`@tsx
<Sheet open={open} onOpenChange={setOpen}>
  <SheetContent side="right" className="w-120 max-w-[92vw] p-0">
    <SheetTitle className="sr-only">请求详情</SheetTitle>
    <SheetDescription className="sr-only">逐条请求的模型、渠道、耗时与费用。</SheetDescription>
    {/* 内容 */}
  </SheetContent>
</Sheet>
`@

- 焦点陷阱 + Escape + 遮罩由 Radix 负责；**标题必须存在**（可 `sr-only`），否则读屏拿不到上下文。
- 取舍：**侧向/底部容器用 Sheet，居中决策用 Dialog**；不要为抽屉另造 `drawer` 件（ADR-066 决策 6 明确不取 registry 的 drawer）。
- 移动导航特例：`showCloseButton={false}`（与侧栏头部关闭按钮重叠），此时由头部按钮负责关闭（`layout/app-shell.tsx:30-42`【直读】）。

### 3.6 Empty（`ui/empty.tsx`）

`@tsx
<Empty
  icon={Inbox}
  title="还没有渠道"
  description="创建第一个上游连接后，这里会显示连通性与用量。"
  action={<Button size="md">创建渠道</Button>}
/>
`@

- 三件套：**48px 圆底图标**（`size-12 rounded-full bg-primary-soft text-primary`，`empty.tsx:13`）+ 标题（14/600）+ 一句原因（13）+ **一个 CTA**（`:22-45`）；容器 `gap-4 px-6 py-12 text-center`（`:28`）。
- 区分「还没有数据」（CTA=新建）与「没有匹配结果」（CTA=清除筛选）。
- 空态放在表格/卡片**内部**，不替换整页；空态与加载态**互斥**；不要感叹号、不要营销语。

### 3.7 Error（三种位置，互不混用）

| 位置 | 形态 | 文案要求 |
|---|---|---|
| 页面级 | `Alert variant="destructive"` + 重试按钮；**保留用户输入** | 发生了什么 + 为什么 + 怎么办 |
| 字段级 | 字段下方红字 + `aria-invalid` + `aria-describedby`；焦点移到第一个错误 | 逐字段，不用 toast |
| 动作级 | `toast.error` | 同上，停留更久 |

- API 错误统一走 `describeApiError`（`lib` 层单一来源）；**不显示堆栈**。
- 好/坏例子（§5.2）：✅「该渠道仍被 2 个组合引用，无法删除。请先在组合中移除引用。」 ❌「请求失败」「系统错误，请稍后重试」「Error: Network Error」。
- **同一事件不要同时 toast + Alert**；同一错误不要出现三处。

### 3.8 Toast（`ui/sonner.tsx`）

`@tsx
// App 根挂一次（App.tsx:94）
<Toaster />
`@

- 唯一实现：`ui/sonner.tsx` 导出 `Toaster`，读本仓 `useThemeMode()` 决定 light/dark（**不引 next-themes**，避免两套主题状态机，`sonner.tsx:9-13` 注释写明）。
- 容量与时长：`visibleToasts={4}`、`duration: 5200`（`:21-23`）；规范另要求「错误停留更久」，但新 `Toaster` 未对 error 单独设 duration（§11.8.1 记为**待收口**）。
- 语义 class：toast 用 `bg-background text-foreground border-border shadow-lg`、description `text-muted-foreground`、action `bg-primary text-primary-foreground`（`:25-31`）。
- 规则：异步成功/失败用 toast；需要用户处理的问题用 Alert；**表单校验错误不用 toast**；不要把关键信息只放 toast；最多 4 条、可手动关闭、不遮主按钮。

### 3.9 表单（`Field*` + `Label` + `ui/form.tsx`）

`@tsx
<FormField control={form.control} name="base_url" render={({ field }) => (
  <FormItem>
    <FormLabel>连接地址</FormLabel>
    <FormControl><Input placeholder="https://api.example.com/v1" {...field} /></FormControl>
    <FormDescription>必须以 http:// 或 https:// 开头。</FormDescription>
    <FormMessage />
  </FormItem>
)} />
`@

- 每个字段：`Label`（`htmlFor`）→ 控件 → 可选帮助 → 错误；错误同时 `aria-invalid` + `aria-describedby`。
- 间距：字段间 16、label↔控件 6、控件↔帮助/错误 6；**同一行控件同高**。
- 主动作右下、取消在左；提交中 loading + disabled；成功后 toast + 关闭/跳转；密码类三项（当前/新/确认）逐字段报错。
- 数字/日期控件必须与旁边输入同高（`TimeRangePicker` 触发器 `h-9` 要与筛选条其他控件对齐）。
- 禁止：只有 placeholder 没有 label；用 alert 弹窗报校验错；提交中可重复点击。

### 3.10 危险操作（`ConfirmDialog` = `AlertDialog` + `Button`）

`@tsx
<ConfirmDialog
  open={open}
  onOpenChange={setOpen}
  title="删除渠道？"
  description="删除后该渠道下 3 个模型映射将立即失效，且不可恢复。"
  confirmLabel="删除渠道"
  variant="danger"
  pending={mutation.isPending}
  onConfirm={() => mutation.mutate()}
/>
`@

- 标题是**问句**；正文写**不可逆后果与影响范围**（数量/名称）；取消在左、danger 在右；按钮文案是**动作**（「删除渠道」）不是「确定」。
- 异步确认期间禁用 Action 且**不自动关闭**；Escape 取消；默认焦点在取消。
- **禁止** `window.confirm`（旧仓 `no-native-dialog` 规则已 error 级清零）。

### 3.11 导航

- 侧栏当前项要有**三个**载体：底色 `bg-primary-soft` + 文字色 `text-primary` + `aria-current`（NavLink 自动）+ 左侧 2px 活动条（`sidebar.tsx:103-111`）。只换颜色不算做了选中态。
- 分组标题**不可点**，`text-2xs uppercase tracking-[0.14em] text-muted-foreground`（`sidebar.tsx:61-68`）。
- 面包屑：组名 → 当前页，当前页 `font-medium text-title`，可点上级（`topbar.tsx:84-90`）。
- 移动端：`Sheet side="left"`，打开后焦点入内、关闭归还、切页自动关（`app-shell.tsx:20-22,30-42`）。
- **折叠态**：宽度 `w-18`(72)，图标居中，文字 `sr-only`，`title`/`aria-label` 补位（`sidebar.tsx:78-79`）。

---

## 4. ui-standards §11：视觉语言（规则 → 依据 → 反例）

> 本节是**视觉判断的正文**。反例不是假想的坏做法，是仓库里**真实存在过**的写法（多数已销账，保留是为了判定口径可复核）。行号是 2026-11-14 快照，复核按**类名 grep**，别照行号跳。

### 4.1 六条设计原则（每条给可当场判定的判据）

| # | 原则 | 判据 | 反例 |
|---|---|---|---|
| 1 | **token 是唯一出口** | 指着这个值问「它对应哪个 `--var`」，答不上来 = 违反 | 危险按钮 `text-white`（`button.tsx:17`）、开关滑块 `bg-white`、状态点 `bg-white` |
| 2 | **密度优先，但密度 ≠ 拥挤** | 1440 宽下同屏可比行数变多，且最小字号 ≥ 11px、最小行高 ≥ 28px | 趋势图轴标签 `fontSize={9}`，跌破下限已不可读 |
| 3 | **状态必须有第二载体** | 截图转灰度后仍能说出「成功/警告/危险/选中」 | 热力格只用颜色深浅表达量级，无数字/文字替代 |
| 4 | **一处定义，处处引用** | `src/pages`+`src/components` 里 `toFixed|toLocaleString` 应为 0 | 暂无（这条现在是守住的，写进原则是为了别弄丢） |
| 5 | **动效解释因果，不表演** | 把动画删掉，信息是否丢失；不丢失就删 | `dialog` 的 `animate-in` 与页面级 `animate-fade-up` 不响应「减少动态」 |
| 6 | **相邻必等高，同层必同圆角** | 两控件上下边框落在同一条像素线、圆角同半径 | `combobox` 触发器 `h-9`(36) 与 `Button` `h-10`(40) 在筛选栏同排 |

### 4.2 排版三条

1. **四档 + 两例外**（§2.2）；例外只能出现在基元内部。反例：同一屏出现 12.5 / 13.5 / 11.5 三档半像素，「肉眼看着刚好，实际让阶梯变成八档」。
2. **字重 400/500/600；字距三档**。反例：中文标签同时用 `uppercase` + `tracking-[0.08em]`——CJK 没有大小写，`uppercase` 是空操作，只剩被拉宽的字距在破坏对齐（`metric-pills.tsx:42` 的标签内容是中文）。
3. **数字用 `tabular-nums`，等宽只给代码类内容**。风险点：tooltip 已用 `w-56` 固定宽度，一旦有人去掉 `tabular-nums`，长数字会把 tooltip 撑开。

### 4.3 间距与密度

- 4px 基线 + 白名单（§2.5）；2px 只用于细缝（热力格 `gap-[2px]`）。
- 两档密度（§11.3.1），**同一页只允许一档**。反例：磁贴 `p-3`(12) 与同页卡片 `p-5`(20) 同屏；同一页五处 `<Card className="p-5">` 覆盖 24——覆盖本身合法，**不统一**才是问题。
- 表格节奏：表头 `py-3`、数据行 `py-2`、单元格 `px-3`/`px-4`，行高 ≥ 40。

### 4.4 色彩

- 三层语义（表面/描边/强调）+ 状态色载体规则（§2.1）。
- **`primary-soft` / `surface-2` / `border` 三分法**：灰阶截图里 `primary-soft` 与 `surface-2` 几乎同亮度，**所以选中态必须再加文字色或图标**。
- 反例：危险按钮 `bg-danger + text-white`——颜色没错，但前景绕过 token：深色 `--danger` 是 `#f87171`，白字对比度约 **2.7:1**（低于 4.5:1），而 `--primary-on` 深色是 `#0b0f17`，对比约 7:1。
- 16 槽色板：R1-R6 + R3 已知缺陷（§2.6）。

### 4.5 形状与层级

- 圆角分档（§2.4）；`rounded-md` 已等于 control 档，**不要再把它当反例**。
- 阴影两级（§2.4）；`shadow-xs` 是未登记第三档。
- `border` 还是 `bg`：三问定案（§2.4）。反例：看板表头用 `border-b` 而非底色分组，而全页每个块都有边框 → 1096 行里视觉噪声叠加。
- z-index 五档（§2.4）。

### 4.6 动效

- 时长/缓动阶梯 + 「必须动 / 禁止动」两张表（§2.7）；上限 300ms。
- 新动画必须先注册进 `@theme`（keyframes 也要在 `@theme` 内）。
- **`prefers-reduced-motion` 无全局兜底**（欠账，adoption-map §11 #10）；建议在 `@layer base` 加一条归零媒体查询，组件级 `motion-reduce:` 保留。

### 4.7 数据可视化

| 主题 | 规则 |
|---|---|
| 轴与网格 | 轴标签 ≥ 11px；只画正刻度水平网格线，虚线 `3 5`、`stroke-border`，**不画垂直网格线**；柱图**必须有零基线** |
| 图例 | 固定右侧 180px 列（`lg:grid-cols-[1fr_180px]`），可点隐藏；隐藏后颜色不重排（R5） |
| tooltip | 固定深色（两主题同值），宽度 `w-56`，正文 11px，数值 `tabular-nums`；空桶写「该时段无数据」，不留空白 |
| 无障碍 | `svg` 带 `role="img"` + `aria-label`；每个时间桶一个 `tabIndex={0}` 命中矩形 + `aria-label`（**但焦点不可见**，见 §4.10 #7） |
| 何时条形/折线 | 唯一判据：**横轴是不是时间**。连续时间 → 折线/堆叠柱；离散类目 → 横向条形；桶内再分类 → 堆叠柱；二维密度 → 热力格。**不要**把随时间变化的绝对值画成面积图（面积暗示可加，会让人二次相加） |
| 空/载 | 图表空 → 一行明确文案，不是空白画布；图表加载靠整卡 loading（无专用骨架） |

数值格式唯一口径（§11.7.4）：`formatCompact`（K/M/B）、`formatCount`（千分位，缺失「—」）、`formatUsdFine`、`formatPricePer1m`、`formatPercent`、`formatCacheHitRate`、`formatRate`、`formatTrendAxis`；**页面不自带同名格式化函数**。

### 4.8 反馈与空态（四态固定形态）

| 态 | 形态 | 基元 | 文案 |
|---|---|---|---|
| loading（整块） | 骨架，尺寸 = 最终内容 | `skeleton.tsx` | 无文案 |
| loading（动作中） | 旋转指示器，**按钮动词不变** | `spinner.tsx` | 动词不变，只加指示器 |
| empty | 48px 圆底图标 + 标题(14/600) + 说明(13) + CTA | `empty.tsx` | 标题说状态、说明说原因、CTA 说下一步 |
| error（页面级） | Alert danger + 原因 + 重试 | `alert.tsx` | 发生了什么 + 为什么 + 怎么办 |
| error（动作级） | toast error | `sonner` | 同上，停留更久 |
| success（动作级） | toast success | `sonner` | 动词 + 对象 |

四态**互斥**：同一区域不同时出现 loading 与 empty；同一事件不同时 toast + Alert；toast 最多 4 条。

反例：空态是裸文本「暂无数据」（无图标、无 CTA、不区分无数据/无匹配）；「所选范围内没有错误。」用 12.5px 且无 CTA——这是「没有匹配」，却按「没有数据」处理。

### 4.9 深色模式

**机制**：class 策略（§1.5）；每个颜色都要在 `:root` 与 `.dark` **各写一次**——只写浅色 = 深色下静默继承浅色值；别名层只转发不新开值。

**五类「不能只靠反转」**：
1. **阴影**：两级阴影都是 `rgba(17,24,39,…)`，在 `#0b0f17` 上不可见 → 深色层级改用 `border` 提亮（`#273244` → `#374357`）。
2. **soft 状态底**：浅色实色 → 深色半透明（`rgba(…,.14)`），否则发白发脏。
3. **图表 16 槽**：深色有独立亮度集。
4. **固定深色面板**：tooltip / code / login 两主题同值（品牌与代码语境，翻转会破坏识别）。
5. **图片/插画**：全站只有 3 处 `img`，都在固定深色或品牌位；内容区不放需要反色的位图。

**禁忌**：不用 `bg-white`/`text-black`；不靠阴影表达层级；**登录页整体不随主题切换**（已登记的例外，不要「顺手修它」）。

### 4.10 十条「看起来对，但其实是错的」

| # | 审美判断 | 为什么它看着对 | 实际错在哪 | 反例 | 正确做法 |
|---:|---|---|---|---|---|
| 1 | 轴标签 9px「更精致」 | 小字显专业、图面干净 | 跌破 11px 下限，1440 宽已不可读 | 趋势图 `fontSize={9}` | `text-2xs` 11px |
| 2 | 半像素字号「刚刚好」 | 12.5/13.5 比整数更贴切 | 阶梯从四档变八档，实测 254 处 | 同屏 12.5/13.5/11.5 | 收敛到 11/12/13/14 |
| 3 | `rounded-[7px]`「约等于 8px」 | 肉眼与 8px 无差别 | 圆角四档体系被架空，下次就有人写 9px | `rounded-[7px]` 1 处 | `rounded-control` |
| 4 | 热力格 2px 圆角「更细腻」 | 小圆角显得精致 | 破坏三档圆角；2px 在深色几乎不可见 | `rounded-[2px]` 2 处 | 统一 2px token 或改 4px |
| 5 | 标签 `uppercase + tracking`「有设计感」 | 仪表盘常见的英文式标签 | CJK 没有大小写，只剩被拉宽的字距噪声 | 中文指标名 + `uppercase` | 中文标签去掉 `uppercase` |
| 6 | 图例颜色「很稳」 | 同一模型看起来一直同色 | 颜色按**当期请求量排序**分配，掉到 0 会让后面整体前移 | `chart-colors.ts:22-28` | name → slot 稳定映射 |
| 7 | `tabIndex=0`「让图可键盘访问」 | 源码里有无障碍的样子 | `outline-hidden` 让焦点不可见，键盘用户不知道自己在哪 | 时间桶命中矩形 | 焦点环用 `--focus-ring` |
| 8 | 危险按钮红底白字「最醒目」 | 符合直觉 | 深色 `--danger` 为 `#f87171`，白字约 2.7:1 | `button.tsx:17` | 前景用 `--primary-on` |
| 9 | 深色 tooltip「更有层次」 | 悬浮感强、专业 | 深色下 `--tooltip-bg` 与 `--bg` 同为 `#0b0f17`，浮层与页面同色 | `--tooltip-bg` vs `--bg` | 深色下用 `surface-2` + `border` |
| 10 | 「暂无数据」一句话「最干净」 | 极简、不啰嗦 | 无图标、无 CTA、不区分「无数据」与「无匹配」 | 看板空态裸文本 | 用 `Empty` 基元 |

---

## 5. 旧导航：四组八项

### 5.1 结构（`lib/navigation.ts:25-69`【直读】）

`@ts
interface NavItem  { label: string; to: string; icon: LucideIcon; description: string }
interface NavGroup { label: string; items: NavItem[] }
`@

| 组 | 序 | 菜单名 | 路径 | 图标 | 描述（同时用作占位页副标题与搜索文案） |
|---|---:|---|---|---|---|
| **常规** | 1 | 全局概览 | `/overview` | `LayoutGrid` | 连接地址、接入示例与运行概况 |
| | 2 | 数据看板 | `/` | `LayoutDashboard` | 请求量、词元、成本与延迟概览 |
| | 3 | 使用日志 | `/logs` | `ScrollText` | 逐条请求的模型、渠道、耗时与费用 |
| **配置** | 4 | 渠道管理 | `/channels` | `Network` | 上游连接、密钥与模型映射 |
| | 5 | 模型管理 | `/catalog` | `Layers` | 可调用模型清单与组合编排 |
| **工具** | 6 | 模型试验 | `/playground` | `FlaskConical` | 多轮流式调试与用量回显 |
| **系统** | 7 | 用户密钥 | `/keys` | `KeyRound` | 调用方密钥的签发与封禁 |
| | 8 | 系统设置 | `/settings` | `Settings` | 管理员账号与日志策略 |

派生函数：`navItems = navGroups.flatMap(g => g.items)`（`:71`）；`findNavItem(pathname)`（`:73-78`，先精确后前缀）；`findNavGroup(pathname)`（`:80-83`）——顶栏面包屑与 `PagePlaceholder` 都吃这两个函数。

> 顺序的反常点：**「数据看板」是 `/`（站点 index），「全局概览」是 `/overview` 且排在它前面**。落地时容易把两者接反。

### 5.2 路由表与实现状态（`llmapi/web/src/App.tsx`【直读】）

`IMPLEMENTED_PATHS`（`App.tsx:22-32`）9 条：`/`、`/overview`、`/channels`、`/channels/new`、`/catalog`、`/logs`、`/keys`、`/playground`、`/settings`。

| 路由 | 组件 | 备注 |
|---|---|---|
| `/login` | `LoginPage` | `PublicOnlyRoute` 包一层 |
| `/`（index） | `DashboardPage` | AppShell 内 |
| `/overview` | `OverviewPage` | |
| `/channels` | `ChannelsPage` | |
| `/channels/new` | `ChannelDetailPage` | 新建态 |
| `/channels/:channelId` | `ChannelDetailPage` | 详情态 |
| `/catalog` | `ModelsPage` | 文件叫 `pages/models.tsx`（导出 `ModelsPage` 与 `CombosRedirect`） |
| `/combos` | `CombosRedirect` | 重定向壳 |
| `/logs` | `LogsPage` | |
| `/keys` | `KeysPage` | |
| `/playground` | `PlaygroundPage` | |
| `/settings` | `SettingsPage` | |
| 其余 nav 项 | `PagePlaceholder` | `App.tsx:63-77` 自动生成：`navItems.filter(!IMPLEMENTED_PATHS)` → 用 `label`/`description`/`icon` 渲染 |
| `*` | `<Navigate to="/overview" replace />` | 兜底 |

**占位页机制**是旧仓的一个聪明处：导航表就是路由表的输入，新增菜单项不必手写路由，未实现的自动落到 `PagePlaceholder`（标题+描述+图标），所以「导航有、页面没做」永远不会 404。

### 5.3 页面文件清单（`pages/` 11 个【直读】）

| 文件 | 角色 |
|---|---|
| `dashboard.tsx` | 数据看板（`/`），最大页面（约 1100 行，含手写 SVG 图表） |
| `overview.tsx` | 全局概览（连接地址、接入示例） |
| `logs.tsx` | 使用日志（千行级表格 + 详情抽屉 + 浮层） |
| `channels.tsx` | 渠道列表 |
| `channel-detail.tsx` | 渠道详情/新建（多分区、Tabs） |
| `models.tsx` | 模型管理（导出 `ModelsPage` / `CombosRedirect`） |
| `keys.tsx` | 用户密钥 |
| `playground.tsx` | 模型试验 |
| `settings.tsx` | 系统设置 |
| `login.tsx` | 登录（域外视觉，固定深蓝） |
| `page-placeholder.tsx` | 占位页（未实现路由的兜底） |

配套业务组件目录：`components/channels/`、`components/logs/`、`components/models/`、`components/combos/`、`components/catalog/`、`components/layout/`（批 5 起 `catalog` 页往 `components/catalog/` 拆）。

### 5.4 导航的视觉契约（`layout/sidebar.tsx`【直读】）

| 元素 | 规格 |
|---|---|
| 侧栏宽 | 展开 `w-sidebar`(248)，折叠 `w-18`(72)，`transition-[width] duration-200` |
| 品牌区高 | `h-16`（64px），`border-r border-border bg-surface` |
| 导航区 | `px-3`（折叠 `px-2`），`overflow-y-auto`，`scrollbar-thin` |
| 组间距 | `mt-4 first:mt-1`；折叠态用 `border-t` 分隔 |
| 组标题 | `px-3 pb-1.5 text-2xs font-semibold uppercase tracking-[0.14em] text-muted-foreground` |
| 项 | `rounded-control py-2 text-2sm`；展开 `gap-2.5 px-2.5`，折叠 `justify-center px-2` |
| 项·激活 | `bg-primary-soft font-medium text-primary` + 左侧 `h-4 w-0.5 rounded-r-full bg-primary` 活动条 |
| 项·未激活 | `text-body hover:bg-surface-2 hover:text-title` |
| 图标块 | `h-7 w-7 rounded-md`：激活 `bg-surface text-primary shadow-xs`，常态 `bg-surface-2 text-muted-foreground` |
| 底部 | `border-t`，左 `v0.1.0`（`font-mono`）+ 右 env `Badge variant="success"` + 圆点 |

---

## 6. 与新仓（slipstream/web）的差异清单

> 对照文件：`slipstream/web/src/index.css`（139 行）、`slipstream/web/src/components/ui/`（41 件）、`slipstream/web/src/components/layout/app-shell.tsx`（172 行）。全部为【直读】。
> 结论先行：**新仓保留了「组件清单」，丢了「token 宪法」**——语义 token 层、阴影、动效、状态阶梯、品牌资产、门禁脚本六块系统性缺口，且旧规范里的反例没有任何一条被制度化拦住。

### 6.1 总览

| 面 | 旧仓 | 新仓 | 判定 |
|---|---|---|---|
| index.css | 427 行，三源齐备（变量 + `@theme` + `@theme inline`） | 139 行 | ❌ 收缩约 68% |
| ui/ 组件 | 42 件 | 41 件（缺 `sonner.tsx`） | ⚠️ 近似 |
| 语义圆角 / 阴影 / 动效 token | 有 | **全无** | ❌ |
| 字号四档 | 11/12/13/14 + 19/22 | 11/12/13/14 + 22(metric)/20(h1) | ⚠️ 例外档错位 |
| 控件高度阶梯 | 28/32/36/40/44 | 28/32（+ 40 仅 icon） | ❌ 三档消失 |
| 16 槽图表色板 | 有（32 个变量） | **无**（装 echarts+recharts） | ❌ |
| 品牌资产 | logo 3 件 + favicon + theme-color + 双行字 | 无 public/、无 favicon、"SS" 文本块 | ❌ |
| 导航 | 4 组 8 项 | 4 组 22 项 | ⚠️ 结构同、内容换代 |
| 门禁 | `lint:ui` + `/dev/ui` + 视觉快照 | 无 | ❌ |

### 6.2 逐条证据

**D-1 语义圆角层整体缺失**
旧：`llmapi/web/src/index.css:14-16` 定义 `--radius-control 8` / `--radius-card 12` / `--radius-badge 6`，组件用 `rounded-control`（`llmapi/web/src/components/ui/button.tsx:8`）、`rounded-card`（`llmapi/web/src/components/ui/card.tsx:10`）、`rounded-badge`（`llmapi/web/src/components/ui/badge.tsx:8`）。
新：`slipstream/web/src/index.css:10-13` 只有 shadcn 数值档，**且 `--radius-xl` 从 16 改成 14**；全仓 `rounded-control|rounded-card|rounded-badge` **0 命中**（grep 实测）；组件改用 `rounded-md`（`slipstream/web/src/components/ui/button.tsx:8`）、`rounded-lg`（`slipstream/web/src/components/ui/card.tsx:9`）、`rounded-sm`（`slipstream/web/src/components/ui/badge.tsx:7`）。
影响：数值等价但丢失「这是什么」的语义层；`xl` 与旧浮层内嵌容器差 2px。

**D-2 字号例外档互换（指标 > 标题）**
旧：`--text-metric: 19px/26`、`--text-h1: 22px/28`（`llmapi/web/src/index.css:33-36`）——**标题比指标数字大**。
新：`--text-metric: 22px/28`、`--text-h1: 20px/28`（`slipstream/web/src/index.css:22-25`）——**指标数字比页面标题大 2px**，h1 也从 22 降到 20。
影响：层级反转；`slipstream/web/src/components/stat-card.tsx` 用 `text-metric`、`slipstream/web/src/components/layout/app-shell.tsx:125` 的 h1 用 `text-h1`，两者并排时主次颠倒。

**D-3 文字层级 4 级 → 3 级（`--text-muted` 蒸发）**
旧：`:root` 有 `--text-title/--text-body/--text-muted/--text-faint` 四级（`llmapi/web/src/index.css:132-135`），并由 `--color-muted-foreground` 转发（`:117`）。
新：`slipstream/web/src/index.css:65-67` 只有 `--text-title/--text-body/--text-faint`；全仓 `muted-foreground|text-muted` **0 命中**。
影响：旧规范「辅助文字不得用 faint、faint 不承载正文」这条无法表达——所有次级文字只能落 `faint`，等于把「弱化」与「极弱」合并。

**D-4 shadcn 别名层整体缺席**
旧：`llmapi/web/src/index.css:217-233` 共 19 个别名 + `--radius: 8px`，并由 `@theme inline`（`:108-123`）转发成 `bg-background`/`bg-card`/`bg-popover`/`border-input`/`ring-ring` 等类。
新：`slipstream/web/src/index.css` 无此层；grep `bg-background|bg-popover|text-foreground|bg-muted|border-input|text-muted-foreground` = **0 命中**。
影响：当前不报错（没人用），但**再取任何 vendored 件都会踩空**：上游源码默认写 `bg-background`/`bg-popover`，取来即失效。旧仓正是靠这层才敢「只改 token 类、不改结构」（ADR-066 决策 3）。

**D-5 阴影 token 缺失 + 自写 box-shadow**
旧：`--shadow-card` / `--shadow-pop`（`llmapi/web/src/index.css:43-44`），Card 用 `shadow-card`（`llmapi/web/src/components/ui/card.tsx:10`），规范 §2.4 **禁止自写 box-shadow**。
新：无任何 shadow token；`slipstream/web/src/components/ui/card.tsx:9` 直接写 `shadow-[0_1px_2px_rgba(16,24,40,0.04)]`。
影响：旧规范最硬的一条被违反；且该值用 `rgba(16,24,40,.04)`，与旧 `rgba(17,24,39,.04)` 不同源，成为第二个「近黑」。

**D-6 动效 token 与 keyframes 缺失**
旧：`--animate-fade-up/fade-in`（`llmapi/web/src/index.css:46-47`）+ keyframes **写在 `@theme` 内**（`:50-67`），并留注释「keyframes 必须在 `@theme` 内才会随 `--animate-*` 输出」。
新：无 animate 变量、无 keyframes；grep `animate-fade-(up|in)` = **0**。
影响：那条「写进 `@layer utilities` 不生效」的踩坑经验随之丢失，下一次加动画必然重踩。

**D-7 布局宽 token 退化为任意值写法**
旧：`--width-sidebar: 248px`（`llmapi/web/src/index.css:41`）→ `w-sidebar`（`llmapi/web/src/components/layout/sidebar.tsx:18-20`、`llmapi/web/src/components/layout/app-shell.tsx:36`），且 ADR-066 §2 S3 明确「Tailwind 4 没有 `--w-*` 命名空间，只有 `--width-*` 能生成类」。
新：`--width-sidebar: 232px` + `--width-sidebar-collapsed: 56px`（`slipstream/web/src/index.css:15-16`），但组件写成 `w-[var(--width-sidebar)]`（`slipstream/web/src/components/layout/app-shell.tsx:65`）——**能跑，但退回任意值语法**；折叠宽从 72 变 56（32 的图标按钮容器偏窄）。

**D-8 按钮阶梯塌陷 + 主动作失去默认**
旧：6 variant（default/secondary/outline/ghost/danger/link）× 5 size（default 40 / md 36 / sm 32 / lg 44 / icon 40）（`llmapi/web/src/components/ui/button.tsx:12-29`），**默认 variant = default（primary 底）**。
新：5 variant（primary/secondary/outline/danger/ghost，无 `link`）× 3 size（sm 28 / md 32 / icon 32），**默认 variant = secondary、默认 size = md**（`slipstream/web/src/components/ui/button.tsx:11-24`）。
影响：① 36/40/44 三档消失，筛选栏与表单行只能 32；② 不显式写 `variant="primary"` 时主动作渲染成灰底，「一屏一个主动作」（旧原则 3）失去默认承载；③ 无 `link` 变体，次要动作少一档降级。

**D-9 焦点环策略降级**
旧：按钮自带 `focus-visible:ring-2 ring-focus-ring ring-offset-2 ring-offset-bg`（`llmapi/web/src/components/ui/button.tsx:8`）+ 全局 `:focus-visible { outline: 2px; offset: 2px }`（`llmapi/web/src/index.css:383-386`）双保险。
新：按钮无任何 ring 类（`slipstream/web/src/components/ui/button.tsx:8`），只剩全局 `*:focus-visible { outline: 2px; offset: 1px }`（`slipstream/web/src/index.css:136-139`）。
影响：offset 2→1（焦点环贴边，圆角处更易被裁）；且 `--focus-ring` 在新仓是 `rgba(15,118,110,.35)`（`slipstream/web/src/index.css:84`）、深色 `rgba(45,212,191,.4)`（`:113`）——**半透明焦点环对比度显著低于旧实色**，在 `surface-2` 上可能不达 3:1。

**D-10 主色语义换色，品牌三色失联**
旧：`--primary: #4f46e5`（`llmapi/web/src/index.css:137`）、深色 `#818cf8`（`:248`）——与 logo 主/次折线**同色**。
新：`--primary: #0f766e`（`slipstream/web/src/index.css:69`）、深色 `#2dd4bf`（`:98`）——青绿，与旧 logo 的 indigo 体系无关。
影响：这是一次**品牌重定向**，不是 token 迁移。沿用旧 logo → 标志与主色不咬合；沿用新主色 → logo 必须重做（而当前新仓连 logo 都没有，见 D-11）。

**D-11 品牌资产整体缺席**
旧：`llmapi/web/index.html:5` favicon→`/logo-v10-contrast.svg`、`:7` `theme-color #0B0F17`、`:8` title「驭流 Slipstream · LLM API 网关」；`llmapi/web/src/components/layout/sidebar.tsx:30-40` logo 36×36 + 双行字。
新：`slipstream/web/index.html:6` title「Slipstream 管理台」（**丢了中文名「驭流」与「LLM API 网关」定位**）；**无 favicon link、无 theme-color**；`slipstream/web/public/` **空目录**（0 文件）；`slipstream/web/src/components/layout/app-shell.tsx:69-71` 用 `SS` 文本方块（24×24 `rounded-sm bg-primary text-primary-on text-2xs font-bold`）代替标志。
影响：浏览器页签显示默认地球图标；中文语境下品牌名不可见；「SS」既不是 logo 也不是既定缩写。

**D-12 根排版提前改基（旧仓明令不要现在改）**
旧：`body { font-size: 14px; line-height: 1.65 }`（`llmapi/web/src/index.css:332-333`），且 ADR-066「token 映射」1 明确写：**body 本期不动**，等页面字号全部显式化后再单独立条改成 13/20。
新：`slipstream/web/src/index.css:126-127` 直接 `font-size: 13px; line-height: 20px`。
影响：改根字号会波及所有未显式声明字号的文本（旧仓刻意避开这一步）；新仓尚未把页面字号显式化就动根，等于两步并一步、失去可回滚点。

**D-13 `@layer base` 从 93 行缩到 24 行**
旧 `llmapi/web/src/index.css:309-401` 包含：全局 `border-color: var(--border)`、`color-scheme` 明暗、`svg text` 字体继承（图表轴掉衬线的修复）、`code/kbd/samp/pre` 字体、`h1-h4` 600 + `-0.01em`、`::selection`、autofill 覆盖、`:focus-visible`、placeholder 色、`button` 手型光标。
新 `slipstream/web/src/index.css:116-139` 只剩 `html/body/#root` 高度、`body` 三属性、`.tnum`、`:focus-visible`。
影响：`border` 无默认色（组件忘写 `border-border` 会掉到 currentColor）、`h1-h4` 无字重/字距、`svg text` 可能掉衬线、placeholder 用 Tailwind 4 的 50% 当前色（比旧 `text-faint` 更淡）。

**D-14 页签 title 仍未随路由变化（两仓共同缺口）**
旧：title 静态（`llmapi/web/index.html:8`），全仓 `document.title` **0 命中**。
新：`PAGE_TITLES` 由 `NAV_SECTIONS` 派生（`slipstream/web/src/components/layout/nav-items.ts:58-60`），只用于 `slipstream/web/src/components/layout/app-shell.tsx:55-58,125` 的 `<h1>`；同样 **0 处 `document.title`**。
判定：不是回归，是**两仓都没做**；新仓只需一个 `useEffect` 即可闭环，建议与品牌重做一并补。

**D-15 导航结构换代（4 组 8 项 → 4 组 22 项）**
旧：常规/配置/工具/系统（`llmapi/web/src/lib/navigation.ts:25-69`），8 项。
新：监控/工具/主数据/治理（`slipstream/web/src/components/layout/nav-items.ts:13-56`），22 项；`/` 从「数据看板」变成「总览」，`/dashboard` 另立「看板」。
影响：旧仓「导航表 = 路由表输入」的机制消失（新仓没有 `IMPLEMENTED_PATHS` / `PagePlaceholder` 兜底），菜单与路由要手工对齐。

**D-16 侧栏项样式简化（丢了选中态的第二、第三载体）**
旧：`rounded-control py-2 text-2sm` + 28×28 图标块（激活 `bg-surface shadow-xs`）+ 左侧 2px 活动条（`llmapi/web/src/components/layout/sidebar.tsx:82-111`）。
新：`h-8 rounded-md px-2 text-2sm`，激活只 `bg-primary-soft font-medium text-primary`（`slipstream/web/src/components/layout/app-shell.tsx:91-92`）；无图标块、无活动条、`title={item.label}` 常开（`:88`）。
影响：违反旧 §11.1.3「状态必须有第二个载体」——灰度截图下选中项只剩亮度差（`primary-soft` 与 `surface` 在浅色下差约 4%，几乎不可辨）。

**D-17 顶栏重构（64px → 48px；面包屑 → h1）**
旧：`h-16`（64）+ `border-b` + 折叠按钮 + 面包屑（组名 → 当前页）+ 全局搜索 + 时区开关 + env 徽章 + 主题菜单 + 账号菜单（`llmapi/web/src/components/layout/topbar.tsx:59-153`）。
新：`h-12`（48）+ `border-b` + 页面 h1 + Mock 徽章 + `API_BASE` 文本 + 配置版本徽章 + 搜索 + 刷新 + 主题分段按钮（`slipstream/web/src/components/layout/app-shell.tsx:124-161`）。
影响：无层级导航（h1 只有当前页，没有「组 → 页」）、无时区切换、无账号/登出入口。

**D-18 内容容器失去最大宽**
旧：`<main>` 内 `mx-auto w-full max-w-480 px-4 py-6 sm:px-6 lg:px-8 lg:py-8`（`llmapi/web/src/components/layout/app-shell.tsx:52`）。
新：`<main className="min-h-0 flex-1 overflow-y-auto p-4">`（`slipstream/web/src/components/layout/app-shell.tsx:163`）。
影响：超宽屏表格会拉满到 2560+（旧仓有 1920 上限）；页面 padding 从响应式 16/24/32 固定成 16。

**D-19 Empty 退回「一句话」形态**
旧：`llmapi/web/src/components/ui/empty.tsx` 三件套——48px 圆底图标（`:13`）+ 标题/说明（`:38-41`）+ CTA（`:42`），容器 `gap-4 px-6 py-12`（`:28`）。
新：`slipstream/web/src/components/ui/empty.tsx:5-11` 只有 `{ text, action? }`，渲染成 `<p class="text-sm text-faint">{text}</p>`。
影响：**这正是旧 §4.8 与 §11.10 #10 明确判错的那个形态**（无图标、无标题/说明分层）；`slipstream/web/src/components/data-table.tsx:35` 的 `emptyText = "暂无数据"` 把它固化成了默认值。

**D-20 Badge 语义改名 + 去掉边框**
旧：`variant: default/secondary/success/warning/danger/outline`（`llmapi/web/src/components/ui/badge.tsx:11-18`），`tone` 是 `variant` 的别名（`:28-33`）；每个变体都带 `border-{state}` + `bg-{state}-soft` + `text-{state}-text` 三件（`:12-17`）。
新：`tone: neutral/primary/success/warning/danger/info`（`slipstream/web/src/components/ui/badge.tsx:10-17`），**无 border**，且不再接受 `variant`。
影响：① 调用点必须全量改名（`default→primary`、`secondary→neutral`、`outline` 无对应）；② 边框原本是状态的第二载体，现在只剩底色+文字。

**D-21 表格层换代：引入 TanStack Table（旧 ADR 明确 prune 的依赖）**
旧：只有样式原子 `ui/table.tsx` + `ui/pagination.tsx`，排序/筛选由页面自己写（`llmapi/docs/ui-adoption-map.md` §1 的 42 件清单里没有 data-table 基元）。
新：`@tanstack/react-table ^8.21.3`（`slipstream/web/package.json:35`）+ 统一封装 `slipstream/web/src/components/data-table.tsx`（排序/全局筛选/分页/骨架/空态/错误态，`:34-63`；页大小固定 25/50/100/200，`:15`）。
判定：**功能升级，但推翻了 ADR-066 决策 7**（原文 prune `@tanstack/react-table`，「表格只取样式层」）。要么更新决策记录，要么承认两套表格范式并存。

**D-22 图表层换代：16 槽色板消失**
旧：手写 SVG + `chart-1..16` 双主题 32 个变量（`llmapi/web/src/index.css:197-212` / `291-306`）+ `lib/chart-colors.ts` 的 `assignCategoryColors`；ADR-066 决策 6/7 明确「不取 shadcn charts、不装 recharts」。
新：`echarts ^6.1.0` + `recharts ^3.10.1`（`slipstream/web/package.json:40,47`）；grep `chart-[0-9]` = **0 命中**。
影响：跨图表没有共享色板 → 同一模型在看板/成本页可能不同色，正是 ADR-040 要消除的问题；且两套图表库并存。

**D-23 门禁与防护归零**
旧：`npm run lint:ui` = `node scripts/lint-ui.mjs --max-warnings 19`，8 条规则（原生 select/table/checkbox/radio/dialog、任意字号/尺寸、inline hex、`dark:` 分域、title-only tooltip）+ `/dev/ui` 组件画廊 + 7 张视觉快照（`maxDiffPixelRatio: 0.002`）。
新：`slipstream/web/package.json:6-12` 只有 `dev/build/lint/typecheck/format`（`lint` = eslint，无 UI 规则）；无 `/dev/ui`、无视觉快照、无 `scripts/lint-ui.mjs`。
实测印证：新仓仍有 **13 处任意值**（`shadow-[` / `text-[Npx]` / `h-[Npx]`）分布在 9 个文件（`components/dashboard/flow-sankey.tsx`、`components/playground/params-panel.tsx`、`components/ui/alert.tsx`、`components/ui/card.tsx`、`components/ui/command.tsx`、`components/ui/label.tsx`、`components/ui/metric-pills.tsx`、`components/ui/separator.tsx` 等）——**没有门禁就会长回来**，这正是旧仓三周返工的成因。

**D-24 Toast 接线退化**
旧：`llmapi/web/src/components/ui/sonner.tsx` 读 `useThemeMode()` 绑主题（`:14-19`）、`visibleToasts={4}`、`duration: 5200`、语义 classNames（`:21-33`）。
新：`ui/` 无 `sonner.tsx`（41 件 vs 42 件）；`slipstream/web/src/main.tsx:22` `<Toaster position="top-center" richColors />`——**未绑主题**、无条数上限、无时长策略。
影响：深色界面下 sonner 走默认 light 主题（`richColors` 还会覆盖状态色）；旧「最多 4 条 / 错误停留更久」两条规则无实现。

**D-25 图标按钮的无障碍回退**
旧：每个 icon 按钮都有 `aria-label`（`llmapi/web/src/components/layout/topbar.tsx:65,75,116`、`sidebar.tsx:48`），规范 §6 第 8 条把「只靠 title」列为阻断项。
新：刷新按钮 `<Button variant="ghost" size="icon" title="刷新全部数据">`（`slipstream/web/src/components/layout/app-shell.tsx:140`）——**只有 title，无 `aria-label`**；主题按钮则同时给了 `title` + `aria-label` + `aria-pressed`（`:148-150`），说明是漏写而非策略。

### 6.3 差异的优先级建议

| 优先级 | 缺口 | 为什么先补 |
|---|---|---|
| P0 | D-1 / D-4 语义 token 层（圆角语义档 + shadcn 别名层） | 这两个是「取 vendored 件不改结构」的前提；缺了之后每次取件都要手改类名，等于退回 ADR-062 之前 |
| P0 | D-5 / D-6 阴影与动效 token | 自写 `shadow-[…]` 已在仓库里，会自我复制 |
| P0 | D-11 品牌资产（logo / favicon / title） | 页签默认图标 + 中文品牌名丢失，用户第一眼就能看到退化 |
| P1 | D-2 / D-3 字号与文字四级 | 层级反转（指标 > 标题）会持续误导页面作者 |
| P1 | D-8 按钮三档与默认 primary | 32 一档撑不起表单页与筛选条；主动作靠记忆写 |
| P1 | D-19 / D-20 Empty 与 Badge 形态 | 旧规范判错过的形态正被固化成默认值 |
| P1 | D-23 门禁（至少 `lint:ui` 的 8 条规则） | 没有它，以上每一条都会在三个月内重新长回来 |
| P2 | D-9 焦点环、D-16 侧栏选中、D-25 aria-label | 无障碍退化，影响键盘/读屏用户 |
| P2 | D-21 / D-22 表格与图表范式 | 功能升级，但需补一份新 ADR 说明「为什么推翻 ADR-066 决策 6/7」 |
| P3 | D-12 / D-13 根排版与 base 层、D-17 / D-18 壳层尺寸 | 属整体重排，适合与页面重构同批 |

---

## 7. 复现与索引

### 7.1 关键命令

`@bash
# 旧仓：组件清单与 token 面
cd llmapi/web
ls src/components/ui/*.tsx | wc -l                      # 42
rg -n -- "--radius-(control|card|badge)|--shadow-(card|pop)|--animate-" src/index.css
rg -n -- "chart-(1|16):" src/index.css                  # 浅 197 / 深 291

# 旧仓：规范的反例现状（对齐 lint-ui 规则）
rg -n "text-\[\d+(\.\d+)?px\]|\b[hw]-\[\d+px\]" src --glob '!src/components/ui/**'
rg -n "<select|<table" src/pages src/components --glob '!components/ui/**'
rg -n "window\.confirm|document\.title" src

# 新仓：缺口复核
cd slipstream/web
rg -n "rounded-(control|card|badge)|shadow-(card|pop)|animate-fade-(up|in)|chart-[0-9]" src   # 期望 0
rg -n "bg-background|bg-card|bg-popover|border-input|text-muted-foreground" src            # 期望 0
ls public                                                                                   # 期望空
`@

### 7.2 文件索引（旧仓）

| 主题 | 文件 |
|---|---|
| 规范正文（token / recipe / 清单 / §11） | `llmapi/docs/ui-standards.md`（830 行） |
| 现状台账（42 件 × 调用点、门禁阶梯、欠账表） | `llmapi/docs/ui-adoption-map.md`（216 行） |
| 技术栈取舍 | `llmapi/docs/ui-stack.md` |
| 迁移决策 | `llmapi/docs/adr/ADR-064-full-shadcn-migration.md` |
| token 语义与批 4 映射 | `llmapi/docs/adr/ADR-066-token-semantics-adoption.md`（135 行） |
| token 唯一实现 | `llmapi/web/src/index.css`（427 行） |
| 品牌与外壳 | `llmapi/web/index.html`、`llmapi/web/public/logo.svg`、`llmapi/web/public/logo-v10-contrast.svg`、`llmapi/web/public/favicon.svg`、`llmapi/web/src/components/layout/app-shell.tsx`、`llmapi/web/src/components/layout/sidebar.tsx`、`llmapi/web/src/components/layout/topbar.tsx` |
| 导航真源 | `llmapi/web/src/lib/navigation.ts`（83 行） |
| 路由真源 | `llmapi/web/src/App.tsx` |
| 基元样板 | `llmapi/web/src/components/ui/button.tsx`、`card.tsx`、`badge.tsx`、`empty.tsx`、`metric-pills.tsx`、`sonner.tsx` |
| 图表取色 | `llmapi/web/src/lib/chart-colors.ts` |

### 7.3 一句话总结

旧仓 UI 规范真正的资产不是那 42 个组件，而是**三层约束网**：token 唯一出口（`index.css` + `@theme inline`）、基元单一来源（`components/ui/`）、门禁防回流（`lint-ui` + `/dev/ui` + 视觉快照），外加一份写成判例法的 §11（每条规则都带真实 file:line 反例）。新仓继承了组件清单，三层约束网只剩第一层的残片——所以 §6 的差异不是「样式没对齐」，而是**约束消失后必然发生的漂移，而且已经开始了**。



