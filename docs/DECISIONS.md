# 决策记录（现行，ADR-001…ADR-029 连续编号）

## ADR-001 数据面用 agentgateway，控制面自研

- 状态：建议 · 待评审

**背景**：Python 数据面每请求固定开销约 29ms，过载时吞吐塌陷；agentgateway 是 Rust 实现，原生带 failover、预算、限流、guarded 等 LLM 策略。

**决策**：agentgateway 以官方二进制形式作为数据面，**不 fork、不改源码、不改其内置 UI**；控制面用 Python 自研，只承担配置、账本、看板。

**理由**：

1. 热路径性能与稳定性交给原生实现，避免我们自己维护一个高并发转发器。
2. 不 fork 才能跟上游升级；fork 之后每次升级都是合并地狱。
3. 控制面是业务差异所在（定价、账本、权限、审计），自研才有价值。

**后果**：

- 放弃对热路径细节的控制；AG 的行为即契约，必须用测试钉住。
- 新增一个适配层（`l03_adapters`），它是唯一知道 AG 存在的地方。
- 升级门禁：二进制版本钉 + SQLite schema 断言 + 配置渲染回归 + 契约测试，四关全过才允许升级。

## ADR-002 三层命名，不留旧名别名

- 状态：建议 · 待评审

**决策**：`Vendor` / `Upstream` / `UpstreamModel` 三层；对外模型叫 `PublicModel`；绑定关系叫 `ModelTarget`。旧名一律作废，不保留别名与兼容层。

**理由**：

- 「渠道 Channel」在业界指传输通道，我们实际指的是上游接入点，长期与「厂商」混淆。
- 「调用模型 / 调用名 / 调用串」三个词指同一件事，且在前后端含义还不一致。
- 新仓从零建立，改名成本最低；留别名等于两套词并存，半年后要再审计一次。

**后果**：旧文档里的 Channel / CallModel / 组合 等词全部失效；代码评审时出现旧名直接打回。

## ADR-003 路由：priority 分层 + 数据面同层选路

- 状态：建议 · 待评审

**决策**：

1. `ModelTarget.priority` 为整数，**升序，越小越先**（与 AG 一致，字段名就叫 `priority`，不改叫 order）。
2. 同一 priority 的目标构成一层；**层内选路由数据面按健康分 + 延迟综合分决定**，控制面不参与。
3. 当前层全部降级，才进入下一层。
4. v1 不做：组合嵌套、轮次、同层权重。

**依据**（AG 原文，`src/schema/config.md:5933-5936`）：

> failover enables priority-based selection of the target model. Within a priority level, the best provider is selected by a composite score factoring in health and latency. If all models within a priority level are degraded, requests will move o[n]...  targets are grouped by priority. Lower priority values are tried first.

这正是「跨层顺序故障转移 + 同层负载均衡」，**不需要我们实现路由器**：

- 跨层顺序 = priority 分组
- 同层负载均衡 = AG 的健康/延迟综合分
- 层全降级才下移 = AG 原生行为

**后果**：

- 控制面没有路由热路径，也没有「策略排序」需要同步。
- 代价：同层权重无法表达（failover 不支持 weight；weighted 是单层，会丢掉分层）。v1 接受。
- 代价：成本优先（cost）策略 v1 不支持；若将来要，走 conditional + callout，属二期。

## ADR-004 可用性只有两种措施：封禁与冷却（部分被 ADR-027 修订）

- 状态：已定（2026-11-18 架构评审 #8 裁定；原「建议 · 待评审」）

**修订注记（2026-11-20/21，W5 ticket 02/17）**：

- 术语：API/DB 枚举保留 `ban`，但 UI 与文档统一称「关闭」，不再使用「封禁」（ADR-018/术语表）。
- 公开模型冷却已取消：可用性措施只属上游模型，公开模型只有启停（ADR-025）。
- 本文「同一 scope 的托管规则与管理员规则可叠加、取最晚截止时间」的口径已被 **ADR-027 取代**：单次冷却与周期冷却互斥（409），解除只删一次性规则、周期规则保留。规则表单表唯一写入权威、投影列只作兼容观测的结论不变。

**决策**：用户可见与可操作的措施只有两种：

| 措施 | 语义 | 到期 | 是否出现在 /v1/models |
|---|---|---|---|
| 封禁 Ban | 永久不可用，直到人工启用 | 无 | 否 |
| 冷却 Cooldown | 临时不可用，自动恢复 | 有 | 是 |

冷却有两种形状，**不是第三种措施**：

- 一次性冷却：`expires_at` 一个时刻。
- 周期冷却（Schedule）：按日/周/月复发的时间窗。**保留，不因 UI 不做完整排期日历而取消。**

**唯一写入权威**：单表 `availability_rules(kind, scope, recurrence, expires_at, schedule_json, note)`。`api/src/l05_service/availability.py` 是深模块：`evaluate`/状态词表、规则增删改、投影同步都在这里；router 只做薄路由，渲染只读评估结果。

`upstream_models.cooldown_until_ms` / `public_models.cooldown_until_ms` 是规则表的**投影/缓存**，不是第二事实源：

- 模型页的冷却/解除（`PATCH /admin/upstream-models/{id}`、`PATCH /admin/public-models/{id}` 及批量 PATCH 的 `cooldown_until_ms`）写入一条确定性的托管规则（`rule_row_<hash>`，kind=cooldown, recurrence=once）；写路径统一调用投影同步函数。
- API 与渲染的读取只走评估器，不各自解释 `cooldown_until_ms`。同一 scope 的托管规则与管理员规则叠加，取仍生效的最晚截止时间（**W5 起作废：单次与周期互斥，见修订注记/ADR-027**）；存在托管规则时不再把投影列当作独立冷却来源（防止过期缓存延长冷却）。解除只删托管规则，不误删周期规则。
- 旧库只有未来 deadline、没有规则：启动时 `migrate_legacy_cooldowns` 幂等把 deadline 采纳为托管规则，过期列清零；不做破坏性 schema 迁移，规则和列都不删。

**状态词表**：`normal`（无措施）、`cooling`（冷却中，带当前窗口截止时刻）、`closed`（行被关闭，或封禁生效）；`closed` 优先。API 与渲染共用这组值，避免 UI 再自行推导「关闭优先于冷却」。

**生效方式**：渲染时把当前不可用的目标排除在下发配置之外。API 读路径即时评估，不依赖调度器；数据面仍由 `l07_jobs` 在边界重渲染。job 用 `rules_changed_since` 发现状态变化，覆盖一次性冷却到期**和周期窗口开启/关闭**，同步投影后下发新版本。

**理由**：AG 没有「人工让某个目标停一段时间」的原语，只能靠配置表达；而两套写入模型（规则表 + 行内列）会让控制台、API 与渲染对同一行给出不同答案。

**后果**：

- 封禁/冷却生效有秒级延迟（重渲染 + 热加载耗时）。
- 数据面因失败自动触发的熔断/降级**不落控制面库**，只在看板只读展示；不要试图把运行时状态同步回控制面。
- 投影列可能滞后一个调度周期，仅作兼容/观测；任何判定不得直接读它。
- 同一 scope 的托管规则与管理员的周期/一次性规则可叠加（**W5 起作废：互斥，见 ADR-027**）；周期规则是一等能力，不随 UI 是否提供完整排期日历而删除。

## ADR-005 用量与账本：不做影子对账

- 状态：建议 · 待评审

**决策**：新系统独立运行，没有与旧系统并行的过渡期，因此**不做影子对账/双写**。

链路：AG 请求日志（它自己的 SQLite）→ 控制面按游标增量拉取（幂等）→ `gateway_usage_events` → 按价格快照算钱 → `ledger_entries` → `daily_aggregates`。

**为什么这样也能保证账准**：

