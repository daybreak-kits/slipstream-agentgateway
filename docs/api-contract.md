# Slipstream 控制面 API 契约（二期同步稿）

控制面 base URL：`http://127.0.0.1:3700`

> **错误响应与分页（全局约定，旧系统 ssot §6 口径，前端先读这段）**
> - 管理 API 的所有非 2xx 业务错误统一信封 `{code, message, details?, request_id}`（见 §0.2）；
>   未登录 401、缺权限 403、参数越界 422 `VALIDATION_ERROR`，前端按 `code` 分支处理，不解析 message 文案。
> - 分页档位固定 **25/50/100/200**（默认 50），`page_size` 超出档位一律 **422** `VALIDATION_ERROR`；
>   `offset ≥ 0`，负数 422。唯一来源 `api/src/l06_api/deps.py:ALLOWED_PAGE_SIZES`。

> 基线：`phase2/integration`（2026-11-18）。**ticket 01–22 全部已合入**，本文覆盖最终接口面（OpenAPI 实测 89 条路径 / 125 个操作）。

本文是前后端契约的人类解释与语义基准（Lead 决策，2026-11-17）；组件 schema 的机器可读
副本由 `python ops/contract/gen_ts.py` 从 FastAPI OpenAPI 生成到
`web/src/generated/contract.ts`，`--check` 在 CI/本地防止手改。凡前端调用与两者不符，按前端 bug
处理（t7 改），不为旧路径加兼容层——只有 /admin/settings、/admin/audit-logs、
/admin/config/revisions/latest、/admin/overview 四个入口是 task-170 新增的补齐接口。

二期同步：真实认证、三角色 RBAC、字段级金额权限、上游多密钥、策略/护栏/MCP 可编辑（ticket 02/03/09/11）；计费/价目/看板/日志/设置/账单/用户层级（ticket 04/05/06/10/12/13/14/16/17）；seed 与 priority 迁移（ticket 19）。

## 0. 通用约定

### 0.1 身份与权限（真实会话 + RBAC，ticket 02/03）
控制台身份来自数据库会话 + httpOnly cookie：前端不再持有 token，也不再信任
`X-Admin-Role`（带该头也会被忽略）。

- `POST /admin/auth/login` body `{"username","password"}` → 200
  `{"user": {...}, "expires_in": 43200}`，并
  `Set-Cookie: slipstream_admin_session=...; HttpOnly; SameSite=Lax; Path=/; Max-Age=43200`；
  HTTPS 部署加 `Secure`（`SLIPSTREAM_COOKIE_SECURE=1`）。
- `POST /admin/auth/logout` 撤销当前会话并清 cookie（幂等）。
- `GET /admin/auth/me` → `{id, username, name, role, status, permissions, expires_at,
  auth_disabled:false}`；`permissions` 是实时权限键数组，SPA 据此显隐页面/按钮/列。
- `PATCH /admin/auth/me` body `{"name": "显示名"}` → 修改自己的显示名（username/role 由管理员
  维护，不接受）；空白显示名 422。响应同 GET /admin/auth/me（登录即可，无需额外权限键）。
- `GET /admin/auth/preferences` → 当前账号的用户设置偏好 `{theme, notify_email,
  notify_browser, notify_weekly, bio}`；未保存过时返回默认值（theme="system"、
  notify_email/notify_weekly=true、notify_browser=false、bio=""）。存于
  `app_settings` 的 `user_pref:<admin_id>` 键，不会混进运营设置列表（§2.1）。
- `PUT /admin/auth/preferences` body 同上结构；`theme` 只接受 light/dark/system，越界 422；
  bio 截断至 500 字。响应回显保存后的值。
- 除 `/api/health`、`/admin/health`、`/admin/auth/login`、`/admin/auth/logout` 外，
  所有 `/admin/*` 需要有效会话；未登录 / 已过期 / 伪造 cookie → 401 `UNAUTHORIZED`
  「未登录或会话已失效」。
- 登录失败（用户不存在 / 密码错 / 账号禁用）统一 401「用户名或密码错误」；同一用户名或
  同 IP 60 秒内失败 5 次 → 429 `RATE_LIMITED`「登录尝试过于频繁，请稍后再试」。
- 密码以 scrypt（标准库 `hashlib.scrypt`，N=2^14/r=8/p=1/dklen=32，16 字节盐）哈希，
  格式 `scrypt$N$r$p$salt$digest`；兼容旧 pbkdf2（120000 次）。改密 / 禁用会撤销该账号全部会话；
  会话绝对过期 12 小时，无滑动续期。
- 角色：内置 `admin`（管理用户，全部 41 个权限）、`agent`（代理用户）、`user`（普通用户）；
  管理员可自建角色（`admin_roles` 行），内置角色权限不可改、不可删，仍有成员的自定义角色不可删。
  旧角色名只用于迁移：owner→admin、operator→agent、viewer→user。
- 权限键共 41 个，注册表在 `l05_service/rbac.py`，`GET /admin/permissions` 返回分组与 keys；
  每个接口的权限列写的是权限键；缺权限统一 403 `FORBIDDEN`。
- 字段级金额权限见 §0.5：无 `billing:cost` 时成本/毛利键直接缺失；无 `billing:spend` 时
  花费/余额键直接缺失。

### 0.2 错误信封
所有非 2xx 业务错误（AppError 处理器）统一为：

```json
{
  "code": "VALIDATION_ERROR",
  "message": "page_size must be one of (25, 50, 100, 200)",
  "details": {"page_size": 30},
  "request_id": "9f2c..."
}
```

- 响应头带 `X-Request-Id`；请求可自带同名头沿用。
- 请求体/查询参数校验失败（FastAPI RequestValidationError）→ 422 `VALIDATION_ERROR`，
  `details.errors` 为原始错误列表（最多 10 条）。
- 领域校验（`l05_service/*`）也走 422 `VALIDATION_ERROR`，`message` 是中文可读原因（例：
  一次性冷却必须提供 `expires_at_ms`）。
- 常见 code：VALIDATION_ERROR / NOT_FOUND / CONFLICT / UNAUTHORIZED / SCHEMA_MISMATCH /
  APPLY_FAILED / CRYPTO_FAILED / INTERNAL_ERROR。
- `APPLY_FAILED` 一律 HTTP 502，三个来源靠 `details` 区分：
  - IR 自校验失败（`api/src/l02_domain/validation.py`）：`details.errors` 是错误字符串列表；
  - 适配器校验失败（`adapter.validate(ir)`，发生在写密钥文件与渲染之前）：`details.errors` 同上；
  - 渲染/下发/热加载失败：`details.revision` 是已归档 `status=failed` 的版本 id。

### 0.3 分页
- 页面大小档位固定 25/50/100/200，默认 50；`page_size=30` → 422 VALIDATION_ERROR。
  档位的唯一来源是 `api/src/l06_api/deps.py:ALLOWED_PAGE_SIZES`，生成器输出到
  `web/src/generated/contract.ts:PAGE_SIZE_TIERS`，前端分页器不再复制一份。
