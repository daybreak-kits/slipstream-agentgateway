# 旧仓（llmapi）看板 / 日志 / 设置 / 角色 / 用户层级 现状调研

- 调研对象：旧控制台代码库（只读，未做任何改动）
- 对照对象：当前仓库
- 性质：读代码 + 读 ADR/SSOT/GLOSSARY 的事实记录；不含建议实现，只在与新仓对照时给差异结论
- 方法：全部结论以 `file:line` 为锚；推断一律标注「推断」，代码里没有的一律写「没有」

## 0. 结论速览

1. 旧仓四个延迟口径齐全：`ttft_ms`（首字）、`ttfa_ms`（首答）、`ttlt_ms`（尾字）、`total_ms`（总耗时）。**TTFA 确实存在**，建表列 + 迁移 + 采集 + 分位 + 前端表格 + 路由选路都在用，不是空字段（`llmapi/api/src/l04_repo/orm.py:236`）。
2. 分位算法是**最近秩（nearest-rank）**：`rank = max(1, ceil(p/100*n))`，取排序后第 rank 个；样本 < 5 一律返回 `null` 而不是 0（`llmapi/api/src/l05_service/aggregates.py:14-47`）。分位只算「成对样本」：`ttft_ms` 非空且 `total_ms > 0`（`aggregates.py:30-41`）。
3. 看板有**三种图型**：柱形（按成员堆叠）、面积（成员多曲线 + P95 线，不堆叠）、分流桑基（用户→密钥→模型→上游模型→渠道五段）。柱形只画可加性指标（请求/词元/成本），P95 只进面积图（`llmapi/web/src/components/dashboard/trend-card.tsx:41-63`）。
4. 流向图的「可读名称」来自后端：`label` 是展示名（渠道当前名 / 上游模型名 / 模型轴展示名 / 密钥 label / 用户名），`id` 才是折叠键（`fold_key` 或实体 id），前端只渲染 label、用 id 连边（`llmapi/api/src/l05_service/flows.py:56-102`）。
5. 热力图**只有一张**：星期×小时（7×24）的**请求数**，固定近 7 天窗口；没有「每日/每周/累计」三口径，也没有词元/金额/MCP 口径（`llmapi/api/src/l05_service/timeseries.py:276-299`、`llmapi/web/src/lib/dashboard.ts:1299-1329`）。
6. 成本可见性 = **单管理员能看全部**：没有角色、没有按用户过滤、没有「隐藏成本」开关。成本按「可信 prompt 行」的 cohort 求和（`aggregates.py:114-129`），单价缺失时前端显示「未配置单价」（`llmapi/web/src/lib/format.ts:43-60`）。
7. **没有用户层级、没有父子/顶级用户树、没有余额/配额/账单汇总继承**。`users` 只有 `id, username, display_name, created_at`；所有 API Key 默认挂在唯一的「默认用户」上（`llmapi/api/src/l05_service/keys.py:12-32`）。
8. 设置页是**固定 5 组卡片**：网关连接地址 / 上游超时看门狗 / 路由策略与准入 / 日志正文策略 + 安全约束 / 管理员账号 + 时间与主题；**是一行多列**（3 列 ×2 处、2 列 ×2 处）。**没有任何「用户设置」**——主题与时区只存浏览器 localStorage。
9. 连接地址是**一个可配的展示用 Base URL**（`gateway_base_url`），端口不可配（后端 3681 / 前端 3680 写死在启动命令），**没有公网映射设置**。
10. 旧仓**无 RBAC**：单管理员 JWT（7 天），全部 `/api/*` 路由挂 `get_current_admin`，公开面只有 `/v1`。新仓反过来：四角色矩阵 + `X-Admin-Role` 头（骨架期），但**没有真实认证**（`slipstream/api/src/l06_api/deps.py:18-40`）。
11. 新仓看板在指标口径上是**退化**的：只有 `duration_ms` 的 P50/P95 与 `ttft_p50`，无 TTFA/TTLT/P99、无成对样本、无样本门槛、分位算法换成 `round(f*(n-1))` 索引法、趋势只有日桶（`slipstream/api/src/l06_api/routers_reports.py:23, 44-48, 74-78, 94`）。
12. 新仓在治理面是**增强**的：角色矩阵 + 权限矩阵 UI、用户钱包/充值/账本、审计日志、配置版本、下游价目与毛利（旧仓全无）。

---

## 1. 延迟指标定义：TTFT / TTFA / TTLT / TOTAL

### 1.1 术语与计算口径

口径的权威文本在 `llmapi/docs/ssot.md:160-175`（§3.4 指标口径）与 `llmapi/docs/GLOSSARY.md:78-80`。基线统一为「网关收到请求、进入处理函数的那一刻」（`ssot.md:162`）。

| 字段 | 中文 | 定义（相对基线） | 关键易混点 | 代码位置 |
|---|---|---|---|---|
| `ttft_ms` | 首字 | 上游第一个**可识别增量**（非空 `content` / `reasoning` / `tool_calls` 任一）到达网关 | 不是 TCP 首字节；空帧、SSE 注释不算；纯推理也算首字 | `llmapi/docs/ssot.md:166`、`GLOSSARY.md:78` |
| `ttfa_ms` | 首答 | 第一段**正文或工具调用**（非空 `content`，或 `tool_calls`/legacy `function_call`）到达网关；`reasoning` 不算 | 纯工具调用流 `ttfa == ttft`；只有推理、既无正文也无工具调用的流 `ttfa` 为空 | `ssot.md:167`、`GLOSSARY.md:79` |
| `ttlt_ms` | 尾字 | 上游最后一个增量到达网关；中断流取最后到达的那个增量，`finish_reason` 不另计时 | 与 `total_ms` 不同：TTLT 不含回写 | `ssot.md:168`、`GLOSSARY.md:80` |
| `total_ms` | 总耗时（= TOTAL） | 基线到最后一帧**写给客户端之后**（含回写时间，客户端慢读会拉长）；流结束/失败/中断同口径收口 | 因此 `total` 可能被慢客户端拉长 | `ssot.md:169` |

