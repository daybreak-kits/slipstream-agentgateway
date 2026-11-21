# 设计巡检记录（unslop 轻量轮）

- 时间：2026-11-18
- 对象：`web/src`（五期口径 19 个页面模块 = 17 功能页 + 登录 + 404，另有布局/外壳与设计 token；二期巡检当时为 23 个页面组件）
- 方法：静态检索设计 tells（渐变/发光/emoji/主色/动效/阴影/字体）+ 交互审计逐页截图目视 + `web/src/index.css` token 表核对。
- 结论：**未发现典型 AI 味**（渐变文字、霓虹发光、emoji 标签、玻璃拟态、多主色混用、夸张 hover 缩放）；仅 2 处渐变属有意设计，已登记如下。

> **五期（W5）状态**：五期能力已全部实现（路由链/冷却互斥/多密钥平权/公开模型单页等），本文件 §1 至 §17 为实现与规范记录；五期的实现落点、门禁证据与验收矩阵见 §17/§18。与实现冲突的旧描述已就地修正并标注（2026-11-21 ticket 17 收口）。

## 逐项核对

| 检查项 | 结果 | 证据 |
|---|---|---|
| 渐变文字 / 多色渐变装饰 | 无 | `web/src` 无 `bg-clip-text`、`text-gradient`；全仓 3 处 `linear-gradient` + 3 处 `radial-gradient`：`web/src/index.css:459-460` 用于 1px 网格背景线、`:473-476` 为登录页多层柔光渐变（W7 ticket 13，功能性背景，非装饰；门禁见 §20） |
| 发光 / 玻璃拟态 | 无 | 无 `drop-shadow`、`blur-*`、`backdrop-blur`、glow 类；阴影只有 2 个 token：`--shadow-card`、`--shadow-pop`（`web/src/index.css:34-35`） |
| 单一主色 | 是（靛蓝） | `--primary: #4f46e5`（浅色）/ `#818cf8`（深色），`--primary-soft: #eef2ff`；success/warning/danger 只作状态色；图表 16 槽独立（`web/src/index.css:141-208`） |
| emoji 标签 | 无 | `web/src` 无 emoji；图标统一 `lucide-react` |
| 夸张动效 | 无 | `animate-pulse` 仅 2 处：流式输出光标（`components/playground/message-list.tsx:319`）、骨架屏（`components/ui/skeleton.tsx:4`）；`animate-spin` 仅 `components/ui/spinner.tsx:7` 且带 `motion-reduce:animate-none`；无 `hover:scale`/`hover:-translate` |
| 字体与圆角 | 统一 token | `--font-sans: Inter, "Noto Sans SC", "PingFang SC", "Microsoft YaHei", sans-serif`；`--font-mono: "JetBrains Mono"`；圆角 6/8/12/16（`--radius-*`，`web/src/index.css:11-17`） |
| 图表连线渐变 | 有意设计 | `web/src/components/dashboard/flow-chart.tsx` 的 sankey `lineStyle`（`color: "gradient"`, `opacity: 0.26`）：连线按源/目标色渐变，透明度已压低，不构成发光感；该文件同时承载分流图隐藏阶段的图例交互（§18 工单 01） |
| toast 遮挡表单 | 已修 | 统一策略在 `web/src/lib/toast-policy.ts`（`TOAST_POSITION="top-right"`、`TOAST_OFFSET={top:80,right:16}`、3000ms、最多 3 条）；`components/ui/sonner.tsx` 的 Toaster 用 `position={TOAST_POSITION}` / 同一 offset，`web/src/main.tsx` 不覆盖。7abfb6b 的 `bottom-right` 方案已废弃（会压住表格底部与 sticky 操作列），本表旧描述已按实际修正 |
| 控件可读名称 | 已修 | `pages/settings.tsx` 显示名/邮件通知/浏览器通知/周报摘要/个人简介补 `aria-label`；三个通知开关改由 `NOTIFY_PREFS` 列表统一渲染 |
| 登录页配色 | W6 票12 重设计 / W7 票13 渐变增强 | 可见但克制的多层柔光渐变根容器（3 层 radial 色场 + 极淡纵向承托，静态不动画，单层强度 ≤22%）+ 三态主题（跟随全站主题状态）+ 登录框三档宽度 384/460/576 + 密码显隐 + 错误区固定预留；`web/src/index.css` 登录域 token 与矮视口压缩契约在位，`pages/login.tsx` 为唯一实现 |

## 复跑方式

```bash
# 逐页控件操作 + 截图（证据在 ops/checks/.logs/interaction/<时间戳>/）
node ops/checks/interaction_audit.mjs --channel msedge

# 设计 tells 静态复查
grep -rn "bg-gradient\|text-gradient\|drop-shadow\|blur-\|hover:scale\|animate-pulse" web/src
```

> 本巡检是静态/半自动核对，不替代设计评审；视觉回归以 `interaction_audit.mjs` 的逐页截图为准。

## 组件原语化整改（2026-11-18，4826e50）

审计发现：`components/ui/` 已有 42 个原语，但 `pagination`、`dropdown-menu`、`progress`、`input-group`、`field`、`form`、`combobox` 七件零引用（本轮启用 `pagination`，其余 6 件仍零引用，非自写控件、按需再接入）；同时 13 个页面/组件仍直接写原生 `button/select/checkbox/textarea/text input/table`，看板 Tab 与顶栏主题分段还是手写实现（无键盘导航、无 roving tabindex）。