- `offset` ≥ 0，负数 → 422。
- 返回形态（2026-11-17 03:27 Lead 实测确认，前端不得再猜）：
  - **列表型：裸数组 `[item, ...]`** —— vendors / upstreams / upstream-models /
    public-models / model-targets / users / api-keys / availability-rules /
    config/revisions / cost/entries / charge/entries / prices/*。
  - **分页信封：只有两处** `/admin/logs` 与 `/admin/audit-logs`，
    `{"items": [...], "total": <int>, "next_offset": <int|null>}`（next_offset=null 表示末页）。
  - **自定义对象**：reports/overview（扁平）、reports/trend、reports/flow、unpriced（{cost,charge}）、
    settings（{items}）。
- 嵌入式字段：public-models 列表项默认嵌 `targets[]`（`?with_targets=false` 可关）；
  upstream-models 列表项嵌 `upstream_name`、`vendor_name`。
- 时间字段两套并存：`created_at_ms`（毫秒 epoch，列表接口主用）与
  `created_at`（ISO8601，settings/audit-logs 用）。

### 0.4 金额
- 一律整数 micro（1 CNY = 1_000_000 micro），字段后缀 `_micro`；货币 `currency`
  取 CNY/USD（v1 主币种 CNY）。
- 上游成本（cost）与对外计费（charge）两套账，margin = charge - cost。
- 缺失汇率不按 0 计入：跨币种换算无汇率快照时明细金额返 `null`，响应同时带 `fx_missing:[币种]`；汇总只累加已知部分（请求/词元仍全量）。
- 舍入规则统一为 `round_micro`（half-up，负数对称）；markup 先乘后一次舍入，不在中间步骤重复舍入。

### 0.5 字段级金额权限（ticket 03 / W3 中央过滤）
金额字段不是只控制页面：认证中间件解析 principal 后，`MoneyVisibilityMiddleware`
对每个 `/admin` JSON 响应递归过滤一次；路由不需要、也不应该再手写 sanitize。

| 权限 | 放行字段 | 缺权限时的表现 |
|---|---|---|
| `billing:cost` | `cost`、`cost_micro`、`margin`、`margin_micro`、`markup`、`markup_ratio`，以及 `*_cost` / `*_cost_micro` / `*_margin` / `*_margin_micro` / `*_markup` | 键**不存在**（不是 null） |
| `billing:spend` | `charge`、`charge_micro`、`spend`、`spend_micro`、`delta_micro`、`balance_micro`、`balance_after_micro`，以及 `*_charge` / `*_charge_micro` / `*_spend` / `*_spend_micro` | 键**不存在**（不是 null） |

对 `amount_micro` 这类上下文相关字段，路由在装饰器声明
`openapi_extra={"x-money-amount-class": "cost" | "spend"}`，中间件据此决定归哪本账；
有名称的键直接按上表词表处理。不要用 null 判断“无权”，要用键是否存在。

唯一逃逸口是流式响应（NDJSON/CSV/text）与**字符串化的 JSON 字段**：它们不经过该中间件，
路由必须在投影处自行 parse→sanitize→dumps（当前显式调用点：ops 详情与 usage event 详情的
`raw_json`）。普通 `logs:read` 账号读到的 raw_json 里不会出现 `cost`/`charge` 键。

## 1. 健康与总览

| 方法 | 路径 | 权限 | 说明 |
| --- | --- | --- | --- |
| GET | /admin/health | 无 | 存活探针，200 即健康 |
| GET | /admin/overview | reports:read | 别名，与 /admin/reports/overview 完全同构 |

/admin/overview 接受可选 `from_ms`/`to_ms`，语义同 reports/overview。

## 2. 元数据与治理（task-170 新增）

### 2.1 GET /admin/settings
权限：settings:read。返回全部可编辑设置项（固定顺序，未落库的键回显默认值）：

```json
{
  "items": [
    {"key": "base_currency", "value": "CNY", "label": "基准币", "updated_at": "2026-11-17T03:10:00+00:00"}
  ]
}
```

- `updated_at` 为 ISO8601；从未写入的键为空字符串 ""。
- 受支持键（唯一来源 `l05_service/settings_schema.py:SETTING_FIELDS`，分组/标签/类型/范围由 §2.2 下发）：
  base_currency（CNY|USD，默认 CNY）、timezone（默认 Asia/Shanghai）、log_retention_days（int 1..365，默认 30）、
  audit_retention_days（int 7..3650，默认 180）、default_tokens_per_minute（int 0..1_000_000，默认 60000）、
  default_concurrency（int 0..1000，默认 8）、gateway_base_url（http(s) URL，留空自动取当前 host+3600）、
  ag_access_log_llm（metadata|full，默认 metadata；ADR-021 请求正文日志全局开关——metadata 只存元数据，
  full 额外落 prompt/补全正文到 `request_log_payloads`，随 log_retention_days 一并清理）。

### 2.2 GET /admin/settings/schema
权限：settings:read。返回设置的分组、字段元数据与默认值；前端据此渲染表单，不再维护静态副本。

```json
{
  "groups": [
    {
      "key": "money",
      "title": "金额",
      "description": "计价与展示币种",
      "fields": [
        {
          "key": "base_currency",
          "label": "基准币",
          "description": "账单与看板的展示币种",
          "kind": "select",
          "default": "CNY",
          "unit": "",
          "min": null,
          "max": null,
          "options": [{"value": "CNY", "label": "CNY"}, {"value": "USD", "label": "USD"}]
        }
      ]
    }
  ]
}
```

- `kind` 取 `text | number | select`；`min`/`max` 仅 number 有值，`options` 仅 select 有值。
- 默认值与 `GET /admin/settings` 对未落库键的回显一致；`PUT` 的取值校验使用同一个
  `settings_schema.coerce_setting`，前后端不会各写一套范围。
- 未知键或越界值仍返回 422 `VALIDATION_ERROR`（详见 §2.3）。

### 2.3 PUT /admin/settings
权限：settings:write。只更新请求里出现的键。

请求体：

```json
{"values": {"base_currency": "USD"}}
```

响应 200：GET 同构响应 + 回显本次接受的 values（兼容两种旧客户端）：

```json
{
  "items": [{"key": "base_currency", "value": "USD", "label": "基准币", "updated_at": "..."}],
  "values": {"base_currency": "USD"}
}
```

校验与错误：
- 未知键 → 422 VALIDATION_ERROR，details={unknown:[...], known:[...]}。
  决策：拒绝而非静默忽略，避免前端拼错键后误以为保存成功。
- 值为空、int 键非整数/负数、currency 非 CNY|USD → 422。
- 空 values 或缺 values → 422。

### 2.4 GET /admin/audit-logs
权限：`audits:read`（审计日志独立权限键；非 settings:read）。

| 参数 | 类型 | 默认 | 说明 |
| --- | --- | --- | --- |
| limit | int 1..200 | 50 | 页大小 |
| offset | int ≥0 | 0 | 偏移 |
| action | string | "" | 子串匹配（大小写不敏感） |
| actor | string | "" | 子串匹配（大小写不敏感） |

```json
{
  "items": [
    {
      "id": "aud1a2b3c...",
      "actor": "李四",
      "action": "apply_config",
      "target": "config_revision",
      "detail": "{\"name\": \"zai-01\"}",
      "created_at": "2026-11-17T03:10:00+00:00"
    }
  ],
  "total": 69,
  "next_offset": 50
}
```

- 按 created_at_ms DESC, id DESC 排序；detail 是 JSON 字符串，可直接当文本展示。
- next_offset 在最后一页为 null。

### 2.5 GET /admin/config/revisions/latest
权限：config:read。返回最新一条配置版本，字段同 /admin/config/revisions 元素：

```json
{
  "id": "rev...",
  "artifact_hash": "sha256...",
  "adapter_id": "agentgateway",
  "operator": "李四",
  "reason": "新增 qwen-max 权重路由与冷却规则",
  "status": "active",
  "previous_revision_id": "rev...",
  "error_detail": "",
  "validation_note": "",
  "created_at_ms": 1794000000000
}
```

`status` 唯一取值 `active | superseded | failed`（后端 `RevisionStatus` StrEnum，OpenAPI `components.schemas.RevisionStatus` 同步下发）；`operator` 来自当前登录 principal，不再硬编码为 `api`。

没有任何版本时 → 404 NOT_FOUND（前端把 404 当"尚未下发"空态，不当错误页）。

### 2.6 /admin/policies、/admin/guardrails、/admin/mcp-servers（可编辑）

权限：GET 与 `POST .../validate` 为 `policies:read`；PUT/DELETE 为 `policies:write`。
配置落 `app_settings`（键 `policy_config` / `guardrail_config` / `mcp_config`）。每次写入先在服务端 dry-run：
文档 → `GatewayIR` → `validate_gateway_ir` → `adapter.validate` → `adapter.render`；任一步失败返回
422 `VALIDATION_ERROR`，`details.errors` 列出具体字段，**不落库、不静默丢弃**。保存成功只代表文档已存，
前端随后调用 `POST /admin/config/apply` 完成渲染/校验/下发，配置修订随之变化。

`GET /admin/policies` → `{config, defaults, effective, counts, capabilities, notes, updated_at_ms}`；
`PUT /admin/policies` body `{config}`；`DELETE /admin/policies` 恢复默认；
`POST /admin/policies/validate` body `{config}` → `{ok, errors, warnings}`。

| `config` 字段 | 说明 |
|---|---|
| `cors` | `enabled` + `allow_origins/allow_credentials/expose_headers/allow_methods/allow_headers/max_age`；enabled 后才渲染数据面 `llm.policies.cors`。控制面自身 CORS 仍由 `SLIPSTREAM_CORS_ORIGINS` 决定 |
| `api_key` | `{enabled, mode: "strict"}`；`enabled=false` 时整段 `llm.policies.apiKey` 不渲染（匿名放行），密钥台账不删除 |
| `local_rate_limit` | `requests_per_minute` / `tokens_per_minute`，null 不渲染；渲染到 `llm.policies.localRateLimit` |
| `timeout` | `request_timeout` / `backend_request_timeout` / `response_idle_timeout`（humantime 字符串，如 `60s`）；全空不渲染 |
| `transformations` | `default_response_header_deletes` + `protected_request_headers`；前者按 ADR-010 追加在用户规则之后 |
| `retry` | 请求内重试（ADR-024）：`{attempts: 1-10, codes: [400-599], backoff: humantime}`；缺省 null=不启用（现行为）。渲染为顶层 `policies[]` 的 route 级 retry（target `internal/llm:request`），不写入 `llm.policies`（1.7 在该处拒绝 retry）。`attempts` 为首次之后的尝试次数，>=2 才可能跨层 failover |
| `health` | 逐模型健康标记与驱逐（ADR-024）：`{unhealthy_expression: 非空, consecutive_failures: >=1, duration: humantime, restore_health: >=0}`；缺省 null=不启用。渲染为 `llm.models[].health`。**成对规则**：`retry.codes` 含任一 4xx（400-499）时必须同时给出 `health`（非空表达式 + consecutive_failures>=1），否则 422 `details.errors` 逐行说明（E16/E17：仅 codes 不会换组） |
| `tracing` | 链路追踪（M5-a，E19）：`{enabled: bool 默认 false, host: "127.0.0.1", port: 4318, protocol: "http", random_sampling: bool 默认 true}`。启用后渲染 `frontendPolicies.tracing {host: "host:port", protocol: "http", randomSampling: "true"\|"false"}`，AG 向控制面常驻 OTLP/HTTP 接收器（默认 `127.0.0.1:4318`，`SLIPSTREAM_TRACE_OTLP_HOST/PORT`）`POST /v1/traces` 导出 span；`randomSampling` 必须是字符串，1.7 默认 false 时无 span。顶层 `tracing` 键会被 1.7 拒绝 |

`effective` 是下发前的可读预览（含 key_auth 语义、令牌桶语义、routing 说明），`capabilities` 是适配器
能力矩阵子集（`cors/api_key/local_rate_limit/timeout/transformations/retry/health/tracing/guardrails_regex/guardrails_webhook`）。

`GET /admin/guardrails` → `{config, defaults, adapter, items, capabilities:{regex,webhook}, note, updated_at_ms}`；
写法同上。`config` = `{streaming: "Disabled"|"Enabled", request: Guard[], response: Guard[]}`，`Guard` 是
AG 1.7 的安全子集：

| `kind` | 字段 | 约束 |
|---|---|---|
| `regex` | `action`(mask/reject/audit)、`rules`(每条形如 `{builtin: "ssn"}` 或 `{pattern: "..."}`)、`scope`(systemPrompt/messages/toolInput/toolOutput)、可选 `rejection_status/rejection_body` | rules 非空；pattern 与 builtin 二选一；内置规则 ssn/creditCard/phoneNumber/email/caSin |
| `webhook` | `action`(reject/audit)、`webhook_target`、`failure_mode`(failClosed/failOpen)、可选 rejection | target 只能是 host（带路径被 AG 1.7 拒绝）；scope 与 rules 必须为空（固定检查 systemPrompt + messages） |

`items` 是适配器完整能力矩阵（`describe().capabilities`），前端用它置灰不支持项。

`GET /admin/mcp-servers` → `{servers, port, defaults, supported, transports:{sse,stdio,http}, note, updated_at_ms}`。
管理接口：

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | /admin/mcp-servers | body 为单个 server；重名 409 CONFLICT |
| PUT | /admin/mcp-servers | body `{servers, port}` 整档替换（原始 JSON 编辑用）；重名 409 |
| PUT | /admin/mcp-servers/{name} | 编辑/改名；404 / 409 |
| DELETE | /admin/mcp-servers/{name} | 204 |
| POST | /admin/mcp-servers/validate | body `{servers, port}` → `{ok, errors, warnings}` |

server 字段：`name` + `transport`(`sse`/`stdio`/`http`)。`sse` 用 `host`（AG 1.7 没有 `url` 字段，传 url 会被拒）、
可选 `port`+`path`（必须成对）；`stdio` 用 `cmd`+`args`+`env`，不接受 host/port/path；`http` 变体被 pinned
AG 1.7 拒绝（`mcp.transport.http=false`），保存即 422。渲染到顶层 `mcp.targets`，不在 `llm:` 内。

### 2.7 GET /admin/connection
权限：任何有效登录（不要求 settings:read，普通用户也能看接入信息）。返回统一网关连接地址：

```json
{"base_url": "", "configured": false, "default_port": 3600,
 "endpoints": ["/v1/chat/completions", "/v1/models", "/v1/embeddings"],
 "updated_at": "", "editable": true}
```

- `base_url` 为运营设置 `gateway_base_url` 的显式配置值，空串=未配置（前端回退当前 host+3600）；
- `endpoints` 为服务端下发的数据面端点清单，只含对真实 AG 实测过有依据的三条（E14）；前端不自行硬编；
- `editable` 表示当前账号是否持有 `settings:write`（决定设置页能否改此键）。

## 3. 资源管理

### 3.1 厂商 vendors
| 方法 | 路径 | 权限 | 说明 |
| --- | --- | --- | --- |
| GET | /admin/vendors | vendors:read | 列表（page_size/offset） |
| POST | /admin/vendors | vendors:write | body {name, slug, note?} |
| PATCH | /admin/vendors/{vendor_id} | vendors:write | 部分字段更新 |
| DELETE | /admin/vendors/{vendor_id} | vendors:write | 有下游引用时 409 CONFLICT |

### 3.2 上游 upstreams
| 方法 | 路径 | 权限 | 说明 |
| --- | --- | --- | --- |
| GET | /admin/upstreams | upstreams:read | 列表；每项含 `has_api_key`、`key_count`、`model_count`、`last_probe` |
| POST | /admin/upstreams | upstreams:write | body {vendor_id?, name?, base_url, api_style, api_key, transforms?, max_buffer_bytes?}；命名规则见下 |
| GET | /admin/upstreams/{upstream_id} | upstreams:read | 详情（含密钥数、模型数、最近探测、`api_style_source`） |
| PATCH | /admin/upstreams/{upstream_id} | upstreams:write | 可改 name/base_url/api_style/enabled；`name` 可选（缺省或空白=不改名，显式改名重名 422）；api_style 同创建一样接受 `auto`，落库前解析为具体风格 |
| DELETE | /admin/upstreams/{upstream_id} | upstreams:write | 被 `model_targets` 引用时 409，不级联 |
| GET | /admin/upstreams/{id}/keys | upstreams:read | `{items, limit: 20}`；只回 masked/key_suffix 与每把的 `last_test`/`last_test_at_ms`，不回明文；密钥平权无主备（ADR-026） |
| POST | /admin/upstreams/{id}/keys | upstreams:write | {label, api_key}；重复密钥 409；超过 20 把 409；每把密钥渲染为一个独立 AG 上游（`{upstream_id}#{seq}`） |
| PATCH | /admin/upstreams/{id}/keys/{key_id} | upstreams:write | 仅改 label；`is_primary` 已废，请求携带即 422（schema extra=forbid） |
| DELETE | /admin/upstreams/{id}/keys/{key_id} | upstreams:write | 最后一把 409「至少保留一把密钥；如需停止调用请直接停用上游」 |
| POST | /admin/upstreams/{id}/keys/batch-delete | upstreams:write | body {ids[]}；逐把删除并返回逐把结果 `{items:[{key_id, ok, error?}], deleted}`；最后一把以 per-item 错误拒绝 |
| POST | /admin/upstreams/{id}/keys/test | upstreams:write | body {api_style?}；逐把按 base_url 发最小鉴权请求，返回 `{items:[{key_id, ok, status_code, latency_ms, error}]}`；结果落每把的 last_test_json/last_test_at_ms |
| POST | /admin/upstreams/{id}/test-connection | upstreams:write | 8s 超时，写 `upstream_probes`；返回 kind/status/http_status/latency_ms/model_count/tested_at_ms + 协议探测三字段（见下） |
| POST | /admin/upstreams/{id}/discover-models | upstreams:write | 探测候选模型，不自动建记录；响应同样带协议探测三字段 |
| POST | /admin/upstreams/{id}/import-models | upstreams:write | body {names, model_type}，创建缺失的上游模型 |
| PATCH | /admin/upstreams/batch | upstreams:write | body {ids, action: enable\|disable\|delete}；逐项处理，被引用的删除单独失败 |
| GET | /admin/upstreams/{id}/transforms | transforms:read | 返回 `{upstream_id, transforms}`，transforms 为 4 段规则或 `null` |
| PUT | /admin/upstreams/{id}/transforms | transforms:write | 整体替换 4 段规则 |
| POST | /admin/upstreams/{id}/transforms/preview | transforms:read | body 为 4 段完整规则（本段用草稿覆盖）→ `{upstream_id, before, after, skipped, notes}`；不落库 |

命名与厂商可选（ADR-023 #6，工单 D）：

- `vendor_id` **可空**：不带厂商也能建上游；返回体里 `vendor_id`/`vendor` 相应可为 null（前端 F3 兼容）。
- 名称取值顺序：请求带 `name` 用请求值（重名 422，与其他实体一致）；未带 name 且显式指定 vendor 时沿用
  `{slug}-NN` 计数器；vendor 也缺省时由 base_url 生成——取 host:port，`www.abc.com:8080` → `www-abc-com-8080`
  （http/https 默认端口 80/443 去掉、非 [a-z0-9] 字符折叠为 `-`、重名追加 `-2`/`-3`）。

协议自动探测（工单 C，向后兼容）：

- `api_style` 输入接受 `"auto"`（永不落库）：探测顺序 openai_chat(/v1/models) → openai_responses(/v1/responses
  最小探测) → anthropic_messages → gemini（密钥走 `x-goog-api-key` 头，不进 URL）；全部未命中 422，details 带
  `protocol_source: "auto"` 与逐协议 `probe_steps`。
- discover / test-connection 响应在既有字段之上新增 `protocol`（解析出的协议，失败为 null）、`protocol_source`
  （`auto` | `manual`）、`probe_steps`（每步协议/判定/降级说明）；
- 上游详情新增 `api_style_source`：当前 api_style 的来源（`auto`=最近一次自动探测结果与库中一致，否则 `manual`）。

改写规则的两条边界（与 §2.6 的 `transforms_defaults` 同源）：

- `body` 路径**不设白名单**，含 `model` / `stream` 在内都可改，风险由管理员承担（W2）；
- 系统默认动作只有两条响应头 `delete`（`server`、`x-powered-by`），不再注入 `response.code < 400`
  的响应体默认条件（W1）。

### 3.3 模型三层
| 方法 | 路径 | 权限 | 说明 |
| --- | --- | --- | --- |
| GET/POST | /admin/upstream-models | upstream_models:read/write | 上游模型列表/创建 |
| GET/POST | /admin/public-models | public_models:read/write | 对外模型（别名层） |
| GET | /admin/model-targets | model_targets:read | 目标（priority/weight/enabled） |
| PATCH/DELETE | /admin/model-targets/{target_id} | model_targets:write | 改 priority / enabled，或删除（PATCH 不接受 weight，weight 只在创建时给定） |
| PATCH | /admin/upstream-models/batch | upstream_models:write | body `{ids:[...], action:"enable"\|"disable"\|"delete"}` → `{changed:[id], missing:[id], action}` |
| PATCH | /admin/public-models/batch | public_models:write | 同上 |
| PATCH | /admin/model-targets/batch | model_targets:write | 同上 |
| POST | /admin/upstream-models/{id}/adopt-modelsdev | upstream_models:write | **从 models.dev 兑入单条**（W4-H）：先尽力刷新快照（失败降级用库内 `model_dev_snapshots`），按模型名匹配（精确优先，大小写不敏感且唯一才回退；不做模糊猜测），**只填空键**（0/False/默认单模态/NULL 进价视为空，手改永不覆盖）→ `AdoptModelsDevResult {id, name, matched, status, provider, model, refreshed, results{键→filled\|skipped-manual\|skipped-no-fx\|no-match}, filled[], params_source}` |
| POST | /admin/upstream-models/adopt-modelsdev | upstream_models:write | **同步 models.dev（批量）**（W4-H）：全部上游模型一次兑入，返回 `{refreshed, snapshot{providers,models,fetched_at_ms}, total, matched, filled_models, filled_keys, no_match, items[]}`；控制台「同步 models.dev」按钮与每日 job（`models_dev_sync`，SLIPSTREAM_JOBS_ENABLED=0 可停）共用同一服务 |
| GET | /admin/upstream-models/modelsdev-status | upstream_models:read | **库内 models.dev 快照摘要**（W4-H）：只读 `model_dev_snapshots`、不发网络请求 → `ModelsDevSnapshotStatus {models, providers, fetched_at_ms}`；`fetched_at_ms=0` 表示从未同步，控制台工具条据此显示「上次同步」|

W4-H 兑入语义：

- 参数来源徽章：upstream-models 列表/创建/PATCH 出参新增 `params_source`（`manual`=人工录入 / `models.dev`=最近一次兑入填过空键；PATCH 真改参数块会翻回 manual，无操作保存不翻）。
- models.dev 价格是 USD/1M，进价账本是 CNY/1M：兑入按 `fx_snapshots` 最新 USD 汇率换算，无汇率时成本键报 `skipped-no-fx` 不填（参数照填）。
- 每日 job：`l07_jobs/models_dev_sync.py`（24h）拉快照+自动兑入，失败保留旧快照并记 warning。

### 3.3.1 用户侧模型参数（W4-H）
| 方法 | 路径 | 权限 | 说明 |
| --- | --- | --- | --- |
| GET | /admin/my/models | 仅登录会话 | 登录用户可查**所有启用中的公开模型**的参数合集：`[{name, model_type, parameters{9 键规范块}, sources[]}]`，成员按 priority 升序合并（首个启用成员打底，后者只填空键）。**不含任何成本/倍率/价格键**；演练场参数面板与「我的」页消费 |

批量语义：`changed` 是实际处理到的 id，`missing` 是不存在的 id（不报错、不中断），整批一次提交。

不变量（`api/src/l02_domain/validation.py` + 渲染器双重校验）：每个对外模型至少一个启用目标；
failover 目标 `priority` 为正整数（升序优先，同值=同层）；weighted 目标 `weight` 为正整数，
表示**相对比例**（不归一化）；权重链**按 IR 顺序**渲染、不按权重排序（W4）；封禁/冷却目标不渲染。

### 3.4 用户、余额、连接密钥（UI 名；后端 /admin/api-keys）
| 方法 | 路径 | 权限 | 说明 |
| --- | --- | --- | --- |
| GET/POST | /admin/users | users:read / users:create/update/delete | 用户列表/创建 {name, username?, password?, role?, parent_user_id?, balance_micro?} |
| GET | /admin/users/tree | users:read | 用户树（按可见范围）：{root_id, root_ids, total, nodes}；nodes 与 /admin/users 行同形并按树深度排序，root_ids 为父节点不在可见范围内的顶层节点（代理用户子树自成森林） |
| GET | /admin/users/{user_id} | users:read | 详情（余额、消费） |
| GET | /admin/users/{user_id}/balance/precheck | users:read | 余额前置检查 |
| POST | /admin/users/{user_id}/balance | users:update（充值/调整/退款） | 充值 {amount_micro, currency, note?} → {ledger_id, balance_after_micro} |
| POST | /admin/users/{user_id}/balance/adjust | users:update | 调整 {delta_micro, note?}（≠0） |
| POST | /admin/users/{user_id}/balance/refund | users:update | 退款 {amount_micro, note?} |
| GET | /admin/users/{user_id}/ledger | ledger:read | 账本流水 |
| PATCH | /admin/users/{user_id} | users:update | 改 name/role/status/parent_user_id（username 不可改，携带即 422）；挂到根下需管理权限 |
| PUT | /admin/users/{user_id}/password | users:update | 重置他人密码 {password}（管理员全域、代理仅子树）；重置即全端撤销会话；自助改密（验旧密码）在 POST /admin/auth/change-password |
| DELETE | /admin/users/{user_id} | users:delete | **软删除**（status=deleted，返回 `{id, status}`）；根用户与仍有直接下级的用户 409 CONFLICT，需先迁移/删除下级 |
| POST | /admin/users/{user_id}/api-keys | apikeys:write | 签发密钥，明文只返回一次 |
| GET | /admin/api-keys | apikeys:read | 路径基准（不是 /admin/client-keys）；行含 id/user_id/name/mask/key_suffix/status/last_used_at_ms/created_at_ms |
| PATCH | /admin/api-keys/{key_id} | apikeys:write | 改名 {name}（ADR-023 展示名，默认 密钥 N；仅控制面元数据，不触发下发） |
| DELETE | /admin/api-keys/{key_id} | apikeys:write | 直接删除密钥（204，ADR-023：不要求必须保留一把 active）并触发重下发 |
| PATCH | /admin/api-keys/{key_id}/status | apikeys:write | body {status: active\|disabled} |
| POST | /admin/api-keys/{key_id}/rotate | apikeys:write | 轮换，返回新明文一次 |
| POST | /admin/api-keys/{key_id}/reveal | apikeys:write | 解密回显（审计留痕） |

约束（ADR-019/023）：用户表已统一——username 唯一且不可改（缺省由 name 派生、冲突追加 `-2`），密码必填，
创建响应带 `initial_password`（12 位大小写+数字+符号随机，**仅此一次**，请求显式给 password 则用之）。
连接密钥一用户最多 50 把（任意状态合计，第 51 把 409 CONFLICT）；库里只存 sha256:<hex> +
AES-GCM 密文 + sk-...abcd 掩码。

### 3.5 可用性规则
| 方法 | 路径 | 权限 | 说明 |
| --- | --- | --- | --- |
| GET | /admin/availability-rules | availability:read | 列表（封禁 ban / 冷却 cooldown，含周期 schedule） |
| POST | /admin/availability-rules | availability:write | 创建；body `{kind, scope, scope_id, recurrence?, expires_at_ms?, schedule_json?, note?}` |
| PATCH | /admin/availability-rules/{rule_id} | availability:write | 部分更新；合并后整条重新校验，未知 id 返回 404 |
| DELETE | /admin/availability-rules/{rule_id} | availability:write | 删除规则；托管规则会同步清理行投影，成功 204 |

- 规则 API 是完整 CRUD：周期规则创建后仍可编辑/删除；删除周期规则不会误删模型行内的一次性冷却（反之亦然）。
- `scope` 接受 `upstream` / `upstream_model` / `public_model` / `model_target`；`scope_id` 必须指向存在的实体，否则 422 `VALIDATION_ERROR`。
- `recurrence` ∈ once / daily / weekly / monthly；一次性冷却必须给 `expires_at_ms`，
  周期冷却必须给 `schedule_json.windows[{start,end,days?,days_of_month?}]`（HH:MM，半开区间
  `[start,end)`，允许跨零点；跨零点时 weekly 的 `days` / monthly 的 `days_of_month` 按窗口开始日计算）。
- 模型行内的 `enabled` / `cooldown_until_ms` 仍是兼容接口：写入落到确定性的 `rule_row_<hash>`
  托管一次性规则，`cooldown_until_ms` 只是规则表的投影；读取以 `availability.state` 为准（ADR-004）。
- 模型行可用性视图（`availability` 对象，工单 G）为 `{state, cooldown_until_ms, window_skip_until_ms}`：
  `window_skip_until_ms` > 0 表示「启用」动作把周期规则的**当前窗口**跳过一次（一次性例外截止时刻，
  窗口期行可正常使用）；规则本身保留，下一窗口照常冷却。批量启用返回 `window_skipped:[{id, rule_ids,
  skip_until_ms, message}]`（无跳过则为空数组），单条启用 PATCH/POST 在行体顶层返回 `window_skip:
  {rule_ids, skip_until_ms, message}`（无跳过为 null）。解除冷却（cooldown_until_ms=0）会连带清除窗口例外。

渲染时封禁/冷却目标会被剔除（E3 实测：AG 健康状态不跨重启持久，所以必须控制面持久化并剔除）。

### 3.6 角色、权限矩阵与管理员账号
| 方法 | 路径 | 权限 | 说明 |
| --- | --- | --- | --- |
| GET | /admin/roles | roles:read | 内置角色 + 自定义角色，含 permissions / member_count / builtin |
| POST | /admin/roles | roles:write | {name, description, permissions, key?}；key 默认生成 |
| PATCH | /admin/roles/{role_id} | roles:write | 改 name/description/permissions；内置角色权限不可改 |
| DELETE | /admin/roles/{role_id} | roles:write | 内置角色或仍有成员的自定义角色 409 |
| GET | /admin/permissions | roles:read | {groups, keys}，前端权限矩阵的唯一数据源 |

- **/admin/admins 系列已移除（ADR-019）**：控制台账号不再是独立的 `admin_users` 表，统一落在 `users`
  行上（username 唯一不可改 + password_hash + role，见 §3.4）。创建/改角色/改密/停用管理员 =
  对 `/admin/users` 的常规用户操作（授予 admin 角色仅限管理用户；改密走 PUT password；禁用/软删语义同用户）。
  控制台访问 = 该 users 行有角色且有密码。