不变量：四个流式值都存在时必须满足 `0 ≤ ttft ≤ ttfa ≤ ttlt ≤ total`；非流式三个流式字段全 `NULL`（`ssot.md:174`）。
吞吐：`completion_tokens ÷ (total_ms − ttft_ms)`，只对流式；生成窗口 < 100ms 视为无吞吐（显「—」），非流式一律空（`ssot.md:170`、`GLOSSARY.md:87`）。

### 1.2 旧系统是否有 TTFA：有，且是端到端打通的

| 环节 | 证据 |
|---|---|
| 建表列 | `llmapi/api/src/l04_repo/orm.py:236` `ttfa_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)` |
| 迁移 | `llmapi/api/src/l02_infra/db.py:232-233` 检测缺列后 `ALTER TABLE request_logs ADD COLUMN ttfa_ms INTEGER`；同文件 `:398` 在列定义表里登记 `"ttfa_ms": "INTEGER"` |
| 采集（属性） | `llmapi/api/src/l05_service/chat.py:1109`、`llmapi/api/src/l05_service/llm/gateway.py:1685` 与 `:1966` 都有 `def ttfa_ms(self)` |
| 采集（写入） | `chat.py:555`（参数）、`:601`（写字段）、`:1251`（取值）、`:1358`（传入落库） |
| 出接口 | `llmapi/api/src/l06_api/schemas.py:1119`（日志行）、`:1231`（聚合 `latency.ttfa`）、`:1314`（`p95_ttfa_ms`）；`llmapi/api/src/l06_api/routers/logs.py:132` |
| 分位 | `aggregates.py:53`（取 ttfa 列表）、`:59`（`"ttfa": _metric_percentiles(ttfas)`）；`timeseries.py:252`（按桶 `p95_ttfa_ms`） |
| 选路 | `llmapi/api/src/l05_service/route_stats.py:58, 77-78`（`p50_ttfa_ms` 中位数）、`llmapi/api/src/l05_service/routing.py:676-677`（`latency` 策略按 `p50_ttfa_ms` 排序） |
| 前端 | `llmapi/web/src/pages/dashboard.tsx:163-236` 四行（首字/首答/尾字/总耗时）× 四分位表格；`llmapi/web/src/lib/dashboard.ts` 的 `DashboardLatency` 含 `ttfa` |

注意一处**双实现**：路由选路用的是 `statistics.median`（`route_stats.py:77-78`），看板用的是 `aggregates.percentile` 最近秩（`aggregates.py:14-20`）。同名字段、两套算法，做跨页对账时会出现细微差异。

### 1.3 p50 / p95 / p99 算法

```python
# llmapi/api/src/l05_service/aggregates.py:14-20
def percentile(values: list[int], p: float) -> int:
    """Nearest-rank percentile (``ceil(p/100 * n)``); empty input returns 0."""
    if not values: return 0
    ordered = sorted(values)
    rank = max(1, math.ceil(p / 100 * len(ordered)))
    return int(ordered[min(rank, len(ordered)) - 1])
```

- 输出分位集合固定为 **p50 / p90 / p95 / p99**（`aggregates.py:23-24`），前端表格同样显示这四列（`dashboard.tsx:170`）。
- 采样门槛 `MIN_PERCENTILE_SAMPLES = 5`（`aggregates.py:27`）；不足 5 条返回 `None`，前端显示「—」并提示「样本不足（n/5）」（`dashboard.tsx:182`），**不是 0**。
- **成对样本**是硬约束：`paired_rows()` 只保留 `ttft_ms is not None and total_ms > 0` 的行（`aggregates.py:30-41`），四个口径共用这一批（`aggregates.py:50-62`）。因此非流式请求不进任何延迟分位——包括 `total` 分位。
- 同一套函数被 `compute_summary`（`aggregates.py:404`）、`refresh_daily_aggregates`（`:444`）、按桶时序（`timeseries.py:252` 一线）复用，避免「看板一个数、趋势另一个数」。
- 趋势图里的合计 P95 **按请求数加权**：`Σ(p95 × requests) ÷ Σrequests`，隐藏序列权重记 0，p95 为空或 0 的样本不参与（`llmapi/docs/ssot.md:331`；实现见 `web/src/lib/dashboard.ts` 的 `weightedAverageP95`）。
- 单桶不足 5 条时 `p95_ttft_ms / p95_total_ms / p95_ttfa_ms / p95_ttlt_ms` 均为 `null`（`web/src/lib/dashboard.ts` 的 `TimeseriesPoint` 注释；`timeseries.py:252`）。

---

## 2. 图表：柱形 / 面积 / 流向

三型同属一张卡片，用 Tabs 切换，`?tab=` 写进 URL（`llmapi/web/src/components/dashboard/trend-card.tsx:41-63, 85-89`）。默认落柱形；切到分流才挂载桑基并发请求（`ssot.md:326`；`components/dashboard/flow-card.tsx:33-37`）。

### 2.1 指标 × 图型矩阵