1. 事件只追加，`event_id` 幂等，重复拉取不会重复记账。
2. 每条账带 `price_version`，价格调整不重算历史。
3. 拉取游标 + 每次拉取的条目数落 `audit_logs`，可核对。

**后果**：AG 的 SQLite 成为用量单点，必须做备份与 schema 契约测试；AG 升级前先验证表结构。

## ADR-006 分层与编码规范

- 状态：建议 · 待评审

**依赖方向**：只能指向编号更小的层（同层 import 合法）。`l03_adapters` 只允许 import `l01_core` / `l02_domain`，**禁止 import `l04_repo` / `l05_service`**；`l05_service` 只依赖 SPI 抽象，不 import 任何 driver。

**适配器由上层注入（S2 整改后）**：

- 唯一的构造点是组合层 `api/src/l06_api/adapter_factory.py` 的 `make_adapter(settings)`；`l06_api` 的 router 与 `l07_jobs` 调用它，再把实例传进 `build_render_plan(session, revision=..., adapter=...)`、`apply_configuration(session, adapter=...)`、`rollback_to_revision(session, adapter=..., revision_id=...)`。
- `l05_service` 只 import `l03_adapters.spi`（`DataPlaneAdapter` 协议与 `ValidationResult` 等数据类型），`from l03_adapters.registry import create` 只出现在 factory 里，`l05_service` 出现 `adapter_factory` 字样即视为越层。
- `ValidationResult` / `validate_gateway_ir` 从 `l03_adapters` **下沉**到 `api/src/l02_domain/validation.py`：`l02_domain` 不能反向 import `l03_adapters`，而校验结果类型必须与驱动共享，因此放在域层，`l03_adapters/spi.py` 重导出以保持同一类型身份。
- 用量拉取 `pull_once` 下沉到 `api/src/l05_service/usage_pull.py`：`l06_api` 不能 import `l07_jobs`，但运维要能手动触发拉取，所以实现放服务层、`l07_jobs` 只负责定时器接线。

**为什么**：适配层要被替换、要被测试替身替换；一旦它反向依赖业务层，就永远换不掉。

**编码**：

- 后端 Google Python Style；模块/函数/变量/数据库列全部 snake_case；公共 API 必须有类型注解；用 `X | None`。
- 前端与后端同一套依赖方向规则：页面组件不直接调适配层，只经 API。
- import-lint 已可执行，不是待办：`api/tests/test_import_layers.py` 用 AST 扫描 `src/` 全量文件，向上越层 import 即失败，并禁止 `l04_repo` / `l05_service` 的标识符出现 AG 名词（`agentgateway` / `cel` / `keyhash` / `virtualmodel`）；`api/tests/unit/test_layering_guards.py` 单独钉住 S2 的三条（`l05_service` 只能 import `l03_adapters.spi`、`l02_domain` 无适配层 import、`make_adapter` 只存在于 `l06_api`，且 `rendering.py` 不出现 `adapter_factory`）。跑 `pytest` 即执行，无需额外 CI 脚本。

## ADR-007 额度：预付余额 + 按用户令牌桶（推翻周期制）

- 状态：已定（2026-11-17 用户裁定）

**决策**：不做日/周/月/年周期。额度是**预付余额**：管理员分配或用户充值，用多少扣多少，扣到 0 拒绝。

**数据面**：`localRateLimit`，`key: apiKey.user_id`（metadata 拍平进 CEL）、`type: tokens`、`tokensPerFill: 0`、`maxTokens: 剩余余额`。多把 key 的 metadata 写同一个 user_id → 共享一个桶。

**控制面**：`ledger_entries` 记充值/扣减，用户余额为权威值；充值或对账时重渲染 `maxTokens`。

**为什么不是纯数据面**：桶是**令牌桶不是账本**，原文明确 buckets are local to one proxy instance 且按最少使用淘汰；进程重启或桶淘汰会让已用额度失效，无法单独承担钱。

**为什么不是纯控制面**：控制面不在请求热路径，做不到逐请求拦截。

**残余风险（UI 必须如实说明）**：桶淘汰/重启可能短暂恢复额度，最坏多花一个对账周期；USD 金额不做强制（`type` 只有 requests/tokens）。

## ADR-008 客户端密钥：加密存储、可反复复制、前端不可查看

- 状态：已定（2026-11-17 用户裁定）

**决策**：

1. 密钥明文**加密落库**（AES-GCM，密钥来自本机配置），可反复复制，不设「只显示一次」。
2. 列表/详情**永不返回明文**，只返回掩码（如 `sk-…7f3a`）与创建时间、最近使用时间。
3. 单独接口 `POST /admin/api-keys/{id}/reveal` 返回明文：仅 owner/admin 可调，写审计日志，前端点「复制」才触发。
4. 下发给 AG 的配置里**只放 sha256 哈希**（`keyHash`），明文不进数据面配置。

**理由**：用户可反复复制；同时避免明文出现在列表、日志、配置、备份里。

## ADR-009 改写动作词表统一为 create/update/delete

- 状态：已定（2026-11-17 用户裁定）

**决策**：请求头、请求体、响应头、响应体**共用同一套动词**：`create` / `update` / `delete` / `copy` / `prepend` / `append` / `regex_replace` / `to_upper` / `to_lower`。

- 取消 `set` / `add` / `remove` / `rename` 这套独立词汇；`rename` 由「copy + delete」两行表达，编辑器提供一键生成。
- 编译时映射到 AG 的 `add` / `set` / `remove` 与 CEL 字符串运算（见 `docs/contracts/transforms-compiler.md`）。

**理由**：用户不该为「改头」和「改体」学两套说法；`create/update` 也比 `set/add` 更直白（不存在/已存在语义不同）。

## ADR-010 P0 实验定下的硬约束（v1 不可违背）

- 状态：已定（依据 docs/experiments/P0-RESULTS.md，隔离实例实测）

| 结论 | 对 v1 的约束 |
|---|---|
| E1：默认**不做请求内跨 target 重试**，首个 500 原样回客户端；失败只改变后续请求选路 | 文案与产品承诺不得写「自动 failover 重试」；首个请求可能失败是已知行为 |
| E1b：连续失败后整层降级，后续请求才切走 | 熔断是数据面进程内行为，控制面不持久化 |
| E2：配置热加载生效，且不打断在飞 SSE | apply 用文件原子替换 + 热加载即可，无需重启 |
| E3：健康状态**仅进程内**，重启即清零 | Ban/Cooldown 必须控制面持久化，渲染时把目标剔除 |
| E4：internal 模型直连返回 404 `model_not_found`；认证失败是**纯文本 401** | 上游模型必须渲染为 internal，杜绝绕过路由；错误体解析要兼容纯文本 |
| E5：`failover.targets[].model` **不能**指向 virtualModel，否则 validate 报错 | IR 必须把 public model 打平成多个 `llm.models[]` 条目 |
| E6：AG SQLite 4 表，`request_logs` 26 列（tokens/cost/gen_ai 模型/ttft/tpot/status/error） | 增量游标用 `started_at + id`；金额需控制面自建价格表 |
| E7：同层选择**非均匀**（实测约 2:1，偏置方向还会变）；跨层严格低值优先 | UI 只能写「按健康/延迟评分选择」，**不得**写「随机/轮询/均匀」 |
| E8：`--validate-only` 能抓语法/未知字段，但 **priority=0 被接受** | apply 前必须自校验 IR 不变量（priority ≥ 1 等） |
| E8：坏配置 reload 失败时旧配置继续服务 | apply 必须「校验 → 替换 → 读回确认」，失败自动回滚上一版 |
| E9：transforms 头/体全部生效；改 body 的 `model` 会改变后续选路，响应改写也会覆盖错误体 | **不改写语义做任何限制**：模型可改、错误体可改，由管理员自行负责；平台只在 UI 给出提示 |
| E10：Tokens 额度**先计费后拦截**（最多超一个请求）；无 modelCatalog 时 USD 完全不生效；reload 保留已用额度；重启清零 | 额度以控制面账本为准，AG 预算只当单实例兜底 |
| E11：`keyHash` 可用、hex 大小写不敏感、可与明文共存 | 下发只放 sha256，控制面自校验格式 |