- 内置角色：`admin`（管理用户，全部 41 个权限）、`agent`（代理用户）、`user`（普通用户）。
  普通用户是可读主数据/治理/价目/用量报表 + `billing:spend` + `playground:use`；代理用户在此之上
  增加 `users:read/create/update` 与 `billing:subtree`。
- 自定义角色 key 必须匹配 `^[a-z][a-z0-9_]{2,31}$`，权限必须是注册表里的键；授权只认权限键，
  不认角色名，所以自定义角色与内置角色等价。
- 旧角色名只用于迁移：owner→admin、operator→agent、viewer→user；新数据不再写四档角色。

## 4. 报表、用量与计费

### 4.1 报表

报表六接口（ADR-022）一律 SQL GROUP BY 聚合，分位为 `ORDER BY <col> LIMIT 1 OFFSET k` 取位查询；
`gateway_usage_events.started_at_ms` 有索引。区间 = today/24h/7d/30d/365d（本地时区口径，
`tz` 参数可显式指定，缺省取运营设置）；`bucket=auto` 按 range 选 hour/day。
`error_count` 口径 = `http_status != 200` 的失败请求（billing.md §6）；`active_minutes` =
区间内出现过事件的去重分钟数（**含失败请求**；报表时区墙钟分钟）。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | /admin/reports/overview | requests, **error_count, active_minutes**, input_tokens, output_tokens, **cache_read_tokens, cache_write_tokens**, charge_micro, cost_micro, margin_micro, currency, fx_missing:[string], money_scope:"converted"\|"report_currency_only", latency_p50_ms, latency_p95_ms, ttft_p50_ms, latency:{paired_samples, min_samples, ttft:{samples, p50_ms, p75_ms, p95_ms, p99_ms}, total:{...}}, estimate_note。缓存两列（工单 H）为窗口内原始缓存词元合计，与 input_tokens 同过滤、不并入 input 折算口径；**金额与请求计数同窗口**（from_ms/to_ms 同时作用于事件与 cost/charge；省略=全时段）；currency 恒为报表币种；金额单位 micro；有外币缺汇率时该币种不计入总额并出现在 fx_missing；money_scope=converted 表示已按汇率折算，report_currency_only 表示存在 fx_missing、金额仅含本位币账本（margin 侧此时总额为 null） |
| GET | /admin/reports/trend?metric=&range=7d\|30d\|90d | {metric, range, points:[{day, metric, value}], estimate_note}；metric ∈ requests/input_tokens/output_tokens/cost_micro/charge_micro |
| GET | /admin/reports/latency?range=&tz= | {range, from_ms, to_ms, timezone, paired_samples, min_samples, ttft:{samples, p50_ms, p75_ms, p95_ms, p99_ms}, total:{...}, **all:{samples, ttft:{samples, p50_ms, p75_ms, p95_ms}, total:{samples, p50_ms, p75_ms, p95_ms}}**, estimate_note}（W4-F，2026-11-20）。**窗口规则：都缺省=全时段**（from_ms=0/to_ms=0、range 回显 "all"）；给任一则必须成对否则 422；显式 range 枚举保持原行为。`all` 块=**全样本分位**（不过滤配对，非流式请求 ttft=0 也计入，供日志页分位语义色）；`ttft`/`total` 两块仍为**配对样本**口径（ttft>0 且 duration>0）；各块独立套 MIN_PERCENTILE_SAMPLES（<5 全 null，只有 samples）。overview 端点内嵌的 latency 同样带 all 块 |
| GET | /admin/reports/timeseries?range=7d&bucket=auto&dimension=combo&metric=&metrics=&top_n=10&tz= | {range, bucket, dimension, metric, metrics:[...], from_ms, to_ms, timezone, currency, points:[{bucket_start_ms, label, total, values}], members:[{id, label, total, share, requests, tokens, cost_micro, charge_micro, totals?}], totals:{requests, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, tokens, cost_micro, charge_micro, error_count, active_minutes}, metric_total, folded_members, fx_missing, estimate_note}。dimension ∈ combo/upstream/channel（综合模型/上游模型/上游渠道）；**`metrics=cost_micro,charge_micro` 逗号多指标一次返回**：points[].values 变为 {member_id:{<metric>:value}}，members 增 `totals:{<metric>:total}`；单数 `metric` 向后兼容（values 为 {member_id:value} 平面结构）；top_n 1..50，超出排名的成员折叠为 `other:<dimension>`（label「其他（N）」） |
| GET | /admin/reports/heatmap?range=7d\|30d\|365d&metric=tokens\|cost\|spend&tz= | {range, mode:"weekday_hour"\|"date_hour", metric, from_ms, to_ms, timezone, currency, columns:[{key,label}×24], rows:[{key, label, values:[24]}], max, total, fx_missing, estimate_note}。7d=星期×小时，30d/365d=日期×小时 |
| GET | /admin/reports/flow | {nodes, links:[{source, target, charge_micro, cost_micro, requests}], estimate_note} |
| GET | /admin/reports/margin | {from_ms, to_ms（回显实际生效窗口；省略/<=0 = 全时段，to_ms 取 now+1ms）, report_currency, by_currency:{<cur>:{charge_micro, cost_micro, margin_micro, fx_rate_micro_to_report}}, report_currency_margin_micro, report_currency_charge_micro, report_currency_cost_micro, fx_missing:[string], estimate_note}。报表币种自身 fx_rate=1000000（无需快照）；外币缺汇率时总额为 null 且列出 fx_missing，补 PUT /admin/fx 后立即折算；失败请求的空币种行不计入任何桶 |