| 图型 | 可选指标 | 不允许的指标 | 依据 |
|---|---|---|---|
| 柱形 `bar` | 请求 `requests`、词元 `tokens`、成本 `cost` | 延迟（P95 不可叠加） | `trend-card.tsx:49-54` |
| 面积 `area` | 上面三个 + `latency`（P95 延迟） | — | `trend-card.tsx:56-57` |
| 流向 `flow` | 请求 `requests`、词元 `tokens` | 成本不可选 | `flow-card.tsx:79-90`；`api/src/l05_service/flows.py:35` `_METRICS = {"requests","tokens"}` |

### 2.2 柱形 / 面积的分组维度与画法

- 维度三种：`combo`（组合/综合模型，默认）、`upstream`（上游模型）、`channel`（渠道）（`web/src/lib/dashboard.ts:760-776`，`TREND_DEFAULT_DIMENSION = "combo"`）。切维度会重取数：前端把它塞进查询键（`dashboard.ts:169-176`），后端 `dimension=` 给定时每桶只保留选中维度的 `by_*`，其余置空但字段形状不变（`api/src/l06_api/routers/dashboard.py:70-72`）。
- 后端每桶同时返回三份 breakdown：`by_model` / `by_channel` / `by_upstream_model`（`web/src/lib/dashboard.ts` `TimeseriesPoint`；`api/src/l05_service/timeseries.py:265-299` 汇总 Top 名单）。
- 柱形按成员**堆叠**；面积**不堆叠**、每个成员一条曲线，P95 再单独画线（`trend-card.tsx:41, 56-57`）。
- 颜色：16 个图表色槽 `--chart-1..16` 按窗口内调用量降序分配，零调用不占槽；模型维度超过 16 个按 `palette[i % 16]` 循环；三视角并排时按名字全局分配、同名跨视角同色（`ssot.md:332`；`web/src/lib/dashboard.ts` 的 `assignCategoryColorsByName` 引用见 `trend-card.tsx:9`）。
- 轴与标签：每根柱子下方标时间点（小时 `HH:mm`、天 `MM-DD`），按最小间距抽稀；起止范围降级为卡片右上角小字（`ssot.md:334`）。

### 2.3 时间范围与粒度

范围六档：`today | week | 24h | 7d | 30d | custom`（`web/src/lib/time-range.ts:1-10`）；「本周」从本地周一 00:00 起算，最近 24h 是滚动区间（`ssot.md:324`）。

后端把范围键解析成 UTC 毫秒边界 + 桶粒度（`api/src/l05_service/timeseries.py:32-72`）：

| range | 起点 | 粒度 |
|---|---|---|
| `today` | 调用方时区的本地 0 点 | `hour` |
| `week` | 本地周一 00:00 | `hour` |
| `7d` | now − 7 天 | `day` |
| `30d` | now − 30 天 | `day` |
| `24h` / 其余 | now − 24 小时 | `hour` |
| `custom` | 显式 start/end 覆盖 | `end − start ≤ 2 天` 则 `hour`，否则 `day`（`timeseries.py:70-71`） |

桶边界按调用方 IANA 时区取整（`timeseries.py:75-78`）；前端把 `tz` 随请求带上，缺省 `Asia/Shanghai`（`routers/dashboard.py:29`、`ssot.md:324`）。
自动刷新：15s/30s/1min/5min/10min/30min，默认 1 分钟，只活在组件内存、不写 localStorage（`web/src/lib/dashboard.ts:1335-1344`）。

### 2.4 流向图（Sankey）

**五段固定链路**：`user → key → model → upstream → channel`（`api/src/l05_service/flows.py:29`；前端 `FLOW_STAGE_ORDER` 与中文标签「用户/密钥/模型/上游模型/渠道」，`web/src/lib/dashboard.ts` `FLOW_STAGE_LABELS`）。

**度量与守恒**：每行按所选度量在五段各记一次（requests 记 1；tokens 记 `prompt + completion`，但中断流只记已发出的 prompt，字符估算行记 0）（`flows.py:38-53`）。这保证每段「入边和 = 出边和 = 节点 value」（`flows.py:3-12` 文档串）。

**截断**：每段保留 Top 20 真实节点，其余合并成「其他（N）」，边重指后累加，合并后仍守恒（`flows.py:31-33`）。前端还有一层显示上限 10/20/50/100 与再次折叠（`web/src/lib/dashboard.ts` 的 `FLOW_DISPLAY_LIMITS`、`foldFlowNodes`），以及大小写变体兜底归并 `mergeCaseVariants`（`dashboard.ts:215-260` 一带）。

**可读名称怎么来（关键）**：

| 段 | id（连边用） | label（显示用） | 空值哨兵 | 依据 |
|---|---|---|---|---|
| user | `user:<user_id>` | 用户名（查 `users`） | 「未登录」 | `flows.py:60-64` |
| key | `key:<api_key_id>`，无 id 时 `label-<label>` | `api_key_label` | 「无密钥」 | `flows.py:67-71` |
| model | 综合模型轴 ident（combo id → 直连 channel-model id → 按名回退） | 实体当前名；无 id 用 `fold_key` 名 | 「未命名」 | `flows.py:74-82` |
| upstream | `final_channel_model_id` 派生 ident | 该 channel model 当前 `upstream_model`；退回折叠名 | 「—」 | `flows.py:85-92` |
| channel | `channel_id`（改名也合并） | 渠道当前名 | 「无渠道」 | `flows.py:95-102` |

`fold_key` 只折叠 ASCII 大小写、保留首次出现的写法（`api/src/l01_core/textfold.py:3-25`，ADR-071 决策 14），所以节点 id 与 label 可能不同大小写——这是一条有意的规则，不是 bug。