**默认动作（W1 整改后只剩两条 header delete）**（不依赖用户配置，由 `l03_adapters/agentgateway/render.py:with_default_actions()` 追加）：

1. 每个上游在用户规则**之后**追加两条响应头 `delete`：`server`、`x-powered-by`（避免泄露上游实现）。放在用户规则之后，是为了让管理员自己写的无条件兜底行仍然排在前面。
2. 响应改写**不再注入**任何默认条件：历史上注入过的 `response.code < 400` 守卫已删除，管理员的行原样生效，错误体是否一起改写由管理员自己决定。
3. 体改写**不禁止**任何路径（W2）：`model` / `stream` 也可以改；改 `model` 会改变后续选路、动 `stream` 可能破坏 SSE 帧，**这部分风险归管理员**，控制面只提示不拦截。`api/src/l02_domain/transforms_codec.py` 已删除这两个路径的黑名单（只保留路径形状校验）。

## ADR-011 上游成本与下游收费分账

- 状态：已定（2026-11-17 用户裁定）

**决策**：成本与收费是两个独立的金额流，各有价目表、结果表与报表，任何页面不得把两者合并成一列。

| 维度 | 成本 Cost | 收费 Charge |
|---|---|---|
| 方向 | 我们付给厂商 | 用户付给我们 |
| 价目 | `upstream_prices`（按 vendor+模型+计费项版本化） | `charge_prices`（按 public_model，markup 或 fixed） |
| 结果 | `cost_entries` → `cost_daily` | `charge_entries` → `ledger_entries` → `user_daily` |
| 用途 | 运营成本、毛利 | 扣余额、停机 |

**规则**：金额一律整数微单位；每条账带 `price_version_id`，改价不重算历史；未定价记 `unpriced` 而不是 0；跨币种折算用人工维护的 `fx_snapshots`。

**理由**：合并会让改价污染历史毛利、无法回答单用户盈亏、也无法解释「扣了用户 3 毛而我们花了 2 毛」。

详见 `docs/contracts/billing.md`。

## ADR-012 同层选路是 P2C，不是随机

- 状态：已定（2026-11-17 用户质疑后查证 AG 官方文档）

**事实**：AG 的同层负载均衡是 **Power of Two Choices（P2C）**：随机采两个目标，选当前更优的那个（结合健康与延迟）。所以实测约 2:1 是 P2C 的正常表现，不是「没做负载均衡」，也不是均匀随机。

**另外**：`llm.virtualModels[].routing.weighted.targets[].weight` 支持显式权重（默认 1），路由级 `backends[].weight` 也支持权重——如果将来要让管理员配权重，有原生原语可用。

**对 v1**：默认统一走 failover（同 priority 内 P2C），不暴露权重配置；UI 文案写「同层由 P2C 选择更优目标，不保证精确比例」。

## ADR-013 E12/E13/E9：额度充值、重试与 CEL 字符串能力的定论

- 状态：已定（隔离实例实测，证据 evidence/E12-*.md、E13）

### 额度（E12）

| 事实 | 结论 |
|---|---|
| `key: apiKey.metadata.user_id` 生效，同 user_id 的多把 key 共享同一个桶 | 按用户共享额度 **可做**（推翻我最早的说法） |
| `type: tokens` 按 prompt + completion 总量扣；响应头有 `x-ratelimit-limit/remaining/reset`，429 带 `retry-after` | 可观测，但「本次扣减量」需用相邻 remaining 差或 request_logs 推算 |
| `tokensPerFill: 0` 不补充、不报错、不退化为不限流 | 适合「一次性总量封顶」 |
| **热加载把 `maxTokens` 调大 = 桶容量重置为新 max**（已耗尽时等效满额） | **充值可行**：改 maxTokens + 热加载即可 |
| 已用额度重启清零；改无关字段不会重置桶；30k 个桶内未观察到 LRU 淘汰 | 持久性靠控制面账本 |

**决策 A（确认）**：**控制面账本为权威余额**（精确、持久、可审计），AG `localRateLimit` 只做单实例快速拦截；充值先记控制面账本，再把 `maxTokens` 同步为该用户剩余余额。只改 maxTokens、其余字段保持不变，接受「容量重置」语义。

### 重试（E13）

**AG v1.7.0 的 LLM 配置面根本不接受 `retry`**：`llm.policies.retry` 与 `llm.models[].retry` 均 validate 失败（unknown field）。`RetryPolicy` 只出现在通用 HTTP 路由/后端策略里，不在 `LocalLLMPolicy` 属性中。

**决策 B（确认）**：ADR-010 的「非请求内重试」表述成立并写死；v1 不实现、不承诺请求级重试。若将来要做，只能控制面自建（需处理幂等与流式缓冲）。

### CEL 字符串能力（E9 追加）

实测在 `transformations.request.set` 里全部可用：`regexReplace`、`regexReplaceAll`、`upperAscii`、`lowerAscii`、`replace`、`trim`，另有 `charAt/indexOf/lastIndexOf/join/split/substring/stripPrefix/stripSuffix`。

**结论**：改写规则的 `regex_replace` / `to_upper` / `to_lower` 全部可实现，**不需要置灰**。

- `regex_replace` 编译为 CEL 的 `regexReplaceAll(ref, regex, replacement)`：头规则作用在 `request.headers["K"]` / `response.headers["K"]`，体规则作用在字段引用上；`regex` 是正则表达式，替换的是**正则匹配结果**，不是固定文本。
- ADR-013 的旧结论（`regex_replace` 只有退化支持）已作废：`l03_adapters/agentgateway/transforms.py` 对头/体都生成 `regexReplaceAll(...)`，也不再附带任何「部分支持」提示；`api/tests/unit/test_transforms_compiler.py` 断言两侧都出现 `regexReplaceAll(`，并有独立用例断言旧提示文案不再产出。
- 注意 CEL 求值失败会静默跳过该字段，控制面只能做语法与变量静态校验。

## ADR-014 同层路由能力矩阵（简化 LLM 模式）

- 状态：已定（2026-11-17 用户提示后用 schema 逐条核对；依据 config.md:5929-5940、834-840）

### 五种业界常见策略在 AG 简化模式下的落位

| 策略 | AG 是否支持 | 怎么落 |
|---|---|---|
| 优先级路由（主备/分层降级） | ✅ | `routing.failover.targets[].priority`，低值先；整层不可用才下移 |
| 权重路由 / 灰度 A-B | ✅ | `routing.weighted.targets[].weight`（相对比例、正整数）；`TargetSpec.weight` 默认 0 只是非 weighted 模式的占位，weighted 模式下必须显式给正整数 |
| 延迟路由 | ✅（内置，不可单独配） | P2C 评分已包含延迟与成功率的 EWMA，不暴露开关 |
| 轮询 / 最小连接数 | ❌ | 简化模式没有 round-robin / least-connections 选项，只有 P2C |
| 复杂度 / 任务类型匹配 | ✅ | `routing.conditional.targets[].when`（CEL，按序求值，末位可省 when） |
| 外部回调决策 | ✅ | `routing.callout`（调外部 HTTP 服务），v1 不做 |

### 两条硬约束