### 4.2 用量
| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | /admin/usage/events | 请求事件（分页），含 tokens/latency/status |
| GET | /admin/usage/events/{event_id} | 单条事件详情 |
| GET | /admin/usage/ledger | 账本分录（charge/topup/refund/adjust） |
| GET | /admin/usage/daily | 按日聚合（user_daily） |
| POST | /admin/usage/pull | 立即触发 AG SQLite → usage_events 增量拉取（运维按钮） |

### 4.3 价格与对账
| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET/POST | /admin/prices/upstream | 上游进价（vendor+model+item，版本自动 +1） |
| GET/POST | /admin/prices/charge | 对外计费价（mode=markup 万分比 12000=1.2x，或 fixed） |
| GET | /admin/prices/public-models | prices:read | **公开模型售价**（裸数组，只读派生）：按成员上游模型成本 × 倍率加权平均实时计算，不落库、不独立维护（ADR-017/GLOSSARY §5 口径）；成员价或权重变化后立即生效 |
| GET | /admin/prices/export | upstream_models:read | **价目 JSON 一键导出**（ADR-020，权威=模型行）：见下方「价目 JSON 导入/导出」 |
| POST | /admin/prices/import | upstream_models:write | **价目 JSON 整体导入**（ADR-020/023 dry-run，全部通过才落库）：见下方「价目 JSON 导入/导出」 |
| GET | /admin/unpriced | 缺价清单，`{cost:[...], charge:[...]}` 两个数组（demo 各 3 条） |
| POST | /admin/unpriced/recompute | 补价后重算：`{cost_entries, charge_entries, recomputed}` |
| GET | /admin/cost/entries | 上游成本分录（status: ok\|unpriced） |
| GET | /admin/charge/entries | 用户计费分录（status: ok\|unpriced\|free） |
| GET/PUT | /admin/fx | 汇率快照（USD→CNY，rate_micro） |