**交互**（`ssot.md:333`）：自研 SVG 桑基，五列等距 + 三轮 barycenter 减交叉；滚轮锚点缩放 0.5×–8×、拖拽平移、双击复位、点击或 Enter/Space 隐藏节点（至少保留一个）；悬停/键盘聚焦弹出详情卡（名称、数值、占比、上下游前 3）；节点最小高 8px、命中热区 ≥12px；窄屏放进 900px 宽内部滚动容器而不压扁（`FLOW_CHART_HEIGHT = 560`、`FLOW_MIN_WIDTH = 900`、`FLOW_MAX_WIDTH = 1400`，`web/src/lib/dashboard.ts`）。指标切换用 ToggleGroup，请求/词元二选一（`flow-card.tsx:79-90`）；切回趋势命中 React Query 60s 缓存不重复请求（`flow-card.tsx:46, 63`）。

---

## 3. 热力图：只有「星期 × 小时 × 请求数」一张

| 问题 | 事实 |
|---|---|
| 每日 / 每周 / 累计 三口径 | **没有**。只有一张滚动 7×24 的星期×小时图，没有日粒度、没有累计视图 |
| 词元 / 金额 / MCP 三口径 | **没有**。单元格值只有 `requests`（`api/src/l05_service/timeseries.py:276-279`；schema `api/src/l06_api/schemas.py:1337` `weekday` + `:1353` `heatmap: list[HeatmapCell]`，字段只有 `weekday/hour/requests`） |
| 数据源 | `request_logs`（`source='chat'`），在 `compute_timeseries` 里用 `Counter[(isoweekday, hour)]` 累加，时区为调用方传入的 IANA 时区（`timeseries.py:276-299`） |
| 窗口 | 固定近 7 天（页面按 7 天窗口取数，注释见 `web/src/lib/dashboard.ts:1299-1303` 与 `web/src/pages/dashboard.tsx:269-273`）。刻意不跟随筛选窗口——否则窗口外的星期整行变灰（`ssot.md:326`） |
| 前端组件 | `web/src/pages/dashboard.tsx:238-330`（`buildHeatmapCalendar` 给每行配一个日期、`Heatmap` 渲染）；视图模型 `web/src/lib/dashboard.ts:1306-1329`：`WEEKDAY_LABELS`（一…日）、`HEATMAP_HOURS = 24`、`heatmapGrid()` 摊成 7×24、`heatmapOpacity()` 0 次压到 0.04、有数据 0.15→1 线性 |
| 日聚合表 | 存在 `daily_aggregates`（`aggregates.py:420-464` 只由 `POST /api/dashboard/rebuild` 写），但**看板查询不读它**，直接扫 `request_logs`（`ssot.md:332`） |
| MCP | 旧仓**没有 MCP 概念**：全仓大小写不敏感搜 `mcp` 仅命中 3 处文档（`llmapi/docs/PERFORMANCE_REPORT.md:470`、`docs/archive/ui-options.md:90`、`docs/adr/ADR-063-ui-gaps-from-shadcn.md:36`），无表、无接口、无页面、无指标 |

---

## 4. 成本可见性：单管理员全量可见，没有按角色过滤

- **谁能看**：唯一的管理员账号（`admin_users`，`api/src/l04_repo/orm.py:46-53`）。所有 `/api/*` 路由都挂 `Depends(get_current_admin)`（`api/src/l06_api/routers/dashboard.py:14`、`logs.py:29`、`keys.py:13`…），**没有角色、没有权限位、没有「成本仅财务可见」之类的开关**。
- **后端如何过滤**：不按用户过滤，只按时间窗 + 可选 `channel/model/status` 过滤，然后**全量聚合**（`aggregates.compute_summary` → `repo.list_request_logs(...)` → Python 内求和，不是 SQL `GROUP BY`）（`api/src/l05_service/aggregates.py:381-413`）。日志页的 `user` 筛选只是查询条件（`web/src/lib/logs.ts` `LogFilters.user`），不是权限边界。
- **成本怎么算**：`usage_totals()` 在「可信 prompt 行」的 cohort 上求和——上游 usage 行 + 中断流（只计已发出的 prompt、缓存记 0）；字符 tokenizer 估算出来的行连成本一起排除（`aggregates.py:74-101, 114-129`）；单价按 `channel_models.input_price_per_1m/output_price_per_1m` 取（`load_model_prices`，同文件）；另有 `ledger_read.apply_overlay` 把账本覆盖层叠在行上（`aggregates.py:400`）。
- **账本口径**：`request_ledger` 是 append-only 账单真源（一行一请求、insert-only、按 `request_id` 幂等，修正走 `ledger_adjustments`）（`api/src/l04_repo/ledger_repo.py:1-6`；ORM 见 `orm.py:317`）。
- **未配置单价的展示**：有词元消耗但成本为 0 ⇒ 判为「单价未配置」，前端显式渲染「未配置单价」而不是 ¥0（`web/src/lib/format.ts:43-60`；`formatCostOrUnconfigured` 在看板与日志两处使用）。
- **估算行提示**：`estimated_rows` 只用于提示「N 条估算未计入」，不进 token/成本分母（`ssot.md:329`；`web/src/lib/dashboard.ts` `DashboardSummary.estimated_rows`）。

---

## 5. 用户层级与账单：没有树、没有余额、没有继承可见

逐条回答「有没有」：