1. **routing 四选一，互斥**：`failover` / `weighted` / `conditional` / `callout` 只能选一种（v1 IR 只保留前三，`callout` 不纳入）。因此「跨层优先级兜底」与「同层静态权重」**不能同时存在**——engine 层没有嵌套虚拟模型的能力（E5：failover target 只能指向 `llm.models[]`，指向 virtualModel 会 validate 失败）。
2. **健康驱逐参数在简化模式不可配**：`health.unhealthyExpression` / `eviction.{duration,consecutiveFailures,healthThreshold,restoreHealth}` 只出现在 `binds[].listeners[].routes[].backends[].ai.policies` 层级；简化 `llm:` 模式只能用默认行为（实测约连续 2 次失败后驱逐）。要精细控制健康策略，未来必须切到完整 binds/routes 形态。

### v1 决策

- `PublicModel.routing.mode ∈ {failover, weighted, conditional}`（`api/src/l02_domain/ir.py:ROUTING_MODES` 只有这三个，`callout` 不纳入 IR），默认 `failover`。
- 选 `weighted` 或 `conditional` 时，UI 必须提示：**该模式没有跨层兜底**，且同层只按权重/条件选，不再有 P2C 健康降级保护。
- **weighted 的目标顺序由 IR 决定，不按权重排序（W4）**：`build_render_plan` 只在 failover 模式按 `priority` 升序，weighted 保留 builder 顺序；`render_config` 按 `public.targets` 原序输出 `routing.weighted.targets[]`。改 weight 不改变目标顺序，只改变权重值。
- **weight 是整数相对比例**（如 1 与 3 表示 1:3），必须 ≥ 1，不要求总和 100，不做归一化，渲染时原样下发。`validate_gateway_ir` 对 weighted 的 `weight <= 0` 报错、对 `priority ∉ {0,1}` 给 warning；对 failover 的 `weight != 0` 给 warning（该模式忽略 weight）。
- conditional 入口 v1 只在高级模式开放（要求写 CEL），不默认暴露。
- 轮询 / 最小连接：明确不支持，不做假实现。

### v2 渲染落地（ticket 07，2026-11-17 用 1.7 二进制验证）

- `llm.providers[]` / `llm.models[]` 是**数组**；v1 的 map 形状被二进制拒绝
  （`invalid type: map, expected a sequence`）。上游模型直接渲染为
  `llm.models[]`、默认 `visibility: internal`，不再按 target 打平成
  `mt_<id>` 键。
- priority 采用官方**数值小优先**：0 合法，控制面校验 `int >= 0`；同值成组，
  failover 稳定升序。旧系统「大值优先」迁移为 `maxPriority - N`。
- ADR-010 的两条默认响应头 delete 改挂在**每个 model** 的
  `responseHeaders`：`llm.policies.transformations` 是 untagged enum，普通
  request/response 与 conditional 不能同时出现；挂 model 后全局块可只放
  conditional。
- 1.7 没有 `retry`（`unknown field`）、`modelAliases`、`displayName`、
  `maxBufferSize` 配置面，适配器显式报错/warning，不静默丢。guardrails、
  promptCaching、cors、timeout、顶层 `mcp.targets[]/policies` 已渲染并通过
  `--validate-only`；MCP 运行期未验证。逐用户预付余额不能表达成每键
  maxTokens（E12），账本仍为权威。详见 `docs/contracts/ir-and-rendering.md`。

### 流式中断（与用户认知一致，已被 E1/E13 证实）

流式一旦吐出首个 chunk，网关不会也不能切到别的模型续传：响应头已提交、tokenizer/KV 状态不可拼接。切换只可能发生在「连接建立 / 首字节之前」。429/5xx 在首字节前会把该次请求记为失败，仅影响后续请求选路（E1），且 LLM 面没有 retry 原语（E13）。

## ADR-015 二期渲染契约与 priority 语义迁移

- 状态：已定（ticket 07/08/19 落地；AG 1.7.0 `--validate-only` 实测）

- `llm.providers[]` / `llm.models[]` 为数组形状；上游模型直接渲染为 `llm.models[]`，不再按 target 打平成 `mt_<id>`。
- priority 采用官方**数值小优先**，`int >= 0`（0 合法），同值成组、failover 稳定升序；旧库「大值优先」一次性翻转为 `maxPriority - N`。
- 迁移由 `api/scripts/migrate_priority_v2.py` 执行：dry-run 默认、`--apply` 写入并在 `app_settings` 打 `priority_semantics=v2` 标记；脚本幂等（已 v2 则 no-op）。seed 直接按 v2 写入并打标记，故新库再跑迁移无变化。
- `llm.policies.transformations` 是 untagged enum，普通请求/响应规则与 conditional 不能混写；默认响应头 delete 挂到每个 model 的 `responseHeaders`。
- MCP 仅支持顶层 `mcp.targets[]`（sse/stdio）与 validate 级校验，运行期未验证；AG 1.7 无 `retry` 原语，v1 不承诺请求级重试。
- 渲染前做能力矩阵自检：目标 IR 含 adapter 不支持的能力时**拒绝下发**而不是静默丢弃（如未声明 MCP 支持却含 targets/policies）。

## ADR-016 字段级权限与金额可见性

- 状态：已定（ticket 03 落地，验收见 docs/ACCEPTANCE.md）

- 权限矩阵 41 个键，`billing:cost` 控制成本/售价可见性、`billing:spend` 控制花费账单；内置 admin/agent/user 三角色，另有角色 CRUD；`owner/operator/viewer` 仅作 admin/agent/user 的输入别名。
- **后端在序列化前删键**：无权限字段直接缺键，不回 null。这样「无权限」与「未采集」不可混淆，也避免用 null 探测字段存在性。
- 前端用 `can()` 同源判断做展示兜底，未授权入口与列不渲染；`/cost`、`/revenue`、`/unpriced` 旧入口统一重定向到 `/bills` 对应分段。
- 普通用户直连旧路由只看到自己的账单与花费，看不到成本/毛利；后端对越权字段返回缺失而非 403 整体拒绝，保证页面可用。
- 不做审计员角色（二期裁定范围外）。

## ADR-017 计费口径：成本 × 倍率 = 花费；公开模型只读加权平均价

- 状态：已定（ticket 05/06/17 落地）

- 上游模型存 `cost_input_per_1m` / `cost_output_per_1m` 与 `markup`（默认 1.2），**花费 = 成本 × markup**；两本账（成本/花费）均按请求用量结算。
- 公开模型价只读展示：成员有效单价（各自成本 × 各自 markup）按 `weight` 加权平均；weighted 用 weight，failover/conditional 等权。它仅作参考，结算始终按实际命中成员的单价，不由公开模型价反推。
- 成本+花费合并为一列上下展示（`MoneyStack`），token 一律称「词元」；无 TTFA、无单条导出（二期裁定）。
- 改上游成本不自动改下游收费：markup 独立可调，价目页与模型页同源。

## ADR-018 导航按页面类型分组、术语与可用性收口

- 状态：已定（ticket 06/10/16/17 落地）

- 导航四组（页面类型）：**常规** 全局概览/数据看板/使用日志/账单；**配置** 上游管理/模型管理/价目管理；**工具** 模型试验；**系统** 连接密钥/用户/管理员/策略/护栏/MCP/审计/配置版本/用户设置/运营设置。
- 术语：词元（token）、花费（spend）、连接密钥（原客户端密钥）、公开模型（原对外模型）、模型试验（原游乐场）；价目管理归「系统」组。
- 表格少分列：成本与花费合列、公开模型只读价合列，避免横向溢出。
- 可用性并入模型管理行内操作（关闭/启用/一次性冷却/解除）；**UI 提供紧凑的周期冷却编辑（重复方式+时间窗），不做完整排期日历；后端周期冷却（daily/weekly/monthly）完整保留**。旧 `/admin/availability-rules` 提供 POST/GET/PATCH/DELETE，周期规则由 API/规则层与模型页「周期」按钮管理，以 ADR-004 为准（2026-11-18 评审 #8 修正）。
- 登录默认 `admin / admin`（`.env` 的 `SLIPSTREAM_ADMIN_USERNAME` / `SLIPSTREAM_ADMIN_PASSWORD` 引导，ADR-019；2026-11-20 起加 `SLIPSTREAM_` 前缀）；演示数据禁用 qax/qianxin（用青岚云/nebula）。
- 看板三标签（柱形/面积/分流）+ 右侧成员详情 + 底部 7D/30D/365D 热力图。

