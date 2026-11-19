# 设计巡检记录（unslop 轻量轮）

- 时间：2026-11-18
- 对象：`web/src`（管理台 23 个页面组件 + 布局/外壳 + 设计 token）
- 方法：静态检索设计 tells（渐变/发光/emoji/主色/动效/阴影/字体）+ 交互审计逐页截图目视 + `web/src/index.css` token 表核对。
- 结论：**未发现典型 AI 味**（渐变文字、霓虹发光、emoji 标签、玻璃拟态、多主色混用、夸张 hover 缩放）；仅 2 处渐变属有意设计，已登记如下。

## 逐项核对

| 检查项 | 结果 | 证据 |
|---|---|---|
| 渐变文字 / 多色渐变装饰 | 无 | `web/src` 无 `bg-clip-text`、`text-gradient`；全仓仅 2 处 `linear-gradient`，都在 `web/src/index.css:414-415`，用于 1px 网格背景线（功能性背景，非装饰） |
| 发光 / 玻璃拟态 | 无 | 无 `drop-shadow`、`blur-*`、`backdrop-blur`、glow 类；阴影只有 2 个 token：`--shadow-card`、`--shadow-pop`（`web/src/index.css:34-35`） |
| 单一主色 | 是（靛蓝） | `--primary: #4f46e5`（浅色）/ `#818cf8`（深色），`--primary-soft: #eef2ff`；success/warning/danger 只作状态色；图表 16 槽独立（`web/src/index.css:141-208`） |
| emoji 标签 | 无 | `web/src` 无 emoji；图标统一 `lucide-react` |
| 夸张动效 | 无 | `animate-pulse` 仅 3 处：流式输出光标（`components/playground/message-list.tsx:318`）、指标加载态（`components/ui/metric-pills.tsx:62`）、骨架屏（`components/ui/skeleton.tsx:4`）；`animate-spin` 仅 `components/ui/spinner.tsx:7` 且带 `motion-reduce:animate-none`；无 `hover:scale`/`hover:-translate` |
| 字体与圆角 | 统一 token | `--font-sans: Inter, "Noto Sans SC", "PingFang SC", "Microsoft YaHei", sans-serif`；`--font-mono: "JetBrains Mono"`；圆角 6/8/12/16（`--radius-*`，`web/src/index.css:11-17`） |
| 图表连线渐变 | 有意设计 | `components/dashboard/flow-chart.tsx:131` `lineStyle: { color: "gradient", opacity: 0.26 }`：ECharts sankey 连线按源/目标色渐变，透明度已压低，不构成发光感 |
| toast 遮挡表单 | 已修 | `components/ui/sonner.tsx` Toaster `position="bottom-right"`（7abfb6b），不再遮右上角筛选；`web/src/main.tsx` 不再覆盖 position |
| 控件可读名称 | 已修 | `pages/settings.tsx` 显示名/邮件通知/浏览器通知/周报摘要/个人简介补 `aria-label`；三个通知开关改由 `NOTIFY_PREFS` 列表统一渲染 |
| 登录页固定配色 | 保留 | `--login-*` 是登录域专用（不随主题的深色画布），`web/src/index.css:186-194`；未改 |

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

- 全站 4px 网格；卡片 padding 20–24，页面边缘 24–32，侧栏行高 32–36、行距 2–4。
- 同层卡片**统一**一套边界 token：`--radius-12` + hairline 边框（文本色 6–10% 透明度）+ `--shadow-card`；页面不得自定边框粗细/颜色/圆角/阴影档位。
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
- toast：sonner 单一 Toaster（bottom-right）；复制成功统一「已复制」；success/info 5200ms、warning 6500ms；API 错误统一 `describeApiError` 文案。

### 5. 数字与格式化（`lib/format` 单一来源，禁止页面自写）

| 场景 | 规则 |
|---|---|
| 计数（卡片/图表 tooltip） | K/M/B 自适应，2 位小数（错误次数同） |
| 计数（表格明细） | 千分位 |
| 词元 | 入/出/缓分别格式化；无缓存显示「无缓存」 |
| 金额 | 6 位小数；未配置显示「—」，不渲染 0 |
| 比例/毛利率/错误率 | 2 位小数 |
| 延迟 | 秒（s）2 位小数 |
| 缓存比例 | 缓 ÷（入+缓），见 GLOSSARY §5 |

### 6. 动效

- 只 transition color/background/border/opacity/transform，用具名类（`transition-colors` 等），禁止 `transition-all`。
- 补装 `tailwindcss-animate`（当前缺失，所有 `animate-in/zoom-95/slide-in-from-*` 类失效）后才允许这些类；浮层动效 = fade + 上移 95ms 一档。
- 无循环动画（例外：流式光标、骨架屏、spinner 带 `motion-reduce:animate-none`）。

### 7. 术语门禁

- `ops/checks/terminology_audit.mjs` 同步三期词表：允许「上游渠道」「关闭/启用」「快速上手」「代理用户」；UI 禁裸「渠道」、禁「封禁」（文案层）；随账单移除删除旧路由文案。


## 四期·表格与分页规范（2026-11-19 用户定案）

全站一切表格页面（DataTable / ModelsTable / 密钥面板表 / 审计 / 用户 / 角色等）按本节执行。

### 1. 排序
- 表头整格可点即排序，循环 升 → 降 → 取消（取消=回默认序），箭头指示当前方向；可排序列鼠标 hover 有可点暗示，不可序列无箭头。

### 2. 对齐与冻结
- **同列的表头与表体对齐方式必须一致**：数值列右对齐（`tnum`），文本列左对齐，状态/徽章列选定一种后头身一致。列定义的对齐类必须同时作用于 `th` 与 `td`（现 `ModelColumn.className` 只上 td、列头永远左对齐，是已定案要修的缺陷）。
- **操作列 = 最后一列 + 水平冻结**（`sticky right-0` + 背景与分割阴影），小屏横向滚动时操作始终可见；所有页面操作列统一靠尾部。

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
