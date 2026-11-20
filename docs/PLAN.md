# Slipstream 方案（二期同步稿）

> **历史快照（二期，2026-11-18）**：本文件保留二期方案与当时数字（如 23 页面组件/29 路由/首包 193.8 KB/pytest 315），这些数字**已过时**；五期现行口径见 `docs/DELIVERY.md` §7、`docs/GLOSSARY.md` §8 与 `docs/api-contract.md`（27 路由/19 页面模块/15 导航/836 passed/首包 213.1 KB）。

- 状态：**二期已完成**，ticket 01–22 全部合入 `phase2/integration`（2026-11-18，本地提交未 push）。
- 范围：全新系统，与旧 3680 系统无继承关系。
- 已合并 ticket：01–22 全部；逐项记录见 `docs/CHANGELOG-phase2.md`，交付与验收见 `docs/DELIVERY.md`。

## 1. 一句话结论

控制面自研（Python + SQLite/PG + WebUI，监听 3700），数据面直接用 agentgateway 官方二进制（监听 3600，不 fork、不改其内置 UI）。请求热路径完全在数据面，控制面只做配置下发、账本与看板；控制面宕机不影响转发。

## 2. 边界

**做（当前已落地）**

- 上游 / 上游密钥（每上游最多 20 把，平权——ADR-026）/ 上游模型 / 公开模型 / 目标 / 优先级 / 关闭（历史名「封禁」）/ 冷却 / 连接密钥（后端 `/admin/api-keys`）
- 配置渲染 → AG 1.7 校验 → 原子下发 → 版本留档 → 一键回滚
- 用量拉取、定价、账本、日聚合、看板
- 真实控制台登录、数据库会话、三角色 RBAC、字段级金额权限
- 策略 / 护栏 / MCP 可编辑（受 AG 1.7 能力矩阵约束）
- 审计：谁在什么时候改了什么、下发了哪一版、为什么

**不做 / 二期范围外**

- fork agentgateway、改它内置 UI、往热路径塞 Python
- 组合嵌套、轮次、同层权重
- 影子对账、双写（新系统独立，不存在并行期）
- 旧库数据导入（D-03：旧数据全部丢弃；二期只提供 seed 与 priority 语义迁移脚本）
- 审计员角色、单条日志导出、TTFA 指标、表格过度分列（二期裁定不做）

## 3. 端口与进程

| 进程 | 端口 | 暴露面 | 说明 |
|---|---|---|---|
| agentgateway LLM | 3600 | 局域网 | 唯一数据面入口，`/v1/*` |
| agentgateway admin | 3611 | 仅本机 | 官方 UI 与配置管理 |
| agentgateway stats | 3612 | 仅本机 | Prometheus 指标 |
| agentgateway readiness | 3613 | 仅本机 | 就绪探针 |
| 控制面 Web/API | 3700 | 局域网 | 自研管理台，唯一管理入口 |

三个管理口一律绑 127.0.0.1；只有 3600 与 3700 对局域网开放。

## 4. 请求路径

```
客户端 --Bearer sk-ss-xxx--> AG:3600 /v1/chat/completions
                              |
                              +-- apiKey 策略校验（静态密钥表，控制面同步）
                              +-- virtualModel（对外模型名）
                                    +-- failover: priority 升序分层
                                          +-- 同层：健康分 + 延迟综合分选一个
                                          +-- 该层全降级 -> 下一层
                                    +-- llm.model（目标，visibility=internal）
                                          +-- 上游 baseUrl + 上游模型名 + 上游密钥
```

控制面全程不在路径上。

## 5. 控制面职责（只有五件）

1. **主数据**：上游、密钥、上游模型、对外模型、目标、优先级、封禁/冷却、客户端密钥
2. **渲染与下发**：领域模型 → 网关无关 IR → AG 1.7 配置；校验、原子写、确认、回滚
3. **密钥同步**：上游密钥落受保护文件，客户端密钥同步进 AG 鉴权策略
4. **用量与账本**：增量拉 AG 的请求日志，按价格快照算钱，出账
5. **看板与审计**：使用情况、成本、异常；改动留痕

## 6. 数据面职责（全部在 AG 内）

快照鉴权、健康分选路、failover、流式转发、请求日志落自己的 SQLite、（可选）限流与预算。

## 7. 目录与分层铁律