| 项 | 结论 | 证据 |
|---|---|---|
| 父子 / 顶级用户树 | **没有**。`users` 表只有 `id, username, display_name, created_at`，无 `parent_id`、无 `org_id`、无 `tenant` | `api/src/l04_repo/orm.py:21-27`；全仓 grep `parent_id|tenant|org_id|hierarchy` 无 schema 命中 |
| 多用户管理 | **没有 UI、也没有用户路由**。所有密钥默认挂唯一「默认用户」`username="default"`；新建密钥接口只收 `label` | `api/src/l05_service/keys.py:12-32`（`DEFAULT_USERNAME` + `ensure_default_user`）、`web/src/lib/keys.ts:25-30` `createKey(label)` |
| 余额 / 配额 / 充值 | **没有**。无 `balance`/`quota`/`credit` 列、无充值接口、无钱包页 | 全仓 grep `balance|topup|quota` 仅命中「上游配额耗尽」类注释（如 `l05_service/routing.py:528`）与额度无关 |
| 账单汇总接口 | **只有全站汇总**：`/api/dashboard/summary`、`/api/logs/summary`（同一 cohort，`ssot.md:329`）。**没有** `/api/users/{id}/billing` 之类的按用户账单 | `routers/dashboard.py:18-34`、`routers/logs.py:299`、`ssot.md:329` |
| 按用户的 SQL 汇总 | **没有**。汇总在 Python 里做，`list_request_logs` 取回行后求和 | `aggregates.py:391-413` |
| 继承可见（下级看上级/上级看下级） | **不存在**，因为没有层级 | — |
| API Key 归属 | Key 属于用户（`api_keys.user_id` 外键，同用户下 label 唯一） | `orm.py:30-43`；`ssot.md:384` |
| 账单明细 | 有：`request_ledger`（逐请求成本）+ `ledger_adjustments`（修正追加），但**没有面向用户的账单页**，只有管理员看日志/看板 | `ledger_repo.py:1-6, 24-40` |

对照（新仓已有钱包）：`slipstream/web/src/pages/users.tsx` 会拉 `/admin/users`、`/admin/api-keys`、按用户拉账本、做充值（`:30-56`）。即**新仓补上了旧仓完全没有的「用户钱包 / 充值 / 账本」三条腿**，但用户树依旧是平的（无 parent 概念）。

---

## 6. 设置项完整清单（用户设置 vs 运营设置）

### 6.1 结论先说

- 旧仓**没有「用户设置」这个概念**。服务端设置全是系统级（管理员改、全站生效）。
- 唯一像「个人偏好」的两项是**主题（浅色/深色/跟随系统）**与**时区显示**，它们存在浏览器 localStorage，不进后端、不影响别人（`web/src/lib/storage.ts:2, 28, 39` 单一 localStorage 键；`web/src/pages/settings.tsx:857-886` 只是入口卡片）。
- 页面是**一行多列**布局：超时看门狗 `sm:grid-cols-3`、路由策略 `sm:grid-cols-3`（`settings.tsx:470, 567`）；正文策略 + 安全约束 `lg:grid-cols-[1.35fr_1fr]`、账号 + 时间主题 `lg:grid-cols-2`（`settings.tsx:656, 769`）。只有「网关连接地址」是整行单字段卡片（`settings.tsx:398-451`）。

### 6.2 运营设置（系统级，管理员）

| 组（页面顺序） | 设置项 | 字段 / 默认值 | 校验与说明 | 位置 |
|---|---|---|---|---|
| 1 网关连接地址 | 对外 Base URL | `gateway_base_url`，空 ⇒ 回退浏览器 `origin` | 必须 `http(s)://`、有主机名、不含账号密码/query/hash | `settings.tsx:398-451`；`web/src/lib/settings.ts:69-87, 117-125` |
| 2 上游超时看门狗 | 连接超时 / 首字节超时 / 读空闲超时 | `upstream_connect_timeout_s`、`upstream_first_byte_timeout_s`、`upstream_read_timeout_s`（秒，>0 且 ≤86400；支持一键恢复默认） | `parseUpstreamTimeout`；`upstream_timeouts_is_default` 标记是否默认 | `settings.tsx:453-546`；`lib/settings.ts:89-96` |
| 3 路由策略与准入 | 路由策略 | `route_strategy`，默认 `uniform`；可选 `stable` / `cost` / `latency`（中文：同层负载均衡 / 稳定优先 / 成本优先 / 延迟优先） | 只影响同层成员顺序，跨层仍由 priority 绝对控制 | `settings.tsx:548-588`；`lib/settings.ts:11-16` |
| 3 | 统计窗口（分钟） | `route_window_minutes`，默认 30，预设 15/30/60 + 自定义 | 范围 15–1440；成功样本 < 30 的成员按均等随机参与 | `settings.tsx:589-619`；`lib/settings.ts:98-106` |
| 3 | 节点在飞上限 | `gateway_inflight_cap`，默认 256 | 整数 ≥0（0=关闭），流式与非流式共享，超限 429 | `settings.tsx:620-634`；`lib/settings.ts:108-115` |
| 4 日志正文记录策略 | 正文策略三选一 | `body_policy` = `off` / `errors` / `all` | 「仅错误」覆盖 4xx/5xx、伪成功、流断、超时、连接失败 | `settings.tsx:57-77, 656-738` |
| 4 | 截断与保留（只读展示） | 正文各自 16KB；reasoning_content 单独 16KB；流式摘要 64KB；正文保留 7 天、日志保留 30 天 | 常量：`DEFAULT_BODY_RETENTION_DAYS = 7`、`LOG_METADATA_RETENTION_DAYS = 30` | `settings.tsx:85-106`；`api/src/l05_service/app_settings.py:19,21` |
| 4 右侧「不可关闭的安全约束」 | 脱敏强制 | `redaction_forced = true`（后端写死） | 界面上没有开关 | `settings.tsx:739-767`；`routers/settings.py:31` |
| 5 管理员账号 | 修改密码 | 当前密码 + 新密码 + 确认 | 新密码 ≥6 位、两次一致；6 秒后成功提示自动消失 | `settings.tsx:311-349, 770-856` |