整改规则（后续新增页面同样遵守）：

1. 页面与业务组件不得直接写原生 `button/select/checkbox/textarea/input[type=text|number|password]/table`，一律用 `components/ui/` 原子；`components/ui/` 内部实现可以用原生元素。
2. 例外仅两类：隐藏的 `<input type="file">`（原语无对应件）、表格的 `<tbody>`（Radix 无 table 语义件，行/单元格用 `TR/TD/TH`）。
3. Tab 用 `ui/tabs`（`Tabs` 内部状态 / `TabBar` 受控），键盘 ←/→、Home/End 与 aria 由 Radix 提供；分页用 `ui/pagination`；主题等单选分段用 `ToggleGroup type="single"`；表单控件用 `Input/Select/Checkbox/Textarea/Label`；表格用 `TableWrap/Table/THead/TR/TH/TD`。

本轮实际改动（17 文件，+224/−231）：

| 位置 | 原实现 | 现实现 |
|---|---|---|
| `web/src/components/ui/tabs.tsx` | 手写 `div role=tablist` + `button role=tab`，无键盘 | `@radix-ui/react-tabs`；`Tabs/TabBar` API 不变，补 ←/→、Home/End、roving tabindex |
| `web/src/components/dashboard/trend-panel.tsx` | 手写三 Tab `button` | `TabBar`（`aria-selected` 由 Radix 维护，URL `?tab=` 联动不变） |
| `web/src/components/data-table.tsx` | 手写「共 N 条 + 原生 select + 上一页/下一页」 | `ui/pagination`（首页/上一页/页码省略/跳页/下一页/末页，当前页 `aria-current="page"`） |
| `web/src/components/layout/topbar.tsx` | 手写三段主题 `button aria-pressed` | `ToggleGroup type="single"`（`radiogroup`/`radio` + `aria-checked`） |
| `web/src/pages/settings.tsx` | 三张主题卡 `button aria-pressed` | `ToggleGroup type="single"`，卡片外观与勾选标记不变 |
| `web/src/components/transforms/transforms-editor.tsx` | 原生 `select`×2、`checkbox`、`textarea` | `Select`×2、`Checkbox`、`Textarea`（op/condition mode 仍是字符串枚举） |
| `web/src/components/upstreams/keys-panel.tsx`、`web/src/pages/upstreams.tsx` | 原生 `checkbox` | `Checkbox`（`onCheckedChange(checked === true)`） |
| `web/src/pages/client_keys.tsx` | 充值原生 `input`、流水原生 `table` | `Input`（保留 `h-auto px-3 py-2 text-sm` 视觉）、`Table` 原子 |
| `web/src/components/global-search.tsx`、`stat-card.tsx`、`dashboard/member-panel.tsx`、`playground/composer.tsx`、`playground/session-list.tsx` | 9 个原生 `<button>` | `Button`（`variant=link/ghost`，保留 aria-label/title/disabled；会话行用 flex-col items-stretch 保持 truncate） |
| `web/src/components/dashboard/latency-cards.tsx`、`web/src/components/logs/query-syntax-help.tsx` | 原生 `table` | `TableWrap/Table/THead/TR/TH/TD` |
| `web/src/pages/login.tsx` | 手写登录卡片壳（div + 边框/内边距） | `Card` |

验证：

- `cd web && npx tsc --noEmit` exit 0；`npx eslint src` 0 error；`npm run build` 成功。
- `node web/scripts/check-ui-foundation.mjs` → 37/37（原语样式/术语门禁未因改动回流）。
- 针对性交互审计（14 条受影响路径，`ops/checks/.logs/interaction/20261118-180043/report.md`）：控件 1363 / 已操作 999 / 禁用 199 / 弹层 152 / 软问题 15（全部是上游列表与上游详情里审计主动提交不完整表单触发的 toast/422 提示）/ **硬失败 0**，exit 0。
- Playwright 手工探针（截图 `ops/checks/.logs/ui-refactor/20261118-175718/`）：看板 Tab 键盘 ←/→ 切换后 `?tab=area` 与 `aria-selected` 跟随；顶栏/设置页 ToggleGroup 切深色生效并落库（toast「主题已保存」）；日志查询语法弹层 11 行表格；模型试验会话/参数面板渲染正常；console error 0、pageerror 0。

## 三期前端设计规范（2026-11-19 用户裁定，吸收 unslop 工艺）

三期所有页面重做以本节为准；与旧系统 `slipstream-python/docs/ui.md` 通则冲突时以本节为准。

### 1. 卡片与布局（修「块边界差别大」）

- 全站 4px 网格；卡片 padding 20 至 24，页面边缘 24 至 32，侧栏行高 32 至 36、行距 2 至 4。
- 同层卡片**统一**一套边界 token：`--radius-12` + hairline 边框（文本色 6 至 10% 透明度）+ `--shadow-card`；页面不得自定边框粗细/颜色/圆角/阴影档位。
- 组内间距 < 组间间距；图标、标签、数字各自成列对齐；数字 `tabular-nums` 右对齐。
- 每屏一个视觉重点（主图表或关键对象），chrome（导航/按钮/边框）保持安静：无渐变文字、无发光、无彩色阴影、无 emoji。

### 2. 表格规范