```
slipstream/
├─ api/
│  ├─ pyproject.toml  requirements.lock
│  ├─ src/
│  │  ├─ l01_core/        settings, logging, timeutil, crypto, errors
│  │  ├─ l02_domain/      领域模型 + 网关无关 IR（ir.py）
│  │  ├─ l03_adapters/    数据面适配（spi.py / registry.py / agentgateway/）
│  │  ├─ l04_repo/        ORM 与仓储
│  │  ├─ l05_service/     业务编排（CRUD、渲染、下发、计费）
│  │  ├─ l06_api/         FastAPI /admin/*
│  │  └─ l07_jobs/        用量拉取、冷却到期重渲染、升级检查
│  └─ tests/{unit,integration,contract}
├─ web/                   仅打 3700，禁止直连 AG
├─ docs/                  本目录
└─ ops/                   AG 版本钉、保活、部署脚本
```

**铁律（前后端同规则）**

- 依赖只能指向编号更小的层：`l05` 可 import `l01`–`l04`，`l03` 只能 import `l01`/`l02`，**禁止 import `l04`/`l05`**。
- `l03_adapters` 是唯一知道 agentgateway 存在的地方；`l04`/`l05` 不得出现任何 AG 专有名词（virtualModel、failover、llm.models 等）。
- 前端与后端同规则：页面层不直接调适配层，只经 `/admin/*` 接口。
- 用 import-lint 在 CI 卡死，不靠自觉。

**编码规范**

- 后端：Google Python Style；模块/函数/变量 snake_case；数据库列 snake_case；公共函数必须有类型注解；写 `X | None` 不写 `Optional[X]`；行宽 100。
- 前端：TypeScript strict；组件文件名 kebab-case；接口字段沿用后端 snake_case，不在前端二次改名。

## 8. 数据模型（二期现状）

| 分类 | 表 | 关键点 |
|---|---|---|
| 主数据 | `vendors` | 厂商：名称、备注 |
|  | `upstreams` | 一个可调用接入点：`code`（`{vendor_slug}-{NN}`，从 01 起、删除不复用）、vendor_id、base_url、api_style、`api_key_enc`（~~主密钥镜像~~；ADR-026 已废镜像，本列随 D 波退役）、enabled |
|  | `upstream_keys` | 上游密钥组：label、密文、suffix、~~is_primary~~。**每上游最多 20 把**；ADR-026 已废除主密钥与镜像，每把密钥平权展开为独立 AG 上游；至少保留一把，删除最后一把返回 409 |
|  | `upstream_probes` | 连通测试/发现模型的追加记录：kind、status、http_status、latency_ms、model_count、tested_at_ms |
|  | `upstream_models` | 上游模型：upstream_id、name、model_type、价格（input/output/cache_read/cache_write，每百万 token） |
|  | `public_models` | 公开模型：name（唯一）、enabled、备注 |
|  | `model_targets` | 目标：public_model_id → upstream_model_id、**priority（升序）**、enabled |
|  | `api_keys` | 客户端密钥：user_id、前缀、hash、密文、enabled、额度 |
|  | `users` | 使用者 |
| 可用性 | `availability_rules` | `kind` ∈ ban/cooldown；cooldown 带 `recurrence`（一次性到期 or 周期窗口） |
| 用量 | `gateway_usage_events` | AG 原始事件，可重放，event_id 幂等 |
|  | `ledger_entries` | 业务账本：事件 → 金额，带 price_version |
|  | `daily_aggregates` | 日聚合，看板读它 |
| 下发 | `config_revisions` | 每版配置：artifact、真实 sha256、操作人、生效状态、回滚目标、失败详情 |
| 系统 | `admin_users` | 控制台账号：username、display_name、password_hash、role（存 key）、status |
|  | `admin_roles` | 角色行：key、name、permissions_json、builtin、all_permissions；三个内置角色启动时补齐，不可删除 |
|  | `admin_sessions` | 会话：token 的 sha256、admin_id、过期/撤销时间、user_agent、client_ip |
|  | `app_settings` | 设置；策略/护栏/MCP 文档也落这里（`policy_config` / `guardrail_config` / `mcp_config`） |
|  | `audit_logs` | 审计 |

**不建**：`combos`、`combo_targets`、`attempts`、`request_bodies`；不沿用旧 `request_logs` 的 38 列。