## ADR-019 统一用户表：admin_users 并入 users

- 状态：已定（2026-11-19 用户裁定，推翻「控制台账号与 API 消费者分表」的既有实现）

**背景**：现行 `users`（API 消费者：余额/密钥/层级树）与 `admin_users`（控制台登录：username/密码/角色）两张表，靠 `users.admin_user_id` 关联。用户裁定：管理用户、代理用户、普通用户都是用户，只是赋予的权限不同才有角色之分。

**决策**：只保留一张 `users` 表——username（唯一、**不可修改**）、密码哈希、role、余额、层级、状态同在一行；角色沿用内置 admin/agent/user + 自定义角色；控制台访问 = 有角色且有密码。系统初始化只建一个全权限管理员，账号密码取 `.env` 的 `SLIPSTREAM_ADMIN_USERNAME` / `SLIPSTREAM_ADMIN_PASSWORD`，此后在界面修改即持久化，env 默认值不再生效。`admin_users` 表与 `users.admin_user_id` 关联退役。密码**必填**：本期不做注册/邀请页，用户统一在用户管理页创建，创建时生成 12 位随机默认密码（大小写+数字+符号），弹窗明文展示一次可复制；改密权限——管理员改所有人、代理用户改子树内用户、所有人可自助改自己（验旧密码），接口按 RBAC 权限键 + 用户层级双重校验。

**理由**：一个用户不该因为「权限多」就变成两种实体；分表导致登录、充值、密钥、审计处处做两表 join。

**后果**：登录/会话/审计 actor 改指 `users`；41 权限键与字段级删键（ADR-016）机制不变；迁移脚本合并两表（username 冲突以 admin_users 为准）；ADR-018 的「登录默认」改为 .env 引导（`SLIPSTREAM_ADMIN_USERNAME` / `SLIPSTREAM_ADMIN_PASSWORD`，系统环境变量优先于 `.env`）。

## ADR-020 价格单源：模型行是现行权威

- 状态：已定（2026-11-19 用户裁定「对外价不独立维护，只有比例」，重申并落地 ADR-017）

**背景**：价格数据现存三处——`upstream_models` 行内 cost/markup 列（现行计费读这里）、`upstream_prices`/`charge_prices` 版本化表（ADR-011 设计）、`charge_prices` 的 markup 行（seed 写入）。三处并存导致展示与计费口径分裂。

**决策**：进价与倍率的**现行权威 = 模型行字段**（`cost_input_per_1m` / `cost_output_per_1m` / `markup`）；花费 = 成本 × 倍率；公开模型售价 = 成员加权只读派生，**不存在独立维护的对外价**。`charge_prices` 整书退役（读写在计费链路上全部删除）；`upstream_prices` 降级为历史快照与 JSON 导入导出载体，不再被计费读取——**唯一例外是缓存价**：cache_read / cache_write 不是模型行的列，仍从 `upstream_prices` 读当前价（item=cache_read / cache_write），取不到按 unpriced-cache 处理（缓存词元不计价，入/出仍照计）。账本 `price_version` 快照在结算时从模型行取值留档，改价不重算历史。

**理由**：三处一真二假不如一处真；ADR-017 已定 成本×倍率=花费，本次把存储口径收敛到同一处。缓存价留在书上是因为它没有可收敛的落点——模型行加两列会把「价格单源」变成两处。

**后果**：价目页 = 进价 + 倍率编辑 + 只读派生售价；JSON 导入导出覆盖进价与倍率，导入即改模型行；seed 只写缓存价两行（不再写 markup 行）；缓存价仍走 `/admin/prices/upstream`，但该端点只收 cache_read / cache_write。

## ADR-021 请求/响应正文日志：全局开关、默认关

- 状态：已定（2026-11-19 用户裁定）

**决策**：渲染器新增产出 `frontendPolicies.accessLog.database.llm`（`metadata` | `full`）；运营设置提供全局开关，**默认 metadata**（不存正文）。开启后日志详情可经新 API 读 `request_log_payloads`（`request_prompt_json` / `response_completion_json`）；正文随 `log_retention_days` 一并清理；开启时 UI 提示存储与敏感信息风险。

**理由**：AG 的开关是全局粒度（无按上游开关）；正文含用户 prompt，默认关是隐私与磁盘的保守默认。

**后果**：新增 payload 查询 API 与详情抽屉正文展示；渲染器与 SQLite schema 断言扩展；磁盘占用随流量线性增长，依赖 retention 清理兜底。

## ADR-022 报表聚合在 SQL 层，派生计算归前端

- 状态：已定（2026-11-19 用户裁定：后端只做数据对接与网关控制，计算交给浏览器）

**决策**：报表接口（overview/trend/timeseries/heatmap/flow/latency 及本轮新增的错误次数与比例、活跃分钟 RPM/TPM、P75）一律 SQL GROUP BY 聚合，百分位用 ORDER BY + OFFSET 取位；**禁止把区间明细全量载入 Python 循环**（现状 `aggregates.py` 的 build_timeseries 等正是如此，为看板卡顿的服务端根因）。比值/占比/格式化/环比等派生值在前端计算。

**理由**：数据库做分组是数据对接本职；Python 全量循环是把计算丢给后端；前端算展示派生值减少往返。

**后果**：`gateway_usage_events` 需按 `started_at_ms` 建索引；分位为多次轻量取位查询；ADR-005 链路描述中的 `daily_aggregates` 系未落地名，聚合以既有 `cost_daily`/`user_daily` 与 SQL 即时聚合为准。

## ADR-023 三期信息架构重构

- 状态：已定（2026-11-19 用户裁定；相应推翻 ADR-018 导航表与 ADR-016 的 /bills 重定向条目）

**决策清单**：

1. 全局概览 → **快速上手**（三步上手 + 网关连接信息 + 系统健康带；删今日概况与独立最近变更块）。
2. **账单页移除**：花费 → 用户设置·花费；充值/余额/流水 → 用户管理；待补价 → 价目管理「未配价」筛选；`/bills` 与 `/cost` `/revenue` `/unpriced` 重定向全删。
3. 策略 + 护栏 + MCP 合并为**「网关策略」单页三 Tab**（流量策略/护栏/MCP），共用 validate→保存→apply→版本留档；审计、配置版本保持独立页套统一列表规范。
4. 管理员页 → **角色管理**（角色 + 权限矩阵；控制台账号作为用户管理的一个 Tab，见 ADR-019）。
5. 价目管理保留重做（紧凑行高、批量编辑、JSON 导入导出，见 ADR-020）。
6. 上游（渠道）编辑器整页四 Tab：连接与模型 / 路由与映射 / 请求与响应 / 其他设置；厂商可选；协议自动探测（openai_chat → openai_responses → anthropic_messages → gemini）；无 slug 概念，名称默认由连接地址生成（如 `www-abc-com-8080`）可手改；优先级在路由与映射 Tab 的成员行。
7. 术语：UI 全站「上游渠道」；「关闭/启用」替代封禁；周期冷却窗口期内启用 = 仅跳过当前窗口；密钥一用户多把（上限 50）；日志费用列三行「花费 / 本(成本) / 利(毛利率)」。
8. **每用户路由策略本期不做**（2026-11-19 用户裁定 R3-4）：AG 无 per-user 路由原语（策略挂模型/路由层，不挂用户），自建等于策略引擎，远期再议；用户设置本期只收偏好/习惯类配置。
9. 接口两维正交（R3-5）：协议风格（openai_chat / openai_responses / anthropic_messages / gemini + 自动探测依次试）× 接口类型（chat / embedding / rerank / image / video / audio / **systemone（AG 内置协议，E14b 实测）** / custom 自填路径透传）；常见接口面以 OpenRouter 为参考。