后端返回体字段全集见 `api/src/l06_api/routers/settings.py:17-44`（`SettingsOut`）：`body_policy/body_truncate_bytes/body_retention_days/summary_max_bytes/updated_at/updated_by/log_retention_days/redaction_forced/gateway_base_url(+updated_at/by)/upstream_*(+updated/is_default)/route_strategy/route_window_minutes/gateway_inflight_cap`。写入走 `PATCH /api/settings`（`web/src/lib/settings.ts:46-67`）。

### 6.3 用户设置（客户端偏好，不入库）

| 项 | 存储 | 作用域 | 位置 |
|---|---|---|---|
| 主题 | localStorage（`readValue/writeValue`） | 单浏览器 | `web/src/lib/theme.ts:3`；`settings.tsx:857-886` |
| 时区显示模式 | 同上 | 单浏览器 | `web/src/lib/time.tsx` `useTimezone`；`settings.tsx:888+` |
| 看板自动刷新间隔 | **内存**（不写 localStorage，SSOT 明确「存储键由 Lead 统一治理」） | 当前页面 | `web/src/lib/dashboard.ts:1331-1344` |

---

## 7. 连接地址 / 端口设置

| 问题 | 事实 |
|---|---|
| 有没有地址设置 | 有，唯一一项：`gateway_base_url`，存 `app_settings`（键值表，`updated_at/updated_by` 可审计） | 
| 默认值 | **空**。空时前端回退「当前浏览器 origin」（`web/src/lib/settings.ts:117-125`：无 window 时兜底 `http://localhost:3681`），界面上显示「当前：<实际生效地址>」并标注来源 | 
| 校验 | 必须是带 scheme 的完整 URL、协议仅 http/https、必须有 hostname、禁止账号密码、禁止 query/hash（`lib/settings.ts:69-87`） | 
| 用途 | 只用于「全局概览」页展示，供客户端填 Base URL（`settings.tsx:405-413` 文案），不参与网关监听、不影响路由 | 
| 端口可配吗 | **不可配**。端口来自启动命令：后端 `uvicorn ... --port 3681`，前端 3680（`llmapi/docs/ssot.md:54, 79`）；没有 `PORT` 设置项，也没有在设置页暴露 | 
| 公网映射 / 反代 | **没有**。无域名、无反向代理、无端口映射设置项；跨域只由 `CORS_ORIGINS` 环境变量控制，默认 `http://localhost:3680,http://127.0.0.1:3680`（`api/src/l01_core/config.py:20`） | 
| 和「渠道地址」的区别 | 渠道的 `channels.connection_url` 是**上游**地址，与本节的对外 Base URL 无关（`docs/ssot.md:386`） | 

---

## 8. 角色与权限矩阵

### 8.1 旧仓：没有矩阵，只有「一个管理员」

| 维度 | 事实 | 位置 |
|---|---|---|
| 默认角色 | 不存在角色概念。登入者即管理员；`ADMIN_USERNAME` 默认 `admin` | `api/src/l01_core/config.py:17`；ADR-020（`docs/adr/ADR-020-single-admin-jwt.md`） |
| 认证方式 | 用户名 + 密码换 JWT，默认 7 天（`jwt_expire_minutes = 60*24*7`） | `config.py:16`；`api/src/l02_infra/tokens.py:22-30` |
| permission 名称 | **无**（没有 `permission`/`role` 表、没有字符串权限位；全仓 `role` 只在 `schemas.py:997` 的请求消息结构里出现） | grep `role|permission|RBAC` 结果见下 |
| 后端校验点（管理面） | `get_current_admin`：解析 Bearer → `decode_access_token` → 查 `admin_users` | `api/src/l06_api/deps.py:34-49` |
| 挂载点 | `dashboard.py:14`、`logs.py:29`、`keys.py:13`、`channels.py:44`、`channel_models.py:27`、`catalog.py:13`、`combos.py:13`、`groups.py:14`、`model_defaults.py:20`、`settings.py:49/63`、`auth.py:41/48` | 各 router 文件 |
| 后端校验点（数据面） | `get_user_key`：`Authorization: Bearer sk-...` 只认 `key_hash`；playground 复用管理员 JWT，并以 `api_key_label=playground` 记日志 | `api/src/l06_api/deps.py:52-77+` |
| 前端防护 | `ProtectedRoute`（有 token 才放行） | `web/src/components/protected-route.tsx:19+` |
| 结论 | 所有登录后的页面（看板/日志/密钥/设置/渠道/模型）**权限等价**，谁登录谁能看成本、能改设置 | — |

### 8.2 新仓：四角色 × 资源 × 动作（作为对照基线）