## 9. 下发流程（二期）

1. 读取当前期望状态 → 生成 IR
2. `validate_gateway_ir(ir)`：IR 自校验
3. `adapter.validate(ir)`：调用 pinned AG 1.7 的 `--validate-only`，纯校验、不落盘
4. `adapter.render(ir)`：纯函数出 AG YAML
5. 写临时文件 → 原子 rename 覆盖
6. 等 AG 热加载并确认（读 status 里的配置 hash 与版本）
7. 超时或校验失败 → 自动回滚上一版；失败版本归档 `status=failed`，带 `error_detail`
8. 落 `config_revisions`，记录操作人、原因、前后 hash、真实文件 sha256

**策略/护栏/MCP 的保存不等于下发**：PUT 先在服务端 dry-run 走完整 IR → validate → render，失败 422 且不落库；成功后前端再调 `POST /admin/config/apply`，才会产生新的配置版本。

## 10. 用量、计费与字段权限

- AG 的请求日志落在它自己的 SQLite；控制面按游标增量拉取，按 event_id 幂等入库，落 `gateway_usage_events`。
- 计费在控制面算：按 `upstream_models` 的价格快照计算，写 `ledger_entries`，带 `price_version`。**价格调整不重算历史账**。
- 日聚合写 `daily_aggregates`，看板只读聚合表，不扫明细。
- 拉取失败、AG 重启、游标回退都要能安全重放（事件表只追加）。

**术语与口径**：
- **词元（token）**：统一中文叫法，对应 `input_tokens` / `output_tokens` / `total_tokens`；不再用“Tokens”作为界面文案。
- **成本（cost）**：上游进价，字段 `cost_micro`；**花费（charge）**：向用户计费/扣费，字段 `charge_micro`。毛利 = 花费 - 成本（`margin_micro`）。
- 字段级权限：没有 `billing:cost` 时，响应里**不出现** `cost` / `cost_micro` / `margin` / `margin_micro`（以及 `*_cost` / `*_margin` 后缀）；没有 `billing:spend` 时，不出现 `charge` / `charge_micro` / `spend` / `spend_micro` / `delta_micro` / `balance_micro` / `balance_after_micro`。是**缺键**，不是 null。
- 预付余额：控制面账本是权威余额；数据面用 `localRateLimit` 的 token 桶做快速拦截，桶淘汰/重启的漂移由对账重渲染收敛。

## 11. 阶段计划与状态

| 阶段 | 内容 | 状态 |
|---|---|---|
| P0 | 验证 AG 行为（§13 的 5 个实验） | 已完成，结论在 `docs/experiments/P0-RESULTS.md` |
| P1 | 主数据 + 渲染 + 下发 + 单个对外模型跑通 | 已完成 |
| P2 | 多目标优先级 + 密钥同步 + 封禁/冷却 + 回滚 | 已完成 |
| P3 | 账本 + 看板 + 审计 + 升级门禁 | 已完成 |
| 二期 | 品牌/认证/RBAC/渲染 v2/下发 v2/上游 v2/策略/MCP/模型试验/拆包/计费/看板/日志/设置/账单/seed/验收/文档 | ticket 01–22 全部已合并（2026-11-18） |

## 12. 已定决策