**后果**：导航收敛后的页数与路由数在 FRONTEND-PLAN 收口时更新；连接密钥表需加 name / last_used_at 列与删除端点。

## ADR-024 渲染层迁移混合形态（gateway 面 + 内部路由 retry）

- 状态：已定（2026-11-19 用户裁决；推翻 ADR-014/015 的简化 llm 模式选型；M2 落地修订为混合形态）

**背景**：简化模式无法表达请求内重试（E13：llm 面 retry 字段 validate 拒收）与 4xx 驱逐策略；用户裁定产品语义要求「主目标失败（400-599 可配置）→ 同请求内切同层 → 再切下一层 → 全败才报错」。E16 实证完整形态下 route 层 retry 真实作用于 LLM 流量（主 5xx+codes → 同请求切组，4/4 客户端 200）；E17 钉死三未测区（鉴权/流式+retry/token 列形状）。

**决策（M2 落地修订：混合形态）**：纯完整形态不可行——AG 1.7 路由仅匹配 path/method/query/header/host，读不到请求体里的 model；一个 route 只对应一个 AI 后端；AI 组无 weight。全走完整形态会让所有公开模型共用同一路径、body 不可区分，被塌缩成同一个后端（各模型的 failover 链/健康策略全部丢失）。故落地为**混合形态**：保留 `llm.models/virtualModels` 做模型路由与 failover/weighted/conditional 语义（组=同 priority 层沿用），网关面迁移 `gateways`+`llm.gateways`，请求内 retry 以顶层 `policies[]` 挂内部路由 `internal/llm:request`（E17-T3 真实上游 3/3 切备实证）。强制项（validate 拒绝违反）：每上游 key_file 必填（堵客户端 Authorization 透传上游）；baseUrl 必须绝对 http(s)；https 上游渲染 models[].tls.hostname；retry.codes 含 4xx 必须成对 health.unhealthyExpression+eviction.consecutiveFailures≥1（渲染层再兜底）。已知边界不变：首字节后不切备；request_logs 1 请求 1 行（路由链可视化不回归）；同层组内 P2C 概率性不能当保证。

**理由**：三重证据（E13 拒收 / E14 简化模式零重试 / E16 完整形态可实现）+ E17 三未测区全绿；适配层架构（ADR-001）使改动封在 l02 IR 加字段 + l03 重写，上层无感。

**后果**：M3 开放 /admin/policies 的 retry/health 配置面与 UI → M4 回归；usage.py 列映射不变（E17-T2-c 实测）；AG panic（outlierdetection SystemTime overflow，OR :free 429 触发）上报上游跟踪；ADR-014 简化模式选型相关条目由本 ADR 取代。

**后果修正（2026-11-20，E19 实测裁决）**：「路由链可视化不回归」修正为**可经 OTel Traces 实现、列为独立后续工单（M5，待立项）**：pinned 1.7.0 渲染 `frontendPolicies.tracing`（顶层 tracing 键属 xds 根、standalone 拒收）后，1 请求产生 1 server 根 span + 每次上游尝试 1 个 client span（含上游身份/逐次状态码/错误类型），根 span 带 retry.attempt，且 request_logs.trace_id/span_id 同步填充可与 span 树 join（9c5ad71）。1.7.0 的 accessLog upstreamCalls CEL 字段实测静默失效（文档宣称支持）——访问日志路线不可用；metrics 仅宏观无 endpoint 标签；agctl 不存在。M5 范围草案：AG 渲染 tracing（randomSampling 策略）→ 控制面常驻轻量 OTLP/HTTP 接收器 → 按 trace_id join 复原 attempts[] → 日志详情路由链展示；量产需采样/过滤。本批四期不含 M5。

**注记（2026-11-21，W5 ticket 17）**：上条修正已由 ADR-028 落地——路由链改由适配器 loopback OTLP 归一化为 `RequestAttempt`，落 `request_attempts`，经 `GET /admin/logs/{event_id}/attempts` 暴露；系统级 OTLP 接收器、`trace_spans` 表与 `GET /admin/traces/{trace_id}` 均已删除。`request_logs` 1 请求 1 行不变，路由链可视化不再依赖 trace/span 存储（ADR-028）。

## ADR-025 可用性措施归属上游模型，公开模型只有启停

- 状态：已定（2026-11-19 用户裁决；收窄 ADR-004「可用性并入模型管理」的适用面）

**背景**：模型管理页上游模型与公开模型两张表都放了 冷却/周期 按钮。用户指出业务动机只存在于上游模型：上游模型存在时段性贵价（有意避开某些时段）、临时屏蔽某个上游模型不参与路由等运营动作；公开模型只是对外别名，无冷却诉求。且「一次性冷却」与「周期冷却」本质都是冷却，分列两个按钮徒增噪音。

**决策**：① 可用性措施（一次性冷却、周期冷却、解除冷却）**只出现在上游模型**；公开模型行内只有 关闭/启用（+编辑、删除），编辑器合并「编辑+成员」为一个整页入口。② 冷却入口合并为单个「冷却」按钮，弹窗内以标签页切换「单次冷却 / 周期冷却」两种模式；单次冷却给 1/3/6/12/24/72 小时预设；周期冷却沿用现有紧凑编辑（重复方式+时间窗）。③ 上游模型行内操作配图标。

**理由**：归属错位会让运营在公开模型上误设冷却（实际生效的是成员引用的上游模型），语义混乱；合并入口减少认知负担；AG 数据面健康/驱逐本来就作用在上游后端一侧，语义自洽。

**后果**：models.tsx 公开模型表移除冷却/周期按钮及其弹窗；上游模型冷却 UI 重做为双模式弹窗；后端 availability API 不变（仍按 upstream_model_id 挂规则）；GLOSSARY §3 已同步。

**注记（2026-11-21，W5 ticket 02/17）**：冷却入口进一步收敛为行内单个「冷却」按钮（弹窗内切「单次/周期」），冷却中行内显示「解除」；周期规则在抽屉内紧凑编辑。单次与周期互斥、解除只删一次性规则、409 details 三键见 ADR-027；公开模型冷却写操作返回 422「公开模型不支持冷却：冷却只属于上游模型（ADR-025）」。

## ADR-026 多密钥平权：每把上游密钥展开为一个独立 AG 上游

- 状态：已定（2026-11-19 用户裁决；废除「主密钥」概念，推翻 upstream_keys.is_primary + upstreams.api_key_enc 镜像机制）

**背景**：控制面此前把「一个上游=一把生效密钥」焊死（provider 名=upstream.id、数据面只吃镜像主密钥、备用密钥是死库存）。用户裁定：用户给一个上游添加 ABC 3 把密钥，适配层就应展开成 3 个 AG 上游（每把一个 key_file），用户视角仍是一个上游。审计确认：AG/validate/渲染层对「同 baseUrl 多 provider、各挂不同 key_file」已支持且在生产配置跑通（zai-01/02/03 同 baseUrl 3 provider）；焊死点仅在 provider 命名、llm.models 引用与镜像逻辑三处。