| 项 | 事实 | 位置 |
|---|---|---|
| 角色名 | `owner` / `admin` / `operator` / `viewer` | `slipstream/api/src/l05_service/rbac.py:13-17` |
| 默认角色 | `viewer`（未带头时） | `slipstream/api/src/l06_api/deps.py:19, 34` |
| 动作名 | `read` / `write` / `manage`（manage = 发/转密钥、用户管理） | `rbac.py:19-21` |
| 资源名（读 15 个） | vendor, upstream, upstream_model, public_model, model_target, availability_rule, usage, ledger, config_revision, transforms, api_key, user, admin_user, setting, billing | `rbac.py:23-39` |
| 资源名（写 9 个） | vendor, upstream, upstream_model, public_model, model_target, availability_rule, transforms, config_revision, setting | `rbac.py:40-50` |
| 资源名（manage 2 个） | api_key, user | `rbac.py:51` |
| 特例 | `billing:write` 只给 admin/owner（钱账敏感） | `rbac.py:53-55, 74-76` |
| 判定函数 | `can()` / `require_permission()`，失败抛 `UNAUTHORIZED` 并带 `{role, resource, action}` | `rbac.py:72-85` |
| 依赖工厂 | `require(resource, action)`，身份来自请求头 `X-Admin-Role`（骨架期，无真实认证） | `deps.py:13-40` |
| 典型挂载点 | `routers_apikeys.py:79/96/131/210/246/274/285/314/338`、`routers_models.py:67/82/104/119/153/170/181`、`routers_meta.py:121/127/162/205/219`、`routers_config.py:32/43/53` | 各自文件 |
| 权限矩阵 UI | `PermissionMatrix` + `roleSummary` + `ROLE_LABEL/ROLE_HINT/ROLE_TONE` | `slipstream/web/src/pages/admins.tsx:9-11` |

反差要点：旧仓「认证强、授权零」，新仓「授权齐、认证缺」（`deps.py` 只读 header，docstring 自己写着 *Skeleton-phase identity*）。

---

## 9. 与新仓的差距（对照 slipstream）

对照文件：`slipstream/web/src/pages/{dashboard,logs,settings,admins,users}.tsx`、`slipstream/api/src/l06_api/deps.py`、`slipstream/api/src/l06_api/routers_reports.py`、`slipstream/api/src/l05_service/rbac.py`、`slipstream/web/src/components/dashboard/*`、`slipstream/web/src/components/governance/settings-schema.ts`。

### 9.1 延迟与指标口径（新仓明显更弱）

| 能力 | 旧仓（llmapi） | 新仓（slipstream） | 差距判定 |
|---|---|---|---|
| 四段延迟 | TTFT / TTFA / TTLT / TOTAL 全有 | 只有 `duration_ms`（总）与 `time_to_first_token_ms`（首 token）；**无 TTFA、无 TTLT** | 缺两个口径 |
| 分位集合 | p50/p90/p95/p99 | `latency_p50_ms`、`latency_p95_ms`、`ttft_p50_ms`（`routers_reports.py:74-78`） | 缺 p99/p90，无按成员分位 |
| 分位算法 | 最近秩 `ceil(p/100*n)` + 样本 <5 返回 null + 成对样本 | `index = min(len-1, round(f*(len-1)))` 索引法、**无样本门槛、无成对样本**（`routers_reports.py:44-48`） | 同数据会算出不同的 P95 |
| 按桶分位 | 每桶 `p95_ttft/ttfa/ttlt/total`，不足 5 为 null | 无（趋势只出计数/金额类指标，`_METRICS = requests, input_tokens, output_tokens, cost_micro, charge_micro`，`routers_reports.py:22`） | 缺趋势延迟 |
| 聚合位置 | Python 内聚合（`aggregates.py`） | Python 内聚合，且 **`select(GatewayUsageEventORM).all()` 全表拉取再过滤**（`routers_reports.py:39-41`） | 规模上不可持续 |
| 范围/粒度 | today/week/24h/7d/30d/custom；hour 或 day | 仅 `7d/30d/90d`，仅**日桶**（`routers_reports.py:23, 94`） | 缺小时粒度与「今天/本周」 |
| 缓存口径 | 四口径 A/B/C/D + 估算行提示 | 固定文案 `token amounts fold cache into input (stage B pending)`（`routers_reports.py:24, 79`） | 未实现 |

### 9.2 图表（新仓换技术栈、少图型）

| 图 | 旧仓 | 新仓 |
|---|---|---|
| 柱形 | 有（按成员堆叠，3 指标） | **无**（无柱形趋势） |
| 面积 | 有（成员多曲线 + P95 线，不堆叠） | 有趋势面积图（recharts `AreaChart`，`components/dashboard/trend-chart.tsx:1-10`），但只有单指标序列无成员拆分 |
| 维度切换 | combo / upstream / channel 三视角 + Top N + 图例分节隐藏 | 无（没有 dimension= 参数入口） |
| 延迟图 | 4 行 × 4 分位表格 + 条形 | 3 根横向条（P50 / P95 / TTFT P50），`components/dashboard/latency-chart.tsx:26-48` |
| 桑基 | 5 段 user→key→model→upstream→channel；可读 label 来自后端；Top20 折叠；自研 SVG（缩放/平移/隐藏/详情卡） | 4 段 vendor→umodel→public→user；echarts；`displayName()` 把 hex id 截断成「上游 xxxxxx / 用户 xxxxxx」（`components/dashboard/flow-sankey.tsx:16-38`）；无线上的指标切换（取 requests，退化到 charge_micro，`:76-84`） | 
| 热力图 | 有（7×24 请求数） | **无**（全仓 `heatmap` 仅命中 `calendar.tsx`/`time-range-picker.tsx`/`availability-create-dialog.tsx`，与热力图无关） |

### 9.3 设置（新仓结构化更强，但丢了网关地址）