#### 价目 JSON 导入/导出（ADR-020）

数据源=**上游模型行**（`cost_input_per_1m` / `cost_output_per_1m` / `markup`，现行权威），两请求体同构。
**v1 不含缓存价**：缓存价仍走 `/admin/prices/upstream` 版本化端点维护，导出文件 `meta.cache_prices` 恒为
`"not_included_v1"`。金额为字符串（成本 6 位小数，倍率 4 位小数）；未配价导出为 `null`。无 `billing:cost`
权限的调用方，导出响应中成本/倍率键被中央过滤整体剔除（§0.5）。

**GET /admin/prices/export**（权限 `upstream_models:read`）：

```json
{
  "schema_version": 1,
  "exported_at_ms": 1731974400000,
  "meta": {"cache_prices": "not_included_v1"},
  "upstream_models": [
    {"id": "umdl_01", "name": "glm-5.3", "model_type": "chat",
     "cost_input_per_1m": "2.000000", "cost_output_per_1m": "8.000000", "markup": "1.2000"}
  ]
}
```

**POST /admin/prices/import**（权限 `upstream_models:write`）：

- 请求体与导出文件同构（`schema_version` 必须=1，`exported_at_ms`/`meta` 收下忽略；`upstream_models`
  必填非空数组；未知键 → 422）。