**决策**：⑥（2026-11-20 补）空上游非法重申——创建必须至少一把密钥（后端 UpstreamCreate.api_key min_length=1 早已强制、前端 canSave 同门），密钥组至少保留一把（删空 409）；据此「匿名尝试」探测分支为死路径，随本 ADR 一并移除。① 密钥平权——每把密钥渲染为独立 provider（名 `{upstream_id}#{key_seq}`），路由参与为**同层平权分流**（AG P2C，坏密钥由健康驱逐淘汰；Q2a）。② 删除 is_primary 与镜像：`upstreams.api_key_enc` 退役（迁移清空）、`set_primary`/`rotate` 端点与「主密钥」UI 全部移除。③ 测试连接改**逐把测**，结果落在密钥行（失效标红）；获取上游模型用任一成功密钥。④ 冷却/关闭仍挂逻辑上游整体（作用于全部密钥 provider）。⑤ 展开语义（同名模型跨 provider 的 failover/分流）以 E18 实验钉死后合入；渲染/validate/契约/golden 同步更新。

**理由**：多账号密钥的价值就是分流与互备，锁死一把让其余 19 把成为摆设；AG 原生多 provider 使改动封在适配层（ADR-001），上层无感。

**后果**：upstream_ops.py 重写密钥 CRUD（去 mirror/rotate/set_primary）；rendering/render.py 加密钥维度展开；contract.ts 重生成（UpstreamKey 形状变化）；keys-panel UI 重做（失效标红+批量删除+去主密钥标记）；迁移脚本清空 api_key_enc；E18 实验先行。

**补记（ticket 16，2026-11-20）**：① is_primary 死列收口——ORM 字段已删，init_db 对旧库执行幂等的 `ALTER TABLE upstream_keys DROP COLUMN is_primary`（列不存在则跳过），不再「保留一版」；② 每轮成功下发后按当前 key_files 白名单清理受管 keys/ 目录内陈旧密钥文件（dry-run 可审计；目录外、非 .key、子目录不碰；失败只告警不阻断应用），历史遗留文件与「主密钥时代」文件名随之收口；③ E20 裁决（P0-RESULTS §E20）：AG 对 conditional targets 按 first-match 首条独占，多密钥若展开只有第一把有流量，故 conditional 每目标只展开首把密钥并打 warning（渲染日志 + 成员编辑器提示 + DELIVERY 已注明）——这是既定裁决而非遗漏，密钥平权/容错仅在 failover/weighted 生效；④ provider/上游模型 id 进入 provider 名与 keys/{id}#{seq}.key，validate 拒绝路径分隔符、Windows 保留字符、控制字符与非密钥序号形态的 #，保证跨平台文件名安全；⑤ 按密钥归因不可得——用量归因比较前剥去 provider 名 `#序号` 后缀，系统不按单把密钥分账（E18/E20 边界，DELIVERY「已知边界」同步）。

## ADR-027 冷却互斥与解除语义（取代 ADR-004 的叠加口径）

- 状态：已定（2026-11-20 ticket 02 落地；W5 规格 §2；取代 ADR-004「同一 scope 的托管规则与管理员的周期/一次性规则可叠加，取仍生效的最晚截止时间」）

**背景**：ADR-004 允许同一 scope 的托管一次性冷却与管理员的周期/一次性规则叠加取最晚。W4 把「单次冷却 / 周期冷却」做成两个入口后，叠加语义在 UI 上无法自解释：行内一个「冷却中」状态可能同时来自两套规则，「解除」「启用」该作用于哪一条没有唯一答案。W5 规格裁定两种形状互斥，并重定义「解除」。

**决策**：

1. **互斥**：同一 scope 的冷却两种形状互斥，写路径统一走 `availability.assert_cooldown_mode_available`。
   - 单次冷却生效期间：拒绝创建/改期周期冷却 → 409 `CONFLICT`「单次冷却生效期间不能创建或改期周期冷却；请先解除单次冷却」。
   - 周期冷却窗口生效期间（窗口尚未被 skip）：拒绝创建/改期单次冷却 → 409 `CONFLICT`「周期冷却窗口生效期间不能设置单次冷却；请等窗口结束或先跳过本窗口」。
   - 窗口外、窗口已被启用/解除跳过、或没有活跃周期窗口时，单次冷却可写。
2. **409 details 固定三键、两种形状**：恒为 `{blocking_rule_ids, cooldown_until_ms, window_end_ms}`。
   - 挡周期规则时（存在生效中的单次规则）：`cooldown_until_ms > 0`（阻塞单次规则的截止），`window_end_ms = 0`。
   - 挡单次规则时（存在活跃周期窗口）：`cooldown_until_ms = 0`，`window_end_ms = max(当前窗口结束)`。
   - 批量冷却/启停不整体失败：命中互斥的行进入 `failed[]`（`{id, code, message, details}`），其余行照常提交；启用时跳过的窗口汇总在 `window_skipped[]`。
3. **note-only 放行**：可用性规则 PATCH 只有在结构字段（`kind / scope / scope_id / recurrence / expires_at_ms / schedule_json`）实际变化时才重跑互斥校验；仅改 `note`、或重发相同值不算变化，照常通过。结构变更同时清除该规则的窗口例外（`skip_until_ms = 0`）。
4. **关闭不参与互斥**：`closed`（行 `enabled=false`，或历史 `ban` 规则）是独立措施；互斥只在 cooldown 之间生效，ban 规则不影响冷却写入。
5. **公开模型无冷却**：对公开模型写冷却（行 PATCH 携带 `cooldown_until_ms`，或 availability 规则 `scope=public_model, kind=cooldown`）→ 422 `VALIDATION_ERROR`「公开模型不支持冷却：冷却只属于上游模型（ADR-025）」。
6. **解除** = 删除当前生效的单次托管规则；若命中本 scope 的周期窗口，只写一次性例外 `skip_until_ms = 窗口结束`，**不删除周期规则**，下一窗口照常冷却——单条 PATCH/POST 在行体顶层返回 `window_skip: {rule_ids, skip_until_ms, message}`（无跳过为 null），批量启用返回 `window_skipped[]`。窗口内「启用」同样只跳过当前窗口。删除周期规则仍需显式确认。
7. **投影不是判定来源**：行 `cooldown_until_ms` 仍是规则表的投影/兼容观测值；规则表是唯一写入权威与判定来源，任何读取不得直接解释投影列（ADR-004 该结论不变）。
8. **写后立即下发**：模型行冷却/解除/启停写操作提交后主动 `Rollout.apply`（reason `model-cooldown` / `model-release` / `model-enable` / `model-disable`，`on_failure=keep-booked`），不等 job/人工 apply，修复「新建/删除规则不触发 `rules_changed_since`」。

**理由**：两种形状若可叠加，同一个「冷却中」状态就有两个互相独立的到期来源，解除与启用必须同时解释两条规则，「单按钮双模式」的 UI 也无法映射到唯一写路径。互斥把状态收敛为一个活跃冷却；details 三键让前端能定位阻塞规则并给出可操作提示（列阻塞规则 id 与截止时刻），而不是只显示一句文案。

**后果**：ADR-004 的叠加口径作废（规则表唯一写入权威、投影列语义不变）；UI 行内一个「冷却」按钮双模式、冷却中显示「解除」、周期规则只在抽屉内编辑（ADR-025 注记）；一次性冷却仍以确定性托管规则（`rule_row_<hash>`）落库，不新增第二事实源；「解除」不再清除规则表中的周期规则与已锚定的窗口例外。

## ADR-028 追踪归适配层：系统只存归一化请求尝试，不定义 OTel/接收器/span 表

- 状态：已定（2026-11-20 用户裁决；取代 M5-a 的系统级 OTLP 接收器与 trace_spans 设计）

**背景**：M5-a 把 OTLP/HTTP 接收器、wire-format 解码与 trace_spans 表做在系统层（l06/l05），日志详情直接读 span 树。用户指出这是架构错位：追踪是数据面适配层的职责，系统多一个 server、多一张 OTel 形状的表，会让「换掉 agentgateway、换 LiteLLM 或自研数据面」时上层与数据库都不变这个目标落空；数据库表应按系统自身需求设计。