| 项 | 旧仓 | 新仓 |
|---|---|---|
| 组织方式 | 5 组固定表单卡片，2–3 列网格 | `SETTINGS_GROUPS` schema 驱动：**计量与货币**（`base_currency`）、**时区与时间**（`timezone`）、**日志与留存**（`log_retention_days`、`audit_retention_days`）、**默认限流参数**（`default_rate_limit_rpm`、`default_rate_limit_burst`）（`components/governance/settings-schema.ts:57-142`） |
| 只读运行信息 | 无 | `RUN_INFO_KEYS`：`gateway_artifact_path`、`usage_poll_interval_s`、`client_key_length`、`price_version`（`settings-schema.ts:145-150`） |
| 布局 | 一行多列 | **一行一项**：左标签/键名/说明、右只读值或编辑控件（`pages/settings.tsx:40-73`） |
| 未下发键的兜底 | 无（缺字段就是空） | 显示「后端未下发 · 默认值」徽标 + fallback，不悄悄写库（`settings.tsx:48`、`settings-schema.ts:29`） |
| 连接地址/Base URL | 有 `gateway_base_url` | **没有**（设置里无此键） |
| 上游超时 / 路由策略 / 在飞上限 | 有 | **没有**对应设置键 |
| 正文日志策略 | 有（off/errors/all + 16KB/64KB/7d/30d） | 只有 `log_retention_days`/`audit_retention_days`，无正文策略 |

### 9.4 角色 / 用户 / 账单（新仓补齐治理，认证仍是洞）

| 能力 | 旧仓 | 新仓 |
|---|---|---|
| RBAC | **无** | 四角色矩阵 + `require()` 依赖（`rbac.py`、`deps.py:31-40`） |
| 管理员管理页 | 无（只有一个账号，只能改密码） | 有：列表/创建/改角色改密/删除 + 权限矩阵（`pages/admins.tsx:26-60+`、`/admin/admins`） |
| 用户管理 | 无（默认用户 + 密钥） | 有：`/admin/users`、`/admin/api-keys`、按用户账本、充值（`pages/users.tsx:30-56`） |
| 用户层级树 | 没有 | 依旧没有（扁平） |
| 余额/充值 | 没有 | 有（`amount_micro`、CNY，`users.tsx:44-56`） |
| 账单 | 逐请求 ledger（append-only），无用户账单页 | 账本 + 按用户汇总 + 毛利（charge/cost/margin，`routers_reports.py:64-73`） |
| 成本可见性 | 单管理员全量 | `billing:read` 给**所有四个角色**（viewer 也在 `_READ_RESOURCES` 里，`rbac.py:38, 58`）；即成本对新仓 viewer 可见 → 比旧仓「只有管理员」的边界更宽，需要产品确认 |
| 真实认证 | 有（JWT + `admin_users` 查库，`deps.py:34-49`） | **没有**（`X-Admin-Role` 头即身份，`deps.py:18-28`） |
| 审计 / 配置版本 | 无 | 有（`/admin/audit-logs`、`/admin/config-revisions`，`routers_meta.py:162, 205`） |

### 9.5 日志页

| 项 | 旧仓 | 新仓 |
|---|---|---|
| 规模 | `web/src/pages/logs.tsx` 表 + 抽屉 + 查询语法帮助 + 三种视图（逐次请求/按组合/按状态） | `pages/logs.tsx`（527 行）表 + 抽屉 + 查询语法帮助；无聚合视图（view=combo/status 在旧仓有：`web/src/lib/logs.ts` `LOG_VIEW_OPTIONS`） |
| 延迟列 | `ttft_ms/ttfa_ms/ttlt_ms/total_ms/throughput_tps` 全在行上（`web/src/lib/logs.ts` `RequestLog`） | 有 `fmtTtft`（`components/logs/format`），无 TTFA/TTLT/吞吐 |
| 成本列 | 有，且「未配置单价」显式标注 | 有 `fmtMoney`（`components/logs/format` 引用 `pages/logs.tsx:20`） |
| 分页 | 25 起 | 25/50/100/200（`deps.py:14` 强制四档） |

---

## 10. 证据索引与未核实项

**主要读取文件（旧仓）**：`web/src/pages/{dashboard,logs,settings,keys}.tsx`；`web/src/components/dashboard/{trend-card,flow-card}.tsx`；`web/src/lib/{dashboard,logs,settings,time-range,format,keys,theme,storage,chart-colors}.ts`；`api/src/l05_service/{aggregates,timeseries,flows,chat,keys,route_stats,routing}.py`；`api/src/l04_repo/{orm,ledger_repo}.py`；`api/src/l06_api/{deps,schemas}.py` 与 `routers/{dashboard,logs,settings,groups,keys}.py`；`docs/ssot.md`（§3.4/§5.8/§5.9/§7/§9.1）、`docs/GLOSSARY.md`、`docs/adr/ADR-028`、`ADR-032`、`ADR-020`。

**边界与不确定**：
1. 热力图「固定近 7 天」依据的是前端注释与 SSOT（`lib/dashboard.ts:1299-1303`、`ssot.md:326`）；后端本身只按传入区间统计，没有硬编码 7 天——如果将来有页面传别的区间，热力图会跟着变。
2. `web/src/lib/dashboard.ts:169-176` 的注释说「后端目前忽略 dimension 参数」，与 `api/src/l06_api/routers/dashboard.py:70-72`（已按 dimension 裁剪 `by_*`）矛盾——注释是旧的，代码是新的；本文以路由实现为准。
3. `body_truncate_bytes` / `summary_max_bytes` 的默认值在 `app_settings.py` 未直接 grep 到常量，界面按 16KB / 16KB / 64KB 展示（`settings.tsx:85-106`）；如需精确默认值应读 `app_settings.py` 全文。
4. 本文对「旧仓没有用户树/余额」的结论基于全仓 grep（`parent_id|tenant|org_id|hierarchy|balance|topup|quota`）与 ORM 表清单，未逐页读前端全部组件；如果存在未入库的展示层概念，属于遗漏风险，但没有任何后端字段支撑。