- 定位：每行**按 id 优先**匹配既有 upstream_model；无 id 才按 name，重名歧义即错（同名模型跨上游合法，
  请用导出文件里的 id）。id 存在但查不到 → 未知模型错误，**不会回退按 name 匹配**。
- 校验（与单行编辑同界）：cost ≥ 0（未配价行为 `null`）；markup ∈ (0,100]（复用 `validate_markup`）。
  **空白字段（缺省 / `null` / `""`）= 不动该项**（与前端批量改价「留空」语义一致）；清除某字段定价请走
  模型行 PATCH（显式 null=清为未配价）。
- **整体事务（dry-run 原则 ADR-023）**：未知模型 / 数值越界 / 同批重复条目 → 422
  `VALIDATION_ERROR`，`details.errors` 逐行列明（`{index, id, name, message}`），**零落库**；
  全部通过才逐条 UPDATE 模型行价格字段（`enabled`/`cooldown`/`model_type` 等非价格字段永不改动，
  行内出现未知键直接 422）。
- 成功响应：`{"changed": 1, "missing": [], "skipped": 0}`（changed=实际更新的行数；skipped=只有定位无
  价格字段的行数；missing 恒为空数组——未知模型已在校验阶段整批拒绝）。

```json
// 请求（部分字段缺失=不动）
{"schema_version": 1, "upstream_models": [
  {"id": "umdl_01", "cost_input_per_1m": "2.500000", "markup": "1.5000"},
  {"name": "glm-5.3-flash", "cost_output_per_1m": "1.200000"}
]}
// 失败响应（422，零落库）
{"code": "VALIDATION_ERROR", "message": "价目导入校验失败，全部未生效（2 行有误）",
 "details": {"errors": [
   {"index": 1, "id": null, "name": "glm-4.6", "message": "未知上游模型: glm-4.6"},
   {"index": 2, "id": "umdl_03", "name": null, "message": "markup 不能超过 100"}
 ]}, "request_id": "9f2c..."}
```

### 4.4 日志
| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | /admin/logs?query=&from_ms=&to_ms=&page_size=&offset=&sort=&order=&has_error= | 请求日志检索 → {total, items, next_offset}；query 支持 `model:x` / `upstream:x` / `user:x` / `key:x` / `status:200`（三位码）/ `status:4xx\|5xx\|2xx…`（区间）/ `latency>ms` / `latency<ms` / `ttft>ms` / `cache>pct` / `stream:true\|false` + 关键词；`user:` 匹配 **user_id 或用户名**（`key:` 已含 user_id），坏 token 一律 422；sort ∈ started_at（默认）/duration_ms/**total_tokens**/cost_micro/charge_micro（按钱排序需对应金额权限），order ∈ asc/desc（默认 desc），has_error=bool 过滤失败请求 |
| GET | /admin/logs/{event_id}?include_payload= | 单条详情（payload 开关，正文经金额脱敏）；出参带 `trace_id`（AG 启用 tracing 后填充，M5-a） |
| GET | /admin/logs/{event_id}/payload | ADR-021 正文读取：设置键 `ag_access_log_llm=full` 时 AG 把 prompt/补全正文落到 `request_log_payloads`，本端点只读取回（AG SQLite 只读连接 + schema 校验）；无该行或正文未存档 → 404；响应过 §0.5 金额脱敏 |
| GET | /admin/traces/{trace_id} | 权限 `logs:read`。M5-a 路由链：`{trace_id, spans:[{trace_id, span_id, parent_span_id, kind: server\|client, http_path, http_status, error_type, retry_attempt, start_ms, end_ms, duration_ms, attributes}], attempts:[{attempt, span_id, http_path, http_status, error_type, duration_ms, start_ms}]}`。spans 按 `(start_ms, span_id)` 升序；attempts 由 client span 按开始时间复原（序号从 1 起，E19：AG 无显式尝试序号）。无 span → 404 `NOT_FOUND`（前端按无链路数据处理）。数据来源：控制面常驻 OTLP/HTTP 接收器（默认 `127.0.0.1:4318`，`POST /v1/traces`，body ≤8MB，无会话鉴权仅本机监听），AG 渲染 `frontendPolicies.tracing` 后导出；`request_logs.trace_id` 是 join 键 |