- **列显隐**：表格工具区「列设置」（`ui/dropdown-menu` + 复选），持久化 key `slipstream.cols.<page>` 存 localStorage（列 key JSON 数组），含「恢复默认」；前端记忆跨会话生效。
- **排序**：可排序列（时间/词元/费用/耗时）点击表头循环 升→降→取消，图标指示；**取消独立排序下拉**；默认时间倒序。
- **两行式单元格**：主行 primary 文本、次行 muted 小字（时间+状态码 / 模型·路由+流式·优先级·接口类型 / 花费+本·利）。
- 空态区分「无数据 / 无匹配」，无匹配给「清除筛选」CTA；loading 与 empty 不同屏；**批量操作条放筛选行尾**，不得插入新块挤开布局。
- 数字列右对齐；sticky 表头沿用。

### 3. 可搜索下拉

- 上游渠道、公开模型、用户、密钥等实体筛选一律 `ui/combobox`（Popover + cmdk，远程搜索 250ms 防抖）；占位文案写清搜什么（如「搜索上游名称/标识」「搜索用户编号或名称」）；空值哨兵 `SELECT_ALL_VALUE` / `SELECT_NONE_VALUE`。

### 4. 危险操作与 toast

- 三档确认（`ui/confirm-dialog`，取消在左、危险在右，正文写明不可逆后果）：① 删除（单条/批量）红色确认；② 重置密钥确认 + 新密钥仅明文展示一次；③ 批量删除 >10 条需手动输入「删除」二字。
- 启用/关闭/冷却/解除等可逆操作**不弹确认**。
- toast：sonner 单一 Toaster（top-right，下移 80px 避开 64px 顶栏与页面操作行；**最多同时 3 条**）；**统一 3 秒自动消失**（`lib/toast-policy` 强制，调用方不可延长）且关闭按钮常驻；每条 toast 同时写入顶栏通知中心，需要持续可见的反馈回看历史；复制成功统一「已复制」；API 错误统一 `describeApiError` 文案。

### 5. 数字与格式化（`lib/format` 单一来源，禁止页面自写）

| 场景 | 规则 |
|---|---|
| 计数 / 词元 / TPM / 尝试次数 | 千分位整数（`fmtInt`，如 1,234,567）；卡片、表格、tooltip 一律不缩写 |
| 图表轴 | 只有坐标轴允许 K/M/B 紧凑格式，且只留整数（`fmtCount`，如 566K） |
| RPM | 2 位小数（`fmtRpm`） |
| 百分比 / 比率 | 1 位小数（`fmtPct` 收 0 至 1 比例，`fmtPctPoint` 收已是百分数的值）；缓存命中率口径见 GLOSSARY §5 |
| 金额（表格 / 汇总 / KPI） | 2 位小数（`fmtMoney`）；未配置显示「-」，不渲染 0 |
| 单请求金额 / 均值 | 4 位小数（`fmtMoneyAvg`），避免单次请求被舍成 ¥0.00 |
| 单价（元 / 1M 词元） | 2 位小数；< 0.01 升 4 位（`fmtPriceAmount` / `fmtPricePerM` / `fmtUnitPriceMicro`） |
| 延迟 | 秒（s）2 位小数 |
| 缓存比例 | 缓 ÷（入+缓），见 GLOSSARY §5 |
| 已取消的旧口径 | 六位小数金额、带小数的 K/M/B 紧凑计数 |

### 6. 动效

- 只 transition color/background/border/opacity/transform，用具名类（`transition-colors` 等），禁止 `transition-all`。
- 动画类走 `tw-animate-css`（Tailwind v4 等价替代 tailwindcss-animate）：`web/src/index.css` 顶部已 `@import "tw-animate-css"`，`animate-in/zoom-95/slide-in-from-*` 均可用（五期已落，历史「补装 tailwindcss-animate」条目不成立）；浮层动效 = fade + 上移 95ms 一档。
- 无循环动画（例外：流式光标、骨架屏、spinner 带 `motion-reduce:animate-none`）。

### 7. 术语门禁

- `ops/checks/terminology_audit.mjs` 为唯一术语门禁（W6 ticket 20 起现行 12 条规则）：`收费`、厂商名 `qax|qianxin`、`Tokens`、单数 `Token`（warn）、裸「渠道」（`上游渠道` 复合词放行）、`调用模型|调用名|调用串|计划窗口|游乐场`、`封禁|对外模型|客户端密钥`、`令牌`、旧英文产品名（`LLM API 网关/LLM API GATEWAY` 等，正名「模型接口网关」）、数据面版本语句（`AG 1.7`/`pinned AG`，能力文案走适配器 capability_note）、em dash（缺值「-」/区间「至」/正文改标点）、en dash 区间（统一「至」）；扫描范围是 `web/src` + `index.html` + `public`，并新增现行 docs 扫描（README + 现行规范/契约文档；DECISIONS 等 ADR 原文与历史归档不在清单内）。em/en dash 规则带 baseline 棘轮（`ops/checks/terminology_baseline.json`）：baseline 内残留只提示，新增违规 EXIT=1。允许「上游渠道」「关闭/启用」「快速上手」「代理用户」；UI 禁裸「渠道」、禁「封禁」。


## 四期·表格与分页规范（2026-11-19 用户定案）

全站一切表格页面（DataTable / ModelsTable / 密钥面板表 / 审计 / 用户 / 角色等）按本节执行。

### 1. 排序
- 表头整格可点即排序，循环 升 → 降 → 取消（取消=回默认序），箭头指示当前方向；可排序列鼠标 hover 有可点暗示，不可序列无箭头。

