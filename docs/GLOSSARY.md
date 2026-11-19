# 术语表（二期）

本表定义**词义**，不是机制说明。新仓从零，**不留旧名别名**；出现旧名即为 bug。
二期已完成（ticket 01–22 全部合入），本表覆盖最终 UI 命名：公开模型、连接密钥、模型试验、价目管理、用户设置/运营设置。

## 1. 三层寻址

| 术语 | 字段/表 | 定义 | 不要混用 |
|---|---|---|---|
| 厂商 Vendor | `vendors` | 商业实体：智谱、青岚云、OpenRouter 等 | 不是“上游”：同一厂商可以有多个上游 |
| 上游渠道 Upstream | `upstreams` | 一个可调用的接入点 = 地址 + 协议风格 + 密钥组 + 改写规则；厂商为**可选**字段，仅作展示分组，不参与路由与协议逻辑 | UI 全站写「上游渠道」，简称「上游」；单独用「渠道」仍禁（2026-11-19 用户裁定） |
| 上游密钥 UpstreamKey | `upstream_keys` | 上游的一条凭据；每上游最多 20 把，有 label、掩码；**每把密钥在适配层展开为一个独立 AG 上游**（ADR-026，平权分流），失效密钥在编辑面板标红 | 旧名“渠道密钥”已废；**“主密钥”概念已废**（2026-11-19 用户裁定）：不再有 is_primary 与镜像列，所有密钥平权 |
| 上游模型 UpstreamModel | `upstream_models` | 上游 `/models` 返回的原始名，也是真正发给上游的 `model` 字段 | 旧名“上游模型”沿用，但不再叫“渠道模型” |
| 公开模型 PublicModel | `public_models` | 客户端唯一可写的名字，对应 AG 的 virtualModel；二期 UI/文档统一写“公开模型” | 旧名“调用模型 CallModel”“调用名”“调用串”“对外模型”全部已废（后端表名仍 `public_models`） |
| 目标 ModelTarget | `model_targets` | 一条“公开模型 → 上游模型”的绑定，带 priority（weighted/conditional 另有 weight/when） | 在公开模型语境下也叫**成员**；旧名“渠道模型行”已废 |
| 连接密钥 ClientKey | `api_keys` | 控制台签发、客户端调用 `/v1` 的凭据（`sk-…`），可掩码展示与审计化 reveal | 旧 UI 名“客户端密钥”已废；后端路径仍是 `/admin/api-keys`；不要与上游密钥混用 |

## 2. 路由

| 术语 | 定义 | 易混 |
|---|---|---|
| 优先级 priority | 整数，**越小越先**，与 AG 一致。只表达“不同层之间的先后” | 不是排名、不是序号；同 priority 即为同一层 |
| 层 Layer | priority 相同的全部目标 | 层内不是“备胎”，是负载均衡 |
| 同层选路 | 由**数据面** P2C 选一个目标：随机取两个候选，按健康/延迟/负载择优；控制面不参与。E7 实测为带偏置随机，非轮询 | 不是轮询、不是控制面排序 |
| 故障转移 Failover | 当前层全部降级 → 下一层。请求内重试**默认关闭**（E1 实测 0 次：失败 5xx 直接返回客户端，故障转移只影响后续请求；E13 证 `llm.policies` 的 retry 被 AG 拒收）；**可配置重试见 ADR-024**（网关策略页开关：retry codes + 健康驱逐成对，流式首字节后不切换，request_logs 仍 1 请求 1 行） | 不是轮次；开启后也受 attempts 上限约束，不是无界重试 |
| 组合 Combo | **已删除**。用 PublicModel + ModelTarget 表达 | 不要再出现 combo、嵌套、轮次 |

## 3. 可用性（只有两种措施）

| 术语 | 定义 | 易混 |
|---|---|---|
| 关闭 Closed | **永久**不可用，直到人工「启用」。不参与路由，不出现在 `/v1/models`；动词统一「启用/关闭」 | 旧名「封禁 Ban」**已废**（2026-11-19 用户裁定）；与健康无关，是人的决定 |
| 冷却 Cooldown | **临时**不可用，到期自动恢复；入口合并为一个「冷却」，内含**一次性**与**周期**两种模式（2026-11-19 用户裁定，ADR-025）；**只作用于上游模型**——公开模型没有冷却概念，只有 启用/关闭 | 所有自动/定时的不可用都叫冷却；一次性冷却预设时长 1/3/6/12/24/72 小时 |
| 周期冷却 Schedule | 冷却的模式之二：按日/周/月复发的时间窗。当前窗口内不可用，窗口结束自动恢复。窗口期内人工「启用」= 仅跳过当前窗口，规则保留、后续窗口照常；删除规则须手动进界面。**冷却窗口按运营设置时区解释**（app_settings `timezone`，默认 Asia/Shanghai；与报表同源，2026-11-19 P1-6 落地） | 旧名“计划窗口”“定时封禁”已废；UI 提供紧凑编辑（重复方式+时间窗），不做完整排期日历 |
| 可用性状态 AvailabilityState | 统一词表：`normal`（无措施）/ `cooling`（冷却中）/ `closed`（行关闭或封禁生效）；`closed` 优先 | 不要再用 `active`/`disabled` 另造一套；API 与渲染共用 |
| 冷却投影 cooldown_until_ms | 规则表的**投影/缓存**，不是事实源；由写路径同步 | 任何判定先走 `availability.evaluate`，不得直接读列 |
| 熔断 / 故障 | 数据面因失败自动降级的表现，属于**冷却**（自动触发） | 控制面**不落库**，只在看板只读展示 |