**决策**：① 系统只定义领域对象「请求尝试链」：一次客户端请求的逐次上游尝试（attempt_no、upstream_ref、model、status_code、error_type、error_message、started_at_ms、duration_ms、outcome），落系统自有表 request_attempts（correlation_key + attempt_no 复合主键，按 correlation_key/started_at 索引），保留期与日志一致（30 天）。② 适配器 SPI 新增能力 observe.request_attempts 与 AttemptSink 端口（适配器把归一化尝试记录交给系统，批量 upsert 幂等）。③ AG 适配器在 l03_adapters/agentgateway/telemetry.py 内私有实现 OTLP/HTTP 接收、解码与映射：loopback 绑定、8MB 上限、白名单解码、端口占用降级、生命周期跟随应用；对外只暴露 attempts。上层不出现 OTLP/trace/span/attributes 概念。④ 删除系统级 trace_receiver.py、routers_traces.py、traces.py、trace_spans 表与系统设置页/网关策略页的 tracing host/port/randomSampling 配置；frontendPolicies.tracing 由 AG 适配器在接收器可用时自行渲染（随机采样固定 "true"），不再由系统策略配置。⑤ API：删除 GET /admin/traces/{trace_id}；新增 GET /admin/logs/{event_id}/attempts（返回归一化尝试，upstream_name 由系统解析）；日志列表增 attempts_count/has_attempts。前端路由链改读该端点。

**理由**：这样系统数据库与 API 只依赖「请求尝试」这一业务事实；AG 的 OTel 采集是适配器实现细节，未来其它适配器可用 callback/事件/DB 提供同一端口。历史 span 树本就不是业务需求，UI 要的是「第几轮、打到哪个上游、什么结果」。

**后果**：request_attempts 取代 trace_spans（旧表不迁移，历史路由链丢失）；l05/l06 不再 import OTel 接收器；AG 适配器仍会监听一个 loopback 端口（AG 1.7 只支持 push OTLP，E19 已证没有其它可靠的逐次尝试上游身份来源），这是适配器边界内的代价；若要求系统绝对零新增监听端口，只能放弃逐次尝试链。AG 能力矩阵以 observe.request_attempts 暴露，其它适配器无该能力时 UI 隐藏路由链。

## ADR-029 系统与数据面边界：系统层只依赖标准接口与领域事实

- 状态：已定（2026-11-21，W6 ticket 01；把历史 PLAN 与 ADR-001/006 的口头原则升级为可执行契约）
- 关联：`docs/SYSTEM-BOUNDARY.md`（本 ADR 的可执行细则）、ADR-001（数据面用 agentgateway）、ADR-006（分层与依赖方向）、ADR-028（追踪归适配层）。

**背景**：W5 完成后，适配层是「唯一知道 agentgateway 的地方」这句话只存在于历史快照与未评审 ADR 中。系统 API 直接 import 适配器实现读取日志库、编译 transform；系统 job 直接清理数据面日志；系统服务持有并物化数据面密钥文件；核心 settings、健康与连接接口按某个网关的形状设计；系统表与对外契约出现数据面专有字段和文案。换 LiteLLM 或自研数据面时必须改系统层代码、表和契约，违背「系统独立于网关核心」的产品原则。W6 依据 `.scratch/w6/recon/architecture.md` 的 8 条红线立项，本 ADR 先把边界写成规范，再由后续票据逐条迁移实现。

**决策**：

1. **核心原则**：系统层只依赖标准接口（`l03_adapters.spi` + 注册表）与领域事实。系统层不得 import、拼写或推断具体数据面实现；具体 agentgateway 实现只出现在 `l03_adapters` 内及适配器工厂的构造点。
2. **判据**：如果某个字段、表、端口、路径、文案或磁盘格式在「换掉 agentgateway、改接 LiteLLM 或自研数据面」后必须修改，它就属于适配层；系统层只允许出现请求、模型、路由意图、金钱、权限与审计六类事实。
3. **系统事实白名单**：
   - 请求事实 `UsageEvent`：事件 id、起止/耗时、状态码、对外/上游模型、归因密钥、token 计数；
   - 尝试事实 `RequestAttempt`：correlation key、attempt_no、上游引用、模型、状态/错误、起止/耗时、outcome；
   - 路由意图：PublicModel、ModelTarget、priority/weight/when 的业务语义与可用性；
   - 金钱：cost/charge/margin、ledger、daily aggregate；
   - 权限与账号：用户、角色、会话、客户密钥元数据；
   - 审计与配置版本：revision id/operator/reason/status/hash/adapter_id/validation_note。
   系统表与对外字段使用中性词：usage event、request attempt、correlation key、availability、config revision。数据面列名、SQLite 文件名/路径、版本号、wire 属性名不得作为系统契约。
4. **适配层吸收清单**：数据面配置与命名空间、协议/端点/端口、客户端调用契约、采集与遥测生命周期、日志存储与 payload 读取、日志保留清理、transform/CEL 编译与预览、凭据物化/清理/磁盘格式、能力词表与用户文案、健康与版本语义。系统只持有凭据元数据与意图。
5. **六类标准端口**（`DataPlaneAdapter`）：`read_log_payload`、`prune_logs`、`preview_transforms`、`materialize_credentials`、`client_contract`、`capability_note`；`AttemptSink` 与 `start_telemetry`/`stop_telemetry` 生命周期同属 SPI 契约。上层只调用端口，不复制适配器知识。
6. **依赖方向与 import**：`l06_api`/`l07_jobs` 可依赖 `l05_service`、`l04_repo`、`l02_domain`、`l01_core` 与 `l03_adapters.spi`/`registry`；`l05_service` 只可 import `l03_adapters.spi`；`l02_domain` 不得 import `l03_adapters`。注册表负责适配器实例化与遥测生命周期，系统组合根不得按适配器名字分支。Web 只消费生成契约与系统字段，不得复制适配器能力矩阵。具体规则与检查清单见 `docs/SYSTEM-BOUNDARY.md`。
7. **词表规则**：系统 API/UI/生成契约只出现产品语言与领域词；适配器名只允许作为 `adapter_id` 审计元数据，不进入用户可见文案；数据面配置路径、wire 字段、`trace/span/OTLP/attributes`、`keyHash`、`agentgateway_user` 等实现词必须由适配器归一化后再进入系统。
8. **执行与基线**：新增 `ops/checks/import_lint.py`，默认只报告系统层具体数据面引用（W6 基线 8 条，EXIT=0），`--strict` 有引用即 EXIT=1；本票不把 `--strict` 接入门禁，ticket 06 在四侧迁移完成后转强制。新增 fake adapter，使系统在无真实数据面时可跑通启动、health、connection、usage、日志、渲染下发与清理主流程；真实适配器回归保持绿。
9. **迁移顺序**：本 ADR 只声明契约与基线，用户可见行为不变。日志 payload/保留（ticket 02）、transform 预览/凭据物化（ticket 03）、端点/配置命名空间/遥测（ticket 04）、用量事实（ticket 05）逐侧迁移，ticket 06 清零 import 泄漏并打开严格门禁。

**理由**：如果系统层能直接看见数据面，那么「换数据面不改系统」只能靠自觉；把端口、词表与 import 规则写进规范并配可执行基线，才能让每次局部重构不重新长回数据面形状。fake adapter 是这条原则的反证：系统若真的只依赖 SPI 与领域事实，就应当能在没有 agentgateway 的进程里跑通主流程。

**后果**：系统层短期仍保留 W6 基线的 8 条已知泄漏（由 import-lint 明确列出），不阻塞本票；后续票据必须逐条清零，最终 `--strict` 才能进门禁。适配器需要实现更多端口，但获得完整的替换能力；系统数据库与 API 不再依赖某个数据面的列名、磁盘格式或端点。ADR-001/006 的依赖原则继续有效，本 ADR 是其边界语义的正式裁定与执行化。