### 2. 对齐与冻结
- **同列的表头与表体对齐方式必须一致**：数值列右对齐（`tnum`），文本列左对齐，状态/徽章列选定一种后头身一致。列定义的对齐类必须同时作用于 `th` 与 `td`。**已实现（W5）**：`web/src/lib/table-columns.ts` 为 align/sticky 单一来源，`DataTable/ModelsTable/PriceTable` 头身同用；`web/scripts/check-ui-foundation.mjs` 有「列元数据 align/sticky 头身同用、冻结列在最后一列、垂直居中」断言（历史 `ModelColumn.className` 只上 td 的缺陷已修）。
- **操作列 = 最后一列 + 水平冻结**（`sticky right-0` + 背景与分割阴影），小屏横向滚动时操作始终可见；所有页面操作列统一靠尾部。**已实现（W5）**：`web/src/components/ui/table.tsx` 给冻结列补不透明行底色（`--row-hover` 联动），`check-ui-foundation.mjs` 断言行操作文件必须在列元数据声明 `sticky:"right"` 且冻结列位于最后一列。

### 3. 滚动：表格内部滚动，页面不滚
- 大表一律**表体内部滚动**：滚动区内表头吸顶；筛选行、工具行、分页条都在滚动区外常驻。
- 滚动区高度自适应视口（flex 容器 + `min-h-0`，或等价 `calc` 上限），不允许整页滚动替代。
- 理由：整页滚动会让表头滚丢、翻页条不可达。

### 4. 分页规划
- 统一 `ui/pagination`：左侧「总计 N 条 + 每页行数（档位后端下发）+ 跳到 X 页」；右侧「首页 / 上一页 / 页码窗口（当前页居中，≤7 页全出，更长折叠省略号）/ 下一页 / 末页」。多页时必须展示页码组供直接点击。
- **实现红线**：分页 `nav` 必须带 `position:relative`。sr-only 状态段（`position:absolute`）的包含块不得逃逸到根元素，否则其静态位置落在长页面深处时会把 html scrollHeight 顶到内容底部，整个窗口变成可滚动、滚下去全是空白（2026-11-19 全站「滑下来一大块空白」事故根因，已在 /models@1333×643 活体复现并验证一行修复）。

### 5. 语义色条（新 pattern）
- 日志耗时类单元格 = 「竖色条 + 标签 + 数值」两行：`首字 x.xxs` / `耗时 x.xxs`，字号一致，标签写明「首字」「耗时」；色条按阈值语义化（绿=快 / 黄=中 / 红=慢；阈值集中定义一处，参考 newapi 形态）。

### 6. 列设置与行内操作
- 列设置菜单项标签与表头同步；标签不得在菜单里溢出换行（长名缩短，如「价格（入 / 出 / 倍率）」→「价格」，或菜单加宽兜底）。
- 行内操作统一「图标 + 短词（2 字为主）」，危险动作红色；批量操作按钮统一带图标，不得有的有有的没有。

## 四期增补（2026-11-19 第二批用户裁定）

### 8. 看板指标卡布局
- 网格模板 = **两行 × 每行 6 卡**（`grid-cols-6` 起步，响应式降档 6→4→3→2）；卡片组成与填充见规划（待拍板项：12 卡清单）。

### 9. 表格高度
- 表格区域**默认撑到当前页面最底部**（页面纵向 flex 布局，表体滚动区 `flex-1 min-h-0`），配**最小高度**（默认 `min-h-80`）兜底单页多表场景：多表时每表至少保住最小高度，页面才允许整页滚动。

### 10. 列设置强制
- 凡是表格必须有列设置（列显隐 + 持久化）；无列可隐的极简表（如密钥面板小表）例外需注明。

### 11. 延迟分位色（阈值色，独立于 §17 语义色五档）
- 首字/耗时的分位色**不锁死绝对毫秒值**，按当前时间窗的分位数动态锚定：**≤P50 绿、P50 至 P95 黄（P75 为黄色锚点）、>P95 红**；分位数来自报表延迟端点（`all` 全样本块），随窗口刷新。实现见 `web/src/components/logs/latency-tone.ts`（日志耗时竖色条 + 标签），与 §17 的 success/warning/info/danger/neutral 五档语义色是两套机制：本节的绿/黄/红只表示延迟分位阈值，不得与语义色函数混用或互相覆盖。

### 12. 图标体系（lucide-react 单一来源）
- 动作动词 → 图标映射表集中一处（`lib/icon` 或等价）：编辑=Pencil、删除=Trash2、关闭=Ban、启用=Play、测试连接=PlugZap、刷新=RefreshCw、复制=Copy、详情/查看=Eye、添加=Plus、冷却=Timer/Snowflake、周期=CalendarClock、批量=Layers、导出=Download、导入=Upload。
- 行内操作与批量操作按钮 = 图标 + 短词（2 字为主）；纯图标按钮必须带 `title`/`aria-label`。
- 语义色跟随动作性质：危险=红、可逆启停=中性、成功反馈=绿；图标与语义色规范一并进 terminology/ui 门禁。

### 13. 操作显隐红线 = RBAC 权限键（2026-11-19 用户裁定）
- 任何操作按钮的显隐**一律查权限键**（`usePermissions().can(...)`，41 键目录），**禁止按实体类型/角色名硬编码**（如"只对代理用户显示充值"是错误做法；正确=有 `billing:spend` 权限才显示充值）。