列表/详情共用的行字段（**主键名是 `event_id`，不是 `id`**）：

| 字段 | 说明 |
|---|---|
| event_id / started_at_ms / completed_at_ms | 标识与时间（completed_at_ms 由 AG 延迟字段随采集落库） |
| trace_id | AG 启用 `frontendPolicies.tracing` 后的 OTel trace id（请求日志→`/admin/traces/{trace_id}` 的 join 键）；历史日志或未启用时为空串 |
| duration_ms / time_to_first_token_ms | 总耗时与首字延迟（AG 三延迟字段，ingest 时写入） |
| http_status / public_model / upstream_model / provider | 请求与路由 |
| upstream_model_id / target_priority | 上游模型行 id 与成员优先级 |
| user_id / user_name / api_key_id / api_key_label | 身份（密钥为掩码 `sk-…后缀`；密钥已删时为空串） |
| input_tokens / output_tokens / total_tokens / cache_read_tokens / cache_write_tokens | 词元五列（缓存列原始值，未并入输入） |
| cache_ratio | 缓存命中率（%，containment 口径：cached ≤ input 时分母=input） |
| throughput_tps / is_stream | 输出速度与是否流式（流式=显式标志或 ttft>0；吞吐仅流式且有生成窗口时给值） |
| has_error / has_payload / error | 失败标记 / 正文存档标记 / 错误文本 |
| cost_micro / margin_micro / charge_micro / currency | 三账金额 + 币种（受 §0.5 字段级权限约束，缺权限键缺失） |
| estimate | true：token 数为估算口径（cache 折叠进 input，stage B 待核） |

### 4.5 配置下发
| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | /admin/config/status | config:read | 数据面当前 hash/listening/detail + active_revision |
| POST | /admin/config/apply | body {reason?}：拼 IR → IR 自校验 → `adapter.validate(ir)` → 写密钥文件 → 渲染 → 原子写 + AG 热加载 + 读回确认；校验阶段失败不会写出任何密钥文件或配置，版本归档 status=failed，错误码 APPLY_FAILED（见 0.2） |
| POST | /admin/config/rollback/{revision_id} | 回滚到指定版本：先 `adapter.rollback(rev_id)`，驱动无历史（重启）则用归档 artifact 走 `apply` 重放；失败归档 status=failed 且旧 active 继续服务，返回 APPLY_FAILED + details.message（见 adapter-spi §4.2） |
| GET | /admin/config/revisions | 版本历史（点号路径，不是 /admin/config-revisions） |
| GET | /admin/config/revisions/latest | 最新一条（见 2.5） |

`POST /admin/config/apply` 与 `rollback` 统一走 `l05_service.rollout.Rollout`（唯一 apply/rollback/status/history 入口）；
`operator` 取当前 principal，失败策略由调用方显式选择（`raise` 或 `keep-booked`）。响应模型 `ConfigRevisionOut.status`
是 OpenAPI 枚举 `RevisionStatus`（`active | superseded | failed`），前端不再手写第三套词表。

### 4.6 Playground
| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | /admin/playground/stream | SSE 透传数据面（AG llm 3600），text/event-stream；非 2xx 时按错误信封返回 JSON |

### 4.7 用户花费与逐请求台账（ticket 16/17）
| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | /admin/bills/my-spend?range=30d&scope=self\|subtree&user_id=&tz= | billing:spend（subtree 另需 billing:subtree，普通用户 403）。返回 {range, bucket, timezone, from_ms, to_ms, scope, all_users, user:{id,name,role}\|null, summary:{charges/costs/margins per currency + report_currency 汇总}, series:[{start_ms,label,...}], by_user:[...], by_model:[...]}——登录者本人节点或可见子树的花费/成本/毛利聚合；`user_id` 用于子树页切换分支（须可见）。比值/占比由前端计算 |
| GET | /admin/billing/ledger?page_size=&offset= | ledger:read。**逐请求金额台账**（裸数组）：每条用量事件的 cost（成本账）/ charge（花费账）/ margin = charge - cost / markup = charge÷cost（cost 为 0 或未配价时 null）；按 created_at_ms 降序；金额字段过 §0.5 字段级过滤，无 billing:cost 时 cost/margin 键缺失 |

## 5. 前端旧路径 → 契约基准（t7 修复清单）

| 前端旧调用 | 契约基准 | 处理 |
| --- | --- | --- |
| GET /admin/client-keys | GET /admin/api-keys | 改路径 |
| GET /admin/billing/requests | GET /admin/usage/events（请求视角）或 GET /admin/cost/entries（成本视角） | 按页面语义选一个 |
| GET /admin/billing/revenue | GET /admin/reports/trend?metric=charge_micro + GET /admin/charge/entries | 营收页改报表接口 |
| GET /admin/config-revisions | GET /admin/config/revisions | 改点号路径 |
| GET /admin/audit-logs | 本文 2.4 | 已补齐 |
| GET /admin/settings | 本文 2.1 | 已补齐 |
| GET /admin/settings/schema | 本文 2.2 | 已补齐 |
| GET /admin/overview | 本文 1（= reports/overview） | 已补齐 |
| GET /admin/config/revisions/latest | 本文 2.5 | 已补齐 |

## 6. 演示数据（seed）

```bash
cd slipstream/api
PYTHONPATH=src python scripts/seed_demo.py        # 重置库 + 写入 7 天演示数据（可重复执行、幂等）
PYTHONPATH=src python scripts/seed_demo.py --keep # 仅用于空 schema；已有数据会拒绝执行
PYTHONPATH=src python -m uvicorn l06_api.app:create_app --factory --port 3700
```

seed 覆盖（连续跑两次后的真实计数，幂等）：3 厂商 / 6 上游（zai-01..03、nebula-01、local-01/02）/
20 上游模型（19 个带成本 cost_input/output_per_1m + 1.2 倍率 markup，1 个故意未定价；6 条上游密钥）/
8 公开模型（6 failover + 2 weighted）/ 16 目标 / 6 用户（根用户 D + 两层代理树，5 把 sk-+64 大写客户端密钥 + 充值流水）/
13 个模型进价 + 8 个计费价 / 7 天 252 条用量事件（cost 与 charge 各 3 条缺价 unpriced）/ 245 条计费流水 /
2 条配置版本（operator 张三 superseed / 李四 active）/ 68 条审计 / 12 条 app_settings /
2 条可用性规则（ban + cooldown，无排期窗口）/ **3 个管理员**：admin（张三，管理用户 `admin`）、lisi（李四，代理用户 `agent`）、
wangwu（王五，普通用户 `user`）。默认密码 admin12345，可用 `SLIPSTREAM_DEMO_ADMIN_PASSWORD` 覆盖，
首次登录后修改。

settings 六个可编辑键均已有值：base_currency=CNY、timezone=Asia/Shanghai、
log_retention_days=30、audit_retention_days=180、default_tokens_per_minute=60000、default_concurrency=8。
另有策略/护栏/MCP 三份可编辑样例（policy_config / guardrail_config / mcp_config）与
`priority_semantics=v2` 标记；旧库升级用 `PYTHONPATH=src python scripts/migrate_priority_v2.py`
（先 dry-run，再 `--apply`；已有 v2 标记时是 no-op）。

自检：`python ops/checks/smoke_api.py`（需先起 3700 并已 seed）。当前基线实测 **40/40 通过**
（含登录、未认证 401、伪造头、限流、logout；smoke 脚本共 30 个 check 调用点，其中两个循环展开后
总数为 40）。