| 编号 | 决策 | 说明 |
|---|---|---|
| D-01 | 全部部署在 Windows 单机 | 数据面与控制面同机；该供应商只有 Windows 侧可达 |
| D-02 | 新数据面实例用 3600，**生产 3691 与 1900x 一律保留不动** | DSH 自身就走 3691；两个实例并存 |
| D-03 | 旧数据全部丢弃 | 不写导入脚本；上游/模型/密钥在新控制面手工重建 |
| D-04 | 下发方式 = 文件原子替换 | 不调 admin 写入 API |
| D-05 | 同层不加权 | 同 priority 由数据面按健康+延迟选路 |
| D-06 | 密钥明文落盘 | 靠 ACL 保护；上游密钥加密存库、渲染时写文件 |
| D-07 | 客户端密钥格式 | `sk-` + N 字符，N ∈ {1,2,4,8,16,32,64}，默认 64；字符集 A-Za-z0-9._- |
| D-08 | 上游密钥模型（二期 ticket 09 取代单密钥） | 每上游一个密钥组，最多 20 把；~~主密钥镜像到 `upstreams.api_key_enc`~~（ADR-026 修订：镜像废除、密钥平权展开）；多接入点仍可建多个上游记录 |
| D-09 | 权限模型（二期 ticket 03 取代四档角色） | 三角色 admin/agent/user + 管理员自建角色；权限按 41 个 resource:action 键校验；角色是 `admin_roles` 行，不再写死四档 |
| D-10 | 改写必须支持 | 请求/响应 × 头/体，全部走 `llm.policies.transformations`（CEL） |
| D-11 | PublicModel 即别名 | 不存在自动暴露的上游模型名；别名 d 指向上游模型 a 后，对外只有 d |
| D-12 | 表格分页 | 25/50/100/200，默认 50，服务端分页 |
| D-13 | 控制台认证（ticket 02） | 密码 scrypt；会话落 `admin_sessions` 且只存 token 的 sha256；httpOnly + SameSite=Lax cookie；绝对 12h，无滑动续期；登录 5 次/分钟限流；`X-Admin-Role` 永不信任 |
| D-14 | 字段级金额权限（ticket 03） | 无权限时字段直接缺失；`billing:cost` 管成本/毛利，`billing:spend` 管计费/花费/余额 |
| D-15 | 策略/护栏/MCP 可编辑（ticket 11） | 保存前 dry-run；AG 1.7 不支持的字段（retry、http MCP、webhook 带路径）显式 422 |

## 13. 风险与验证项

| 编号 | 风险 / 未知 | 验证方式 | 影响 |
|---|---|---|---|
| R1 | failover 是**健康驱动选路**还是**请求级失败重试** | 让一个目标故意返回 500，看同一请求是否切下一个 | 决定故障转移语义边界 |
| R2 | 配置热加载是否影响在飞的长流式请求 | 长流式进行中 reload，观察是否中断 | 决定能否随时改配置 |
| R3 | 健康分是否持久化 | 重启 AG 后看是否清空 | 决定运维窗口影响 |
| R4 | AG 升级可能改 SQLite 表结构 | 升级脚本内置 schema 断言 + 契约测试 | 决定升级门禁 |
| R5 | 密钥明文落盘（AG config 与 key 文件） | 收紧 ACL，确认只有服务账号可读 | 安全边界 |
| R6 | 封禁/冷却靠重渲染生效，有秒级延迟 | 实测 reload 耗时 | 与“立即生效”的预期差 |

## 14. 策略、护栏、MCP（二期可编辑）

三块都落 `app_settings`，有 CRUD 接口；写路径 dry-run 通过完整 IR/AG 1.7 校验，保存后由 apply 流程下发。

| 能力 | 现状 | AG 1.7 边界 |
|---|---|---|
| 客户端鉴权 | `llm.policies.apiKey` 静态密钥表，strict 模式可关 | 关闭时数据面匿名放行，密钥台账不删除 |
| CORS | 控制面 CORS 由 `SLIPSTREAM_CORS_ORIGINS` 决定；数据面 CORS 由 `llm.policies.cors` 下发 | 两者不是一回事 |
| 限流 | 全局请求/词元速率限制渲染到 `llm.policies.localRateLimit` | 桶是实例本地、按最少使用淘汰 |
| 额度 | 预付余额 + 数据面 token 桶快速拦截 | 桶不是账本；金额强制以控制面账本为准 |
| 护栏（请求/响应） | 可编辑；正则与 webhook 子集；渲染到 `llm.models[].guardrails` 与 `llm.policies.guardrails` | webhook 只支持 reject/audit，target 只能是 host（带路径被拒），scope/rules 为空 |
| 改写 | `llm.policies.transformations`，请求/响应 × 头/体 | 默认只追加两条响应头 delete；body 路径不设白名单，风险归管理员 |
| MCP | 可编辑；渲染到**顶层** `mcp.targets` + `mcp.policies` | 只支持 sse/stdio；http 变体和 `url` 字段被 AG 1.7 拒绝，保存 422 |
| retry | **不支持**；`llm.policies.retry` 必须为 null | 非 null 会被 AG 1.7 `unknown field 'retry'` 拒绝，后端 422 |
| 可观测 | 请求日志入账 + Prometheus 指标透出 | `observe.*` |