### 14. 看板卡片定案（只拆不加）
- 仅拆用户点名的两处：词元卡拆出「缓存」卡（命中率）；速度卡拆成 RPM、TPM 两卡。**其余卡片一律不动**（请求量 / 词元 / 缓存 / 费用 / 成本·毛利率 / P50 延迟 / RPM / TPM 共 8 卡），大屏按每行 4 卡铺开（4+4），响应式降档；**不新增卡片**。

### 15. 确认弹窗校准（定案）
- 「保存并下发」（网关策略页）与「开始导入」（价目导入）加确认：前者显示影响摘要（变更分区数），后者显示覆盖行数。
- 「匿名尝试」确认与匿名探测分支**整体删除**：创建上游后端强制 api_key 非空（schemas.py min_length=1）、删最后一把 409，空上游不可能存在（2026-11-20 用户裁定「拒绝保存空上游」重申；实测库内 8 上游零空上游），该分支为死路径。
- 「轮换主密钥」随主密钥概念废除（ADR-026）一并消失，无此入口。

### 16. 上游密钥状态可视化
- 逐把「测试连接」的结果落在密钥行：**失效密钥标红**（danger 语义色），成功标绿，未测为中性；与 ADR-026 的逐把测试配套。

### 17. W5 语义色、脏标记与 toast 原语（ticket 09）
- 语义色五档 = 成功绿 / 警示琥珀 / 信息蓝 / 危险红 / 中性灰；token 三件套 `--{tone}` / `--{tone}-text` / `--{tone}-soft`（index.css）。`lib/semantic-tone` 提供 tone → 文字/浅底/描边工具类映射，页面不得自拼裸色。
- 动作语义色单一来源 `lib/icons.ACTION_TONES`：启用=success、关闭/冷却=warning、解除=success、测试=info、删除=danger、编辑=neutral；行内操作统一用 `ui/action-button`（图标 + 文字双编码，不只靠颜色）。
- 脏标记原语：`lib/dirty-fields`（diffFields/sameArray/sameSet/sameJson）+ `lib/use-dirty-fields` + `ui/dirty-field`（DirtyField 字段浅底/「已修改」点/恢复该项（W7 收口：左侧 2px 警示线已去除）；DirtyCountBadge 区块计数；DirtySummary/DirtyFooter 底部「未保存 N 项 + 恢复全部」；DirtySaveButton 脏=主按钮、干净=中性 disabled、保存中进度）。只标变更字段，保存成功由父级回填 baseline 清标记，失败保留标记与输入。
- toast 策略集中 `lib/toast-policy`：统一 3 秒、右上（offset top 80）避开顶栏/表格底部/sticky 操作列；持续反馈进通知中心（`lib/notification-store`）。

## 18. 五期（W5）实现清单（2026-11-21 收口）

> 本节是五期能力的实现落点与可复验证据，供 ticket 18 浏览器验收与后续回归对照；历史巡检结论（§1 至 §17）继续有效，冲突处已就地修正。