判据：有到期时刻 = 冷却；没有 = 关闭。周期冷却的到期是当前窗口结束时刻（`rule_deadline_ms`），不是规则删除。

二期现状：**可用性并入模型管理**，没有独立“可用性”页。**可用性措施（冷却两种模式）归属上游模型**（ADR-025，2026-11-19 用户裁定：上游模型存在时段性贵价/临时屏蔽诉求）；**公开模型行内只有 关闭/启用（+编辑、删除）**，不再放冷却/周期按钮。上游模型行内：关闭（永久，直到人工「启用」）、启用（解除关闭；周期冷却窗口期内启用=仅跳过当前窗口，规则保留）、冷却（弹窗内 单次冷却/周期冷却 两模式切换）、解除冷却；批量 PATCH 支持同样动作。**周期冷却提供紧凑 UI（重复方式+时间窗），完整排期日历不做；daily/weekly/monthly 周期冷却与 `/admin/availability-rules` 的 POST/GET/PATCH/DELETE 完整保留**；seed 仍只放 2 条关闭/一次性冷却示例，不代表周期能力取消。所有读取走 `availability` 评估器，`cooldown_until_ms` 只作投影/观测。

## 4. 协议与类型

| 术语 | 定义 | 易混 |
|---|---|---|
| 接口风格 ApiStyle | `openai_chat` / `openai_responses` / `anthropic_messages` / `gemini` + `auto`（自动探测：依次试前四种；其他类型用户自行标记） | 不叫 protocol，避免与 HTTP/2、TLS 混 |
| 模型类型 ModelType | `chat` / `embedding` / `rerank` / `image` / `video` / `audio` / `systemone`（**AG 内置 SystemOne 协议**，非透传：请求缺字段会被 AG 400 `failed to parse SystemOne request`；平台内部未来也用）+ `custom`（用户自填端点路径，body 原样转发） | 与接口风格正交：风格管「怎么连上游」，类型管「是什么接口」；UI 展示 chat→「OpenAI兼容」；**AG 1.7 对 image 类调用不记词元**（E14b 实测）：该类流量无用量、账本覆盖不到，属已知盲区，模型行需提示 |

## 5. 用量、计费与金额（二期口径）

| 术语 | 字段/表 | 定义 | 易混 |
|---|---|---|---|
| 词元 Token | `input_tokens` / `output_tokens` / `total_tokens` | 模型计量的最小单位；界面统一写“词元”，不再写“Tokens” | 不是“字符”；中文/英文/代码的换算比例不同 |
| 用量事件 UsageEvent | `gateway_usage_events` | 数据面记录的一次上游调用，只追加、可重放 | 不是“日志”：进程日志另有其物 |
| 账本条目 LedgerEntry | `ledger_entries` | 用量事件按价格快照算出的金额，带 `price_version` | 与事件 1:N 或 1:1，取决于定价规则 |
| 成本 Cost | `cost_micro` | **上游进价**，运营视角；没有 `billing:cost` 时响应里不出现该键 | 不是“花费”：成本是我们付给上游的钱 |
| 花费 Charge | `charge_micro` | **向用户计费/扣费**，营收视角；没有 `billing:spend` 时响应里不出现该键 | 不是“成本”：花费是用户付给我们的钱 |
| 毛利 Margin | `margin_micro` | 花费 - 成本；同样受 `billing:cost` 控制 | 不是加价率；加价率是价格表里的 markup |
| 倍率 Markup | `upstream_models.markup` | 花费 = 成本 × 倍率（ADR-017 口径，2026-11-19 重申）；公开模型售价 = 成员加权只读派生，**对外价不独立维护**；`charge_prices` 的 markup 行冗余退役 | 不是毛利率；毛利率=(花费−成本)÷花费 |
| 价格版本 price_version | `ledger_entries.price_version` | 计价时使用的价格快照标识 | 价格调整不重算历史账 |
| 日聚合 DailyAggregate | `daily_aggregates` | 按天预聚合，看板只读它 | 不扫明细 |
| 速率 RPM / TPM | 报表 totals | RPM = 请求数 ÷ 活跃分钟；TPM = 词元总数 ÷ 活跃分钟；活跃分钟 = 有请求的独立分钟数（报表时区）。均保留 2 位小数；「最高峰」= 窗口内单分钟最大值 | 不是瞬时速率；分母是活跃分钟不是时间窗长度 |
| 缓存命中率 Cache Hit | 派生（GLOSSARY §5 词元口径） | 缓 ÷（入 + 缓），入为扣除缓存后的净输入；展示 2 位小数百分比；无缓存显示「无缓存」 | 分母不含出词元 |