## 7. 跨域（CORS）

默认是**单端口同源部署**：`cd web && npm run build` 的产物由控制面在 `http://localhost:3700` 直接托管
（SPA 深链回退 index.html；`/admin`、`/api`、`/openapi.json`、`/docs` 仍走 JSON/文档，不会被回退成 HTML）。
前端 `API_BASE` 默认空串（相对路径），因此不触发 CORS。

仅当单独起 Vite dev（5173，HMR）或前后端分离时才需要 CORS：默认白名单 `http://localhost:5173`、
`http://127.0.0.1:5173`，可用环境变量 `SLIPSTREAM_CORS_ORIGINS`（逗号分隔）追加。

会话 cookie 是 `HttpOnly + SameSite=Lax`，浏览器只会把它随**同站点**请求发送。单端口部署天然同源；
分离部署时管理台与 API 必须使用同一主机名（端口可不同），统一用 `localhost`，不要混用
`localhost` 与 `127.0.0.1`，否则登录后下一次请求就不带 cookie，会立刻被打回登录页。跨站部署需
HTTPS + `SameSite=None; Secure`，本 ticket 不启用。

## 8. 附录：逐接口 curl + 真实响应（2026-11-17 03:2x 对 3700 实测）

所有示例共用：

```bash
B=http://127.0.0.1:3700/admin
J=.slipstream-cookies.txt
curl -s -c "$J" -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"admin12345"}' $B/auth/login
```

除登录/健康检查外，后续请求都带上会话 cookie（`-b "$J"`）。

### 8.1 裸数组类

```bash
curl -s -b "$J" $B/public-models | head -c 400
```
```json
[{"id":"pmdl2b8568b4cad44dcb9cfd8e269526c69a","name":"glm-5.3","routing_mode":"failover",
  "note":"旗舰对话模型，三层降级","enabled":true,"created_at_ms":1794875743970,
  "targets":[{"target_upstream_model_id":"umdlf8166bfcd98a4dcaaee3c1521170d2ac","priority":1,"weight":0,"conditions":""}]}]
```

```bash
curl -s -b "$J" $B/upstream-models | head -c 300
```
```json
[{"id":"umdlf8166bfcd98a4dcaaee3c1521170d2ac","upstream_id":"upse0e2183aa0f9491c9aea8f42d25b30b4",
  "name":"glm-5.3","model_type":"chat","enabled":true,"created_at_ms":1794875743938,
  "upstream_name":"zai-01","vendor_name":"智谱 AI"}]
```

```bash
curl -s -b "$J" $B/api-keys | head -c 250
```
```json
[{"id":"key5cc268df0bfc449e90c43512f97f590c","user_id":"useraae59a05152f401a8b495848a6747cdc",
  "mask":"sk-...3CAM","key_suffix":"3CAM","status":"active","created_at_ms":1794875744037}]
```

```bash
curl -s -b "$J" $B/config/revisions | head -c 300
```
```json
[{"id":"revdde11c6c2dac411cb3d9f0ebb123b8c9","artifact_hash":"16258127...",
  "adapter_id":"agentgateway","operator":"李四","reason":"新增 qwen-max 权重路由与冷却规则",
  "status":"active","previous_revision_id":"rev0afed7d6ad4d486f9c2e4b4f67fd59c0","created_at_ms":1794832543844},
 {"id":"rev0afed7d6ad4d486f9c2e4b4f67fd59c0","operator":"张三","status":"superseded"}]
```

```bash
curl -s -b "$J" $B/cost/entries | head -c 260
```
```json
[{"id":"costea54fabaf41e42a49745f94d93880156","gateway_event_id":"seed_evt_6_000",
  "vendor_id":"vend0654501d1c30424089c94fffc26567f8","upstream_model_id":"umdl2ab50a3a654f4810ac5c84390846b87a",
  "input_tokens":3037,"output_tokens":218,"amount_micro":3127,"currency":"CNY",
  "price_version_id":"uprdbe3b2bbae19400ea254bcfe9c60920d","status":"ok"}]
```

```bash
curl -s -b "$J" $B/charge/entries | head -c 260
```
```json
[{"id":"chge1e68d98c2004e0f80eaf0ee34e3637e","gateway_event_id":"seed_evt_6_000",
  "user_id":"user6201055a3b49479d9dd2b27cc250a966","public_model_id":"pmdl2b8568b4cad44dcb9cfd8e269526c69a",
  "input_tokens":3037,"output_tokens":218,"amount_micro":3753,"currency":"CNY",
  "price_version_id":"cpr7f1abcbb4ed44c84b51531eef8e17c6a","status":"ok"}]
```

```bash
curl -s -b "$J" $B/admins   # 已移除（ADR-019）：控制台账号并入 /admin/users，见 §3.6
```

### 8.2 自定义对象类

```bash
curl -s -b "$J" $B/unpriced | head -c 300
```
```json
{"cost":[{"id":"cost900afc2f211e44b9bf255d85f777750a","gateway_event_id":"seed_evt_6_015",
  "upstream_model_id":"umdl5391fabf13a3419d9f8d1a85196abb63","input_tokens":3219,
  "output_tokens":1332,"created_at_ms":1794411434000}],
 "charge":[{"id":"chg...","gateway_event_id":"seed_evt_6_015","public_model_id":"pmdl...","input_tokens":3219,"output_tokens":1332,"created_at_ms":1794411434000}]}
```

```bash
curl -s -b "$J" $B/reports/overview
```
```json
{"requests":252,"input_tokens":429710,"output_tokens":174779,"charge_micro":1667295,
 "cost_micro":1389420,"margin_micro":277875,"currency":"CNY","latency_p50_ms":3144,
 "latency_p95_ms":4912,"ttft_p50_ms":796,"estimate_note":"token amounts fold cache into input (stage B pending)"}
```

```bash
curl -s -b "$J" "$B/reports/trend?metric=requests&range=7d"
```
```json
{"metric":"requests","range":"7d","points":[{"day":"2026-11-11","metric":"requests","value":40},
 {"day":"2026-11-12","metric":"requests","value":36},{"day":"2026-11-13","metric":"requests","value":35},
 {"day":"2026-11-14","metric":"requests","value":37},{"day":"2026-11-15","metric":"requests","value":33}],
 "estimate_note":"..."}
```

```bash
curl -s -b "$J" $B/settings
```
```json
{"items":[{"key":"base_currency","value":"CNY","label":"基准币","updated_at":"2026-11-17T00:35:43.844Z"},
 {"key":"timezone","value":"Asia/Shanghai","label":"展示时区","updated_at":"2026-11-17T00:35:43.844Z"},
 {"key":"log_retention_days","value":"30","label":"请求日志保留天数","updated_at":"..."},
 {"key":"audit_retention_days","value":"180","label":"审计日志保留天数","updated_at":"..."},
 {"key":"default_tokens_per_minute","value":"60000","label":"默认 Token 限速（每密钥）","updated_at":"..."},
 {"key":"default_concurrency","value":"8","label":"默认并发上限（每密钥）","updated_at":"..."}]}
```

```bash
curl -s -b "$J" $B/audit-logs?limit=2
```
```json
{"items":[{"id":"aud...","actor":"李四","action":"apply_config","target":"config_revision","detail":"{...}","created_at":"2026-11-17T03:10:00+00:00"}],"total":69,"next_offset":2}
```

```bash
curl -s -b "$J" "$B/logs?page_size=25&has_error=false&sort=duration_ms&order=desc"
```
```json
{"total":252,"items":[{"event_id":"seed_evt_6_000","started_at_ms":1794408340000,"completed_at_ms":1794408343184,"duration_ms":3184,"time_to_first_token_ms":812,"public_model":"glm-5.3","upstream_model":"glm-5.3","http_status":200,"user_name":"user6201055…","api_key_label":"sk-…","input_tokens":3037,"output_tokens":218,"total_tokens":3255,"cache_read_tokens":0,"cache_write_tokens":0,"cache_ratio":null,"throughput_tps":null,"is_stream":true,"has_error":false,"cost_micro":3127,"charge_micro":3753,"margin_micro":626,"currency":"CNY","estimate":true}],"next_offset":2}
```

> 说明：8.2 中 unpriced.charge / logs 的条数与字段以服务端实测为准；若与本文不一致，
> 以实测为准并回写本文（契约唯一来源是本文件）。