| 工单 | 能力 | 实现落点 | 门禁/验收证据 |
| --- | --- | --- | --- |
| 01 | 分流图隐藏阶段（后端路径投影，非前端 splice） | 后端 `api/src/l05_service/aggregates.py:build_flow(collapse=)`：按完整五元组路径投影，隐藏段从路径删除、其余可见段按序连边，requests/tokens 每边守恒、charge 只记首条可见边、cost 只记末条可见边、totals 按完整路径累计一次，`stages` 只返回可见段；`api/src/l06_api/routers_reports.py:flow` 校验未知阶段与「至少保留 2 段」。前端 `components/dashboard/flow-chart.tsx`（图例隐藏/恢复、`canHideMore = visibleStages.length > 2` 守卫、不足两段时提示「至少保留两个可见阶段」）、`trend-panel.tsx`（hiddenStages state → collapse 查询参数）、`use-reports.ts`（仅把 hidden 排序拼成逗号串传后端）、`report-mocks.ts`（mock 明确不重算投影）。默认空 collapse 输出与旧五段实现逐字节一致 | `check-ui-foundation.mjs`「分流图隐藏阶段」断言组（无前端 splice、hiddenStages 作为 collapse 请求参数、至少 2 段守卫、mock 不重算）；浏览器：图例点击 → network 带 collapse → 单图连通且 totals 不变、最少 2 段不可再隐藏、恢复 |
| 03/04 | 日志模型列两行 +「N 次尝试」popover + 费用两行 | `pages/logs.tsx`：模型列两行（公开模型 / 请求模型 → 上游模型）、费用列两行（计费/成本）；`components/logs/request-attempt-chain.tsx`（`RequestAttemptChain`、`RequestAttemptChainPopover`、「无链路记录」空态）、`use-log-attempts.ts`（读 `GET /admin/logs/{event_id}/attempts`）、`log-detail-drawer.tsx` 复用同一链组件（不维护第二套尝试行渲染）。后端行字段 `requested_model / attempts_count / has_attempts / last_failure_status / last_failure_error_type / last_failure_error_message`（事实字段；错误摘要由 `components/logs/error-summary.ts` 唯一拼装） | `check-ui-foundation.mjs`：路由链 2 次尝试/展开详情/无 attempts 显示「无链路记录」不伪造、「N 次尝试」按钮与日志页接线、mock 多尝试失败行；api-contract §4.4 字段表 + `api/tests/integration/test_logs_requested_model.py` |
| 05/07 | 模型探测 vs 模型拉取（术语分工） | 模型探测：`components/upstreams/model-probe-view.tsx`（逐模型徽章「连通/失败/超时/连接失败」、全部探测 + 取消、清空结果；仅本上游已存模型），后端 `POST /admin/upstreams/{id}/models/probe`（权限 `upstream_models:write`、串行、单模型 20s、不落库/不写 probes）。模型拉取：`components/upstreams/discover-dialog.tsx` + `discover-models`（拉候选清单、不自动建记录；旧名「发现模型」废弃） | `check-ui-foundation.mjs` 探测组件断言；api-contract §3.2 权限对照；术语表「模型探测/模型拉取」词条；浏览器：api_style=auto 时 422 提示、探测不落库 |
| 06 | 表格操作列 sticky / 头身对齐 / 行节奏 | `lib/table-columns.ts`（align/sticky 单一来源）+ `components/ui/table.tsx`（th/td 同用、冻结列不透明行底色、`--z-sticky`）+ `components/models/table.tsx`（sticky 表头、筛选行、行尾批量）；页面表全部走 DataTable/ModelsTable/PriceTable | `check-ui-foundation.mjs`：列元数据 align/sticky 头身同用、冻结列在最后一列、垂直居中、行操作文件必须声明 `sticky:"right"` |
| 08 | 数字口径 | `lib/format.ts` 单一来源：`fmtInt` 千分位整数（计数/词元/TPM/尝试次数）、`fmtRpm` 两位小数、`fmtPct` 一位、`fmtMoney` 两位、`fmtMoneyAvg` 四位、单价 <0.01 升四位；图表轴才允许 `fmtCount` K/M/B | `check-ui-foundation.mjs`「数字格式」断言；本文件 §5 表 |
| 09 | 语义色五档 / 脏标记 / toast | `lib/semantic-tone.ts`（五档 tone → 文字/浅底/描边）、`lib/icons.ts:ACTION_TONES`、`lib/dirty-fields.ts` + `lib/use-dirty-fields.ts` + `ui/dirty-field.tsx`、`lib/toast-policy.ts` + `lib/notification-store`；token 在 `index.css`（§17） | `web/scripts/check-semantic-dirty.mjs` 40 条（tone 五档/ACTION_TONES/脏标记原语/toast 3s 右上 80px/抽屉与设置页接线/冷却互斥） |
| 10 | KPI 八卡八形 + 图标映射 | `components/dashboard/metric-cards.tsx`（8 卡：请求量/词元/缓存/费用/成本·毛利率/P50 延迟/RPM/TPM；每卡一个分类 tint 图形）、`lib/metric-icons.ts`（图标单一来源） | `check-ui-foundation.mjs`：八卡图标语义与分类色、不得再用 info 灰；本文件 §12/§14 |
| 11 | 上游模型抽屉 100vh | `components/models/upstream-model-drawer.tsx`：右侧 100vh、四组内容（连接与模型/路由与模型/请求与响应/其他设置）、内部滚动、固定底栏、字段级脏标记；760 至 860px 视口自适应 | `check-semantic-dirty.mjs`「上游模型满高抽屉」；浏览器 760/860 两档 + 内部滚动/保存后关闭 |
| 13 | 公开模型单页编辑器 | 路由 `/models/public/:id`（`web/src/routes.ts`）→ `components/models/public-model-page.tsx` + `public-model-editor.tsx` + `public-model-form.ts`：页头 + 基本信息 + 成员编排三段、底部唯一保存；单 `PATCH /admin/public-models/{id}` 一次提交整页（name/routing_mode/note/enabled/targets），双权限（`public_models:write` + 含 targets 时 `model_targets:write`）、脏标记、失败保留输入并回滚；列表「编辑」进单页，不再回列表弹窗 | `check-semantic-dirty.mjs`：单 PATCH 载荷/双权限/三段/唯一「保存」/失败保留/成员校验/接线（零 PUT targets）；浏览器 network 断言同 |
| 14 | 成员 chip 编排 | `components/models/member-chip.ts`（成员名「上游渠道/模型」、按 priority 分层、同层保序、conditional 末位兜底）、`member-chip-flow.tsx`（分层 chip 流、候选按上游分组搜索）、`member-drafts.ts`、`member-editor.tsx` | `check-semantic-dirty.mjs`：member-chip / MemberChipFlow / MemberChipEditor / 成员脏标记与「成员 chip 流替换 MemberBoard」共 5 条；浏览器：分组搜索、conditional 末位、增删成员、脏标记 |

复验命令（与 §「复跑方式」并用）：

```bash
cd web && node scripts/check-ui-foundation.mjs && node scripts/check-semantic-dirty.mjs
node ops/checks/acceptance_browser.mjs --channel msedge --strict   # 单端口 3700，含 §18 新交互
```

## 19. W6 实现落点（2026-11-21 收口，票 22 核对）

> 与 §18 同口径的六期实现地图；冲突处已按 W6 现状修正（登录页配色、animate-pulse 计数、渐变计数、成员编排形态，见 §逐项核对）。