金额一律整数 micro（1 CNY = 1_000_000 micro），字段后缀 `_micro`；货币 `currency` 取 CNY/USD，
v1 主币种 CNY。

## 6. 下发

| 术语 | 定义 |
|---|---|
| 中间表示 IR | 与网关无关的期望状态（`l02_domain/ir.py`），唯一跨层契约 |
| 渲染 Render | IR → 具体网关配置，纯函数 |
| 下发 Apply | 原子写 + AG 1.7 `--validate-only` + 热加载 + 确认 + 失败回滚 |
| 配置版本 ConfigRevision | 每次下发的留档：artifact、真实 sha256、操作人、状态、失败详情 |
| Dry-run | 策略/护栏/MCP 保存前的完整校验：IR → validate → render；失败 422 且不落库，保存成功也不等于已下发 |

## 7. 角色、权限与账号

| 术语 | 字段/表 | 定义 | 易混 |
|---|---|---|---|
| 角色 Role | `admin_roles` + `admin_users.role` | 权限集合的命名行；内置三角色 + 管理员自建角色 | 不是“用户类型”：角色是控制台权限，用户是 API 消费者 |
| 管理用户 Admin | 内置角色 `admin` | 拥有全部 41 个权限，可维护角色、管理员与所有配置 | 不是“管理员账号”这个具体人；具体人见 `admin_users` |
| 代理用户 Agent | 内置角色 `agent` | 普通用户权限 + `users:read/create/update` + `billing:subtree` | 不是“代理人”法律概念；是控制台角色 |
| 普通用户 User | 内置角色 `user` | 只读主数据/治理/价目/用量报表 + `billing:spend` + `playground:use` | 与 API 消费者 `users` 不是同一张表 |
| 用户 User | `users` | API 消费者，持有 `api_keys` 与额度；二期支持 `parent_id` 树与代理 | 不是管理员；不要共用一个表 |
| 权限 Permission | 代码注册表 | 资源 × 动作（如 `upstreams:write`），二期共 41 个键 | 不是角色名；后端只校验权限键 |
| 权限矩阵 PermissionMatrix | `GET /admin/permissions` | 按 7 组返回的权限键清单，前端据此渲染勾选矩阵 | 不是静态文档；注册表是唯一来源 |
| 自定义角色 CustomRole | `admin_roles`（builtin=false） | 管理员自建的角色，权限必须是已注册键；有成员时不可删 | 不是“临时授权”；它就是一等角色 |

内置角色不可改权限、不可删；旧角色名只用于迁移：owner→admin、operator→agent、viewer→user。
权限键 41 个：主数据 10 / 流量治理 4 / 治理 7 / 计费 6 / 用量 3 / 账号 10 / 模型试验 1。

## 8. 页面类型与导航分组（三期最终）

管理台 **26 条路由 = 16 个功能页 + 登录 + 404 + 8 个旧入口重定向页**（`/settings`、`/ops-settings`、`/upstream-prices`、`/downstream-prices`、`/admins`、`/policies`、`/guardrails`、`/mcp`）；侧栏 4 组（常规/配置/工具/系统）、**15 个一级入口 + 运营设置 3 个二级分区 = 18 个导航项**。唯一清单来源 `web/src/routes.ts` → `ops/checks/routes.json`（26 条）；参数化路由 `/settings/:section`（5 变体）与 `/ops-settings/:section`（3 变体）展开后浏览器验收 URL 共 32 条。

| 导航分组 | 页面 | 页面类型 |
|---|---|---|
| 常规 | 快速上手 `/`、数据看板 `/dashboard` | 上手指引 / 报表 |
| 常规 | 使用日志 `/logs` | 列表 / 明细 |
| 配置 | 上游渠道 `/upstreams`、模型管理 `/models`、价目管理 `/pricing` | 列表 + 表单/详情 |
| 工具 | 模型试验 `/playground` | 全屏交互工具（本地会话） |
| 系统 | 连接密钥、用户管理（API 用户/控制台账号两 Tab，ADR-019）、角色管理（原管理员）、网关策略（流量策略/护栏/MCP 三 Tab）、审计、配置版本、用户设置、运营设置（连接地址/系统参数+正文日志开关/运行信息） | 列表 + 编辑表单 / 权限矩阵 |

页面类型口径：
- **列表页**：DataTable + 筛选/分页，行内操作打开表单或详情；
- **详情/编辑页**：上游渠道整页编辑器（连接与模型/路由与映射/请求与响应/其他设置四 Tab，ADR-023）、模型管理（上游模型/公开模型两 Tab，可用性行内）、网关策略三 Tab、用户设置/运营设置；
- **仪表盘/报表页**：快速上手、数据看板（区间 + 趋势 + 延迟 + 热力）；账单页移除——花费 → 用户设置·花费，充值/余额/流水 → 用户管理，待补价 → 价目管理「未配价」筛选；
- **工具页**：模型试验，状态只存浏览器 localStorage；
- **认证/兜底页**：登录、404；旧入口重定向页：`/upstream-prices`、`/downstream-prices` → `/pricing`；`/cost`、`/revenue`、`/unpriced` 随账单移除一并删除。