**IR 落位**：`PoliciesSpec` / `GuardrailsSpec` / `McpSpec` 是 `GatewayIR` 字段，默认空结构；`l05_service/policies.py:build_policy_blocks(adapter)` 填充；渲染只在 `l03_adapters/agentgateway/render.py`。能力矩阵来自适配器 `describe().capabilities`，前端据此置灰。

## 15. 真实登录与 RBAC（二期）

**登录/会话**
- 密码哈希：scrypt（`hashlib.scrypt`，N=2^14、r=8、p=1、dklen=32、16 字节盐），格式 `scrypt$N$r$p$salt$digest`；兼容旧 pbkdf2（120000 次）。
- 会话：`POST /admin/auth/login` 校验后写 `admin_sessions`，只存 `sha256(token)`；cookie `slipstream_admin_session` 为 HttpOnly、SameSite=Lax、Path=/、Max-Age=43200（12h）；`SLIPSTREAM_COOKIE_SECURE=1` 时加 Secure。
- 未认证：除 `/api/health`、`/admin/health`、`/admin/auth/login`、`/admin/auth/logout` 外，所有 `/admin/*` 返回 401。
- 登录失败统一 401“用户名或密码错误”；同一 username+IP 60 秒内失败 5 次 → 429“登录尝试过于频繁，请稍后再试”。
- `GET /admin/auth/me` 返回 id/username/name/role/status/permissions/expires_at/auth_disabled；前端按 permissions 显隐页面、按钮、列。
- `X-Admin-Role` 不参与认证；带该头也会被忽略。

**角色与权限**
- 三个内置角色：`admin`（管理用户，全部 41 个权限）、`agent`（代理用户，普通用户 + users:read/create/update + billing:subtree）、`user`（普通用户，只读主数据/治理/价目/用量报表 + billing:spend + playground:use）。
- 管理员可自建角色：`GET/POST /admin/roles`、`PATCH/DELETE /admin/roles/{id}`、`GET /admin/permissions`；自定义角色权限必须是注册表里的键，内置角色权限不可改、不可删；仍有成员的自定义角色不可删。
- 旧角色名只用于迁移：owner→admin、operator→agent、viewer→user；新数据不再写四档角色。
- 权限键共 **41 个**（主数据 10 / 流量治理 4 / 治理 7 / 计费 6 / 用量 3 / 账号 10 / 模型试验 1），以 `GET /admin/permissions` 为准；此前若写 40，属于旧口径。

## 16. 前端交付与包体

- 路由级 `React.lazy` + Suspense，每页独立 chunk；echarts/recharts 走 manualChunks，按需加载。
- 当前基线 `check:bundle`：首包 **gzip 193.8 KB**；共 **66** 个 JS chunk；echarts 惰性 chunk gzip 148.2 KB；阈值 maxFirstLoad=220 KB、minChunks=20、maxChunk=400 KB，检查 PASS。
- 页面（五期口径）：**19 个页面模块 = 17 个功能页 + 登录 + 404**，共 **27 条路由**（含 8 条旧入口重定向）；**15 个一级导航项**（运营设置 3 段为页内子导航）。二期当时的「23 页面组件/29 路由」已过时，以 `web/src/routes.ts` + `ops/checks/route-audit.mjs` 为准。
- 术语：token 统一“词元”，收费统一“花费”，成本保留“成本”；公开模型、连接密钥、模型试验、价目管理为最终 UI 命名。

## 17. 范围外 / 后续

- **接真实数据面**：把 agentgateway 渲染产物下发到 3600 实例（原子替换 + 回滚），3691 生产实例保持不动。
- **旧库迁移**：按新模型手工/脚本录入；priority 用 `migrate_priority_v2.py` 一次性翻转。
- **趋势窗口化**：补 24h / 小时桶，与看板时间窗联动。
- 组合（combo）编排、审计员角色、单条日志导出、TTFA 指标均按二期裁定不做。

## 18. 文档索引

- `docs/api-contract.md`：前后端唯一契约基准
- `docs/GLOSSARY.md`：词义与页面类型
- `docs/CHANGELOG-phase2.md`：二期已合并 ticket 清单
- `docs/DECISIONS.md`：ADR
- `docs/FEATURE-PARITY.md`：旧前端 → 新管理台对齐
- `docs/experiments/P0-RESULTS.md`：AG 行为实验