| W6 工单 | 能力 | 实现落点 | 门禁/验收证据 |
| --- | --- | --- | --- |
| 01/06 | 边界契约 + import/词表门禁收口 | `docs/SYSTEM-BOUNDARY.md`（ADR-029 细则）、`ops/checks/import_lint.py`（默认即 strict）、词表门禁扩 `--boundary-only` 与现行 docs 扫描（ticket 20） | `import_lint` findings 0（default=strict） |
| 02 至 05 | 端口迁移（payload/清理/transform/凭据/端点/用量事实） | SPI 六端口 + 注册表；connection/health/playground 走 `client_contract()`；数据面配置迁适配器命名空间 | pytest contract/integration 套件 |
| 07 | 错误治理 | `l06_api/app.py` 未捕获异常 JSON 信封（`INTERNAL_ERROR` + `request_id`）；503 `DATA_PLANE_UNAVAILABLE`；前端 4xx 不重试、不逐查询 toast | `check-ui-foundation` 错误形状断言；pytest `test_errors_shape.py` |
| 08 | 每日状态通知 | `l07_jobs.status_notice` + `GET /admin/system-status`（§api-contract 2.8）；通知中心去重 24h | pytest `test_status_notice.py` |
| 09 至 11 | 自适应 + 表格收口 | Tailwind 默认断点；侧栏 off-canvas、表格冻结操作列、关闭行置尾、冷却行底色、四态排序图标 | `responsive_matrix.mjs` 五档矩阵 |
| 12/13 | 登录重设计 + 通知/密钥弹窗 | `pages/login.tsx`（渐变、三态主题、密码显隐、错误区固定）；通知时间/正文单行省略；密钥弹窗复制/关闭同尺寸 | `check-ui-foundation` 登录断言 |
| 14/15 | 公开模型紧凑两栏 + 成员行内编辑 | `components/models/public-model-page.tsx` + `member-chip-flow.tsx`（左 6 右 6、行内编辑随策略收敛、候选分组 chip 搜索、页头脏计数） | `check-semantic-dirty` 40/40 |
| 16 | 看板日期守卫 | 366 天上限单一来源 + 提交前校验，overview/margin 同窗保护 | `check-dashboard-date-guard.mjs` 8/8 |
| 17 | 分流图重设计 | 阶段轴右侧、搜索左侧、隐藏块删除、后端 `focus`/`q`/`top_n` | `check-flow-mock.mjs` 8 PASS |
| 18/19 | 模型试验参数 | `reasoning_effort` 七档（default 不传）、`stop`（至多 4 条）/`top_k` 转发、max_output_tokens 后端兜底 | pytest `test_dataplane_contract.py` |
| 20 | 术语/破折号 | 产品名统一、em/en dash 棘轮（`terminology_baseline.json`） | `terminology_audit.mjs` PASS |
| 21 | 角色迁移 | key `admin`/`customer`/`reseller`，无 alias；`api/scripts/migrate_roles_w6.py` | pytest `test_role_migration.py` + `test_role_key_audit.py` |

## 20. W7 登录渐变视觉门禁（2026-11-22，票 13）

登录渐变从「低对比 / 有意设计」改为「可见但克制」（W7 spec User Stories 1 至 3、
Conflict Review C8）。白底、左右布局、三态主题、密码显隐、错误预留位置一律不变，
只增强背景渐变层：静态、低饱和、多层柔光。

### 口径（验收以截图 + 计算样式为准，不以「类名存在」为准）

| 维度 | 门禁 | 判定方式 |
| --- | --- | --- |
| 存在 | 计算样式 ≥3 层 `radial-gradient` 色场 + 底层承托（共 ≥4 层）；`animation-name: none` | 浏览器读根容器 `getComputedStyle(...).backgroundImage` |
| 可见 | 背景实际像素各采样点最大 RGB 差 ≥14（0 至 255 标度）；浅色底强度不得只剩深色底的一半（≥50%） | 视口截图解码后按区域取平均 RGB |
| 克制 | 最大 RGB 差 ≤48、单点色度 ≤70（低饱和、无突兀色块） | 同上 |
| 层次 | 采样色至少 3 簇可分辨（两两差 ≥4）；三态下渐变层数与每层几何一致 | 同上 + 计算样式逐层比对 |
| 静态 | 间隔 600ms 两次取样像素完全一致 | 同一页面重复取样 |
| 可读 | 正文压在渐变上 ≥4.5:1、次级文字 ≥3:1、提交按钮文字 vs 按钮底色 ≥4.5:1（WCAG AA） | 隐藏文字后量测该处渐变实际底色再算对比度 |
| 零位移 | 开/关渐变时登录框、输入、按钮、主题切换、错误槽、提示槽逐像素一致；375/768/1440 三档无横向溢出 | 元素矩形前后比对 |

### 门禁落点

- 浏览器验收：`ops/checks/acceptance/w7_login_gradient.mjs`（自起隔离站点 API 3902 + web 3903，12 条用例）
- 静态门禁：`web/scripts/check-ui-foundation.mjs`「登录页：可见但克制的多层柔光渐变」（≥3 层 radial、单层强度 ≤22%、根容器带 `data-slot="login-root"`）
- 响应式：`ops/checks/responsive_matrix.mjs`（375/768/1440 三档无横向溢出）

### 本轮实测（票 13，1440×900）

- 浅色主题：最大 RGB 差 28、可分辨色簇 4；深色主题：38、5 簇；跟随系统（系统深色）：38，都在「可见且克制」区间内。
- 可读性：正文 浅 16.55:1 / 深 17.94:1；次级文字 3.52:1 / 5.41:1；提交按钮 6.29:1 / 6.43:1。
- 对照：改动前浅色主题最大 RGB 差仅 11（用户所指的「几乎不可见」），低于 14 的可见下限；深色主题 28。

## 21. W7 UI 与领域收口（2026-11-22，票 14 核对）

> W7 十三张实现票的交互/原语落点与本文件既有小节的衔接。§18 工单 14「成员 chip 编排」、§19 工单 14/15 的成员 chip 流描述是 W5/W6 当时的实现记录，**成员形态已被 W7 t05 表格化取代**（历史记录保留，现行口径以本节为准）。

### 21.1 原语清单（components/ui 增量）

- `ui/hover-info.tsx`（W7 t08）：统一悬浮详情原语。触发元素带 `data-hover-info="trigger"` 且 `tabindex="0"`；浮层 `data-slot="hover-info-panel"` Portal 到 body，hover 250ms / 键盘 focus / 触屏轻点三路触发，视口碰撞翻转收拢，显式 label 成为可访问名称；禁用与空内容是稳定态（不浮层、不新增焦点落点）。
- `ui/status-icon.tsx`（W7 t10）：模型名旁三态状态图标。仅 closed/cooling/unknown 渲染（`data-status-icon="<kind>"`），normal 零占位；图标自带可聚焦触发元素，悬浮详情经 HoverInfo 给出关闭/冷却原因与冷却解除时间（yyyy-mm-dd hh:mm:ss）。上游模型表与公开模型表都接线（`check-ui-foundation` SSR 断言四态）。
- `ui/dialog.tsx` / `ui/alert-dialog.tsx` / `ui/confirm-dialog.tsx`（W7 t11）：统一键盘行为。Enter 触发主操作（输入法组合中不触发；多行输入与按钮自身的 Enter 不重复触发），Escape 取消（脏内容有确认保护），Tab 焦点陷阱，危险确认默认焦点在「取消」，提交中防重复，关闭后焦点还原到触发按钮。全部创建/保存/确认/签发/重置密码弹框共用同一套原语。
- `ui/dirty-field.tsx`（W7 t12 终态）：脏字段只有浅黄背景 + 「已修改」图标/文字 + 单项恢复；**左侧 2px 深色警示线已去除**（§17 的旧描述已就地标注）；标记用绝对定位固定槽，脏/净切换不推挤、不移动原有元素（w7_dirty_field 验收含零位移对比）。
- `components/ui` 原语文件数 40 个 tsx（W7 净增 hover-info、status-icon 两件；§原语化整改记录的是 2026-11-18 当时的 42 件清单，progress/input-group/form 等零引用件后续已清理）。

### 21.2 表格与页面形态（W7 收口口径）

- 成员编排（W7 t05）：已选成员是表格（`data-slot="member-table"`，输入前置：优先级 → 权重/表达式 → 成员/上游 → 更多配置 → 移除），行内 chevron 展开更多配置；候选 chip 原位灰显 + ×，再点取消；两栏列头与候选搜索同一水平线对齐。门禁：`check-ui-foundation`「成员表格（W7 票05）」与 `check-semantic-dirty`「MemberChipFlow：已选成员表格化」（46 条内）。
- 日志页（W7 t06）：独立「尝试」列删除；`attempts_count > 0` 时模型旁分叉图标 + popover（懒加载，与详情抽屉同一份数据）；查询按钮默认白底、筛选未应用时黄边 + 按钮变 primary；「筛选已修改」提示与输入框样式的「请求模型未记录」占位删除。门禁：`w7_logs_filters_attempts`（9 用例）。
- 有操作表格去状态列（W7 t10）：用户/上游/连接密钥/模型管理的状态列删除，行底色与操作文案表达状态；模型仅非 normal 显示 StatusIcon。门禁：`w7_status_columns`（12 用例）。
- 用户管理（W7 t01）：列名「用户名称/登录帐户」，无「类型」列、无「无登录帐户」行；所有 seed 用户可登录。
- 上游渠道（W7 t04）：列改「上游标志/上游别名」，无厂商字段/筛选；详情页标志/别名、地址/协议 md+ 两两同排；测试密钥默认项去重、页签下按钮不贴边。
- 连接密钥（W7 t07）：客户新建不出现用户选择（self-only），管理员/分销商保留代签入口；复制走 Clipboard API + textarea/execCommand 回退，失败明确报错。
- 模型参数列（W7 t09）：只显示输入/输出上限；完整参数进 HoverInfo（含指标卡示范接线）。门禁：`w7_model_params`（10 用例）、`w7_hover_info`（7 用例）。
- 登录渐变（W7 t13）：见 §20。

### 21.3 W7 门禁基线（票 14 实测，2026-11-22）

- 静态：`check-ui-foundation` **139/139**、`check-semantic-dirty` **46/46**、`terminology_audit` RESULT PASS（error 0 · warn 0 · 边界 0 · baseline 残留 0 · 资产 10/10）、`tsc`/`eslint`/`vite build` 全绿、`check-bundle` PASS（首包 gzip 216.9 KB / 79 chunk / echarts 148.2 KB）；后端 `pytest` 1026 passed / 8 skipped、`ruff --no-cache` 全过、`gen_ts --check` EXIT=0。
- 浏览器（隔离端口 + fresh seed）：W7 十脚本 **90 用例全 PASS**（hover_info 7、model_params 10、member_table 8、upstream_identity 10、status_columns 12、dirty_field 9、logs_filters_attempts 9、key_copy 5、login_gradient 12、dialog_keyboard 8）；响应式矩阵五档 **70/0**；六期回归 `w6_acceptance` **36/0**（隔离 3779）。数字矩阵见 `docs/DELIVERY.md` §9.4、`docs/ACCEPTANCE.md` §0.2。

