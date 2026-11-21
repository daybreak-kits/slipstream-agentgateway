# IR 与渲染契约（IR v2 → agentgateway 1.7）

IR 定义在 `api/src/l02_domain/ir.py`，**不含任何网关专有名词**。适配层
`api/src/l03_adapters/agentgateway/` 负责把 IR 翻译成 agentgateway 1.7 配置。

v2 的依据是**钉住的 1.7 二进制实测**（`--validate-only`），不是 schema 猜读。
凡 1.7 表达不了的字段，渲染层抛 `ValueError`、`adapter.validate` 返回 error，
**绝不静默丢弃**；能力矩阵见 §4。

## 1. IR 形状

```python
@dataclass(frozen=True, slots=True)
class GatewayIR:
    revision: str
    upstreams: tuple[UpstreamSpec, ...]
    models: tuple[UpstreamModelSpec, ...]        # 渲染为 llm.models[]，默认 internal
    public_models: tuple[PublicModelSpec, ...]   # 渲染为 llm.virtualModels[]
    api_keys: tuple[ClientKeySpec, ...]          # 只放 hash
    users: tuple[UserBalanceSpec, ...] = ()      # 控制面账本，不渲染成桶
    limits: LimitsSpec | None = None
    policies: PoliciesSpec = field(default_factory=PoliciesSpec)
    guardrails: GuardrailsSpec = field(default_factory=GuardrailsSpec)  # 能力矩阵
    mcp: McpSpec = field(default_factory=McpSpec)                       # 顶层 mcp
    model_aliases: tuple[ModelAliasSpec, ...] = ()                      # 1.7 无配置面
```

关键字段（完整定义以 `ir.py` 为准）：

```python
class UpstreamSpec:
    # ADR-026 多密钥平权（E18 形态）：build_render_plan 把每把 upstream_keys 行
    # 展开为一个 IR 上游——id={upstream_id}#{seq}、key_file={upstream_id}#{seq}
    # （中性凭据 ref，与 CredentialFile.ref 同值；磁盘路径 keys/<ref>.key 由适配器
    # 自管并经 materialize_credentials 物化，W6 ticket 03/06）；
    # 上游模型条目为 {model_id}#k{seq} 并逐条进 virtualModel 同层 targets。
    # E20 例外：conditional 公开模型的 targets 不展开密钥维度，每个 target 只
    # 引用第一把密钥（{model}#k1）——AG conditional targets first-match 首条独占。
    id; base_url; api_style        # openai_chat / openai_responses / anthropic_messages / gemini
    key_file                       # 中性凭据 ref（{upstream_id}#{seq}），绝不内联明文；磁盘格式归适配器
    transforms: TransformsSpec | None
    max_buffer_bytes: int = 2097152  # 1.7 无配置面：非默认值只 warning
    extra_headers: tuple[tuple[str, str], ...] = ()

class UpstreamModelSpec:
    id; upstream_id; upstream_model_name; model_type
    display_name: str = ""
    visibility: str = "internal"   # public / internal（VISIBILITIES）
    guardrails: PromptGuardSpec | None
    prompt_caching: PromptCachingSpec | None
    aliases: tuple[str, ...] = ()

class TargetSpec:
    id; upstream_model_id
    priority: int                  # failover：>= 0，越小越先；同值成组
    display_name: str = ""
    weight: int = 0                # 仅 weighted 使用，>= 1
    when: str = ""                 # conditional：CEL，只有末位一条可省（E20：至多 1 条且必须末位）

class PublicModelSpec:
    name; targets; routing_mode = "failover"   # failover / weighted / conditional

class PoliciesSpec:
    cors; api_key; local_rate_limit; transforms_defaults; routing_modes
    data_plane_cors: CorsPolicySpec | None = None       # 显式设置才渲染 llm.policies.cors
    global_transformations: TransformsSpec | None = None
    guardrails: PromptGuardSpec | None = None
    timeout: TimeoutPolicySpec | None = None            # 1.7 humantime 字符串
    retry: RetryPolicySpec | None = None                # 可表达，但 1.7 拒绝 -> error
    remote_rate_limit: RemoteRateLimitPolicySpec | None = None  # 无安全面 -> error
```

- `PoliciesSpec.cors` 是**控制面管理 API** 的浏览器 CORS，不进数据面；
  数据面必须显式设 `data_plane_cors`。
- `GuardrailsSpec`（`items[]` 的 key/supported/since_version/note/verified）是
  **能力矩阵**，不是配置；真正的护栏在 `policies.guardrails` 与
  `models[].guardrails`。
- `McpSpec`：`targets` / `policies` / `port` / `supported` / `note`；
  只有 `supported=True` 时才允许携带 targets/policies。

## 2. priority 语义与迁移

采用 agentgateway 官方语义：**数值小优先**。

- 同 priority 的目标是一组；组间按 priority 升序尝试；同组内由数据面 P2C
  （健康 + 延迟）选一个，整组降级才下移（ADR-003/ADR-012）。
- failover 渲染前做 `sort_targets()`（稳定排序），同 priority 保持 builder
  顺序，渲染顺序可复现。
- 控制面校验：priority 必须是**整数且 >= 0**；`True/False`、负数、小数都拒绝。
  AG 的 `--validate-only` 会放行 0，所以 `>= 0` 由控制面自己保证（E8）。
- **旧数据迁移方向唯一**：旧系统「数值大优先」的 N 迁移为
  `maxPriority - N`（`ir.legacy_priority_to_v2(priority, max_priority)`）。
  迁移后 0 表示最高优先级。
- 只有 weighted 使用 `weight`；failover/conditional 输出不包含 weight 字段。
  非 weighted 上的 weight 只产生 warning，是给 05/10 预留字段，不参与渲染。
- conditional 的 `when` 只有**末位一条**目标可省略（**至多 1 条**），其余必须给 CEL 谓词。
  （E20 收紧，P0-RESULTS §E20：AG 1.7 把该约束实现为硬校验，拒收原文
  `conditional fallback target must be last`；旧不变量「无 when 条目必须是连续末段」
  比 AG 真实约束宽——多密钥兜底展开成 N 条末段会被 AG validate 拒收（T1-mixed-kn2）——
  故收回为「至多 1 条且必须末位」。AG 按序求值，无 when 条目之后再出现带 when
  条目则后者永不可达。）
- conditional × 多密钥：**密钥平权不生效（E20）**。AG 对 conditional targets 按
  first-match 求值——同 when 的多条 `#kN` 条目 validate 合法但运行时首条独占
  （T2：40:0，无告警），N-1 把密钥静默 0 流量；when + retry/health 三件套下
  也无请求内切换（T4：重试全打同一首条）。因此渲染层 conditional 模式**不展开
  密钥维度**（每个 target 只渲染第一把密钥的一条，渲染时打 warning），要密钥级
  平权/容错只有 failover/weighted 模式（E18 已证）。
- failover 只影响**后续请求**的选路，不做请求内重试（E1）。

## 3. 映射表

| IR | agentgateway 1.7 配置 | 说明 |
|---|---|---|
| `UpstreamSpec` | `llm.providers[]` | **数组**，每项 `{name, provider, params}`；`provider` 由 `api_style` 映射，未映射直接 `ValueError`。ADR-026：每把密钥一行（name=`{upstream_id}#{seq}`，各自中性凭据 ref，适配器渲染为自家管理的 `keys/<ref>.key`），`llm.models[]` 禁同名由渲染层自检（E18：validate 静默塌缩，违反即 `ValueError`） |
| `extra_headers` | `providers[].defaults.requestHeaders.set` | 1.7 的 provider 没有 `params.headers` |
| `max_buffer_bytes` | 不输出 | 1.7 无该字段；非默认值在 validate 里 warning，不伪造 |
| `UpstreamModelSpec` | `llm.models[]` | **数组**，`name=model.id`、`provider.reference=upstream_id`、`params.model=upstream_model_name`、`visibility`（默认 internal）。多密钥时 builder 产出 `{model_id}#k{seq}` 条目，公开模型 targets 逐条同层引用（E18 裁决形态）；**conditional 公开模型例外**——targets 每目标只引用第一把 `{model}#k1`（E20） |
| `display_name` | ❌ 显式错误 | 1.7 的 `llm.models[]` 没有 `displayName`（validate: unknown field） |
| `aliases` / `model_aliases` | ❌ 显式错误 | 1.7 没有 modelAliases 配置面；对外名只能走 virtualModels |
| `model.guardrails` | `llm.models[].guardrails` | PromptGuard：streaming + request/response regex 规则 |
| `model.prompt_caching` | `llm.models[].promptCaching` | 只输出 1.7 认的 `cacheSystem/cacheMessages/cacheTools/minTokens/cacheMessageOffset` |
| `upstream.transforms.request_*` | `llm.models[].requestTransformation` | CEL 编译；map 字面量 `.merge({...})` |
| `upstream.transforms.response_headers` | `llm.models[].responseHeaders` | 用户规则之后追加 ADR-010 的 `server`、`x-powered-by` delete |
| `upstream` 的 conditional / response_body | ❌ 显式错误 | 1.7 的 model 级变换没有 conditional，也没有响应体面；请移到全局策略 |
| `PublicModelSpec` | `llm.virtualModels[]` | `name` + 单一 `routing` |
| failover `TargetSpec` | `routing.failover.targets[]` | `priority` 升序、稳定；同值成组 |
| weighted `TargetSpec` | `routing.weighted.targets[]` | 按 IR 原序输出，`weight` 整数相对比例 |
| conditional `TargetSpec` | `routing.conditional.targets[]` | `when` 按序求值（first-match，首条独占）；无 when 兜底至多 1 条且必须末位（AG 硬校验 `conditional fallback target must be last`，E20）；多密钥上游只渲染第一把（E20 密钥平权不生效） |
| `ClientKeySpec` | `llm.policies.apiKey` | `mode: strict`（默认）+ `keys[].keyHash` 原样 `sha256:<hex>`，metadata 带 name/key_id/user_id；disabled 不下发 |
| `UserBalanceSpec` | 不输出 | 1.7 每条限流规则只有一个 maxTokens，无法逐用户设桶（E12）；控制面账本为权威 |
| `LimitsSpec` | `llm.policies.localRateLimit[]` | **数组**；rpm `type: requests`、tpm `type: tokens`，`fillInterval: 1m`，key `apiKey.metadata.user_id`；`budget_usd` 只 warning（无 database 时 AG 拒 apiKey budgets） |
| `policies.data_plane_cors` | `llm.policies.cors` | `maxAge` 必须是**时长字符串**（如 `600s`） |
| `policies.timeout` | `llm.policies.timeout` | requestTimeout / backendRequestTimeout / responseIdleTimeout，humantime |
| `policies.guardrails` | `llm.policies.guardrails` | 与 model 级同构的 PromptGuard |
| `policies.global_transformations` | `llm.policies.transformations` | 1.7 是 untagged enum：普通 request/response 与 conditional **二选一** |
| `policies.retry` | ❌ 显式错误 | 1.7 二进制报 `unknown field 'retry'`；schema 有、二进制没有 |
| `policies.remote_rate_limit` | ❌ 显式错误 | 无安全可用的 1.7 配置面 |
| `mcp.targets` / `mcp.policies` | 顶层 `mcp`（**不在 llm 内**） | 只有 `supported=True` 才渲染；`sse/http` 传 input 用 `host`（sse），`port` 与 `path` 必须成对 |

### 3.1 渲染流程

`build_render_plan()`（`l05_service/rendering.py`）组装 IR → `adapter.validate()`
（纯函数，先于任何写文件）→ 写密钥文件 → `render_artifact()` →
`adapter.apply()`（原子替换 + 读回，失败回滚）。v2 的 apply/validate/rollback
流程由 ticket 08 收口，本 ticket 只保证渲染产物合法且现有 apply 路径不破。

## 4. 能力矩阵：支持的必须验证，不支持必须显式报错

| 能力 | 1.7 | 本适配器行为 |
|---|---|---|
| `llm.providers[]` 数组 | ✅ | 渲染 + `--validate-only` 验证 |
| `llm.models[]` internal | ✅ | 默认 internal，直连上游名 404（E4） |
| failover / weighted / conditional | ✅ | 三种 routing 各自渲染 |
| model/router guardrails | ✅ | `llm.models[].guardrails` / `llm.policies.guardrails` |
| `promptCaching` | ✅ 子集 | 只输出 1.7 字段；`enabled` 不是合法字段，不输出 |
| `apiKey.keyHash` + strict | ✅ | 只下发 hash，明文永不进配置 |
| `localRateLimit` 全局规则 | ✅ | 数组；rpm/tpm；每规则一个 maxTokens |
| `cors` / `timeout` | ✅ | 安全子集；maxAge 用时长字符串 |
| 顶层 `mcp.targets[]` / `mcp.policies` | ✅ 仅解析验证 | 声明 supported 才渲染；运行期未验证，见 §7 |
| `displayName` | ❌ | `ValueError` |
| `modelAliases` | ❌ | `ValueError` |
| `maxBufferSize` | ❌ | 不输出；非默认值 warning |
| `policies.retry` | ❌ | `ValueError`（含 `'retry'`），测试用真实二进制证明 |
| `remoteRateLimit` | ❌ | `ValueError` |
| 逐用户预付余额桶 | ❌ | 不伪造 bucket；账本控制，注释说明 `resets on restart` |
| model 级 conditional / response_body | ❌ | `ValueError`；全局策略可承载 conditional |
| 全局 transformations 混用普通 + conditional | ❌ | `ValueError`（1.7 untagged enum 拒绝） |

渲染器的错误是 `ValueError`；`adapter.validate()` 在写文件前把同一批问题变成
`ValidationResult.errors`，所以 apply 不会先写后炸。

## 5. 渲染不变量

1. 没有目标的 public model 不渲染（对外下架）。
2. failover 的 priority 必须是 **>= 0 的整数**；同值成组，稳定升序。
3. 每种 routing_mode 只输出自己的字段；weight 只在 weighted 出现；
   conditional 只有末位一条可省 `when`（至多 1 条，E20 收紧）。
4. weighted 的 weight 必须是 >= 1 的整数；不归一化，不按 weight 排序（W4）。
5. public model 名、target id 全局唯一；target 必须指向存在的 model，
   model 必须指向存在的 upstream（校验错误，不是 warning）。
6. 封禁/冷却中的目标由 `build_render_plan` 排除，不进配置。
7. 上游模型 `visibility` 默认 `internal`；客户端只能通过 virtualModels 名字寻址。
8. 不内联密钥：上游密钥写文件（配置只出现路径）；客户端只出现 `keyHash`。
9. ADR-010 默认动作只剩两条响应头 delete（`server`、`x-powered-by`），
   追加在用户规则之后，落在每个 model 的 `responseHeaders`；不注入
   `response.code` 条件，不限制 body 路径。
10. 渲染是确定性的：无时间戳，排序稳定，同一 IR 同一端口字节相同
    （`revision` 是唯一变量）。

## 6. 渲染示例

完整样例见 `api/tests/contract/fixtures/ag_1_7_full_config.yaml`（黄金契约，
由 `test_ag_render_golden.py` 精确比对，并由 `test_ag_validate.py` 交给真实
1.7 二进制 `--validate-only`）。**ADR-024 混合形态**：模型路由与
failover/weighted/conditional 仍留在 `llm.models`/`llm.virtualModels`，网关面
迁到 `gateways` + `llm.gateways`，请求内 retry 以顶层 `policies[]` 挂内部路由
`internal/llm:request`（纯完整形态读不到 body model、会塌缩到同一后端，已推翻）。
核心形状：

```yaml
gateways:
  default:
    port: 3600
llm:
  gateways: default
  providers:
    - name: ups_a
      provider: openai
      params:
        baseUrl: "https://api.example.com/v1"
        apiKey:
          file: keys/ups_a.key
      defaults:
        requestHeaders:
          set:
            x-team: slipstream
  models:
    - name: umdl_a
      provider:
        reference: ups_a
      visibility: internal
      params:
        model: "glm-5.3"
      tls:
        hostname: api.example.com
      health:
        unhealthyExpression: "response.code >= 400"
        eviction:
          consecutiveFailures: 1
      requestTransformation:
        set:
          x-trace: "slipstream"
        body: "toJson(json(request.body).with(b, b.merge({\"temperature\": ...})))"
      responseHeaders:
        remove: ["x-internal-debug", "server", "x-powered-by"]
  virtualModels:
    - name: flagship
      routing:
        failover:
          targets:
            - model: umdl_b
              priority: 0
            - model: umdl_a
              priority: 10
  policies:
    apiKey:
      mode: strict
      keys:
        - keyHash: "sha256:<hex>"
          metadata: {name: key_a, key_id: key_a, user_id: usr_a}
    localRateLimit:
      - key: apiKey.metadata.user_id
        type: requests
        maxTokens: 120
        fillInterval: 1m
policies:
  - name:
      name: "gateway-retry"
      namespace: default
    target:
      route:
        name: "llm:request"
        namespace: internal
    phase: route
    policy:
      retry:
        attempts: 2
        codes: [429, 500, 502, 503]
        backoff: 100ms
mcp:
  targets:
    - name: files
      sse:
        host: "https://mcp.example.com"
```

failover 里 0 先于 1；weighted 把 `priority` 换成 `weight`，conditional 换成
`when`，两者都保持 IR 原序。retry 只在显式配置时渲染；未配置即默认透传（首字节后
不切备、request_logs 1 请求 1 行，见 DELIVERY §6.4）。

## 7. AG 1.7 实测结论（`--validate-only`）

证据命令：

```bash
C:/Users/microsoft/agentgateway/agentgateway.exe --validate-only -f config.yaml
# apiKey.file 相对进程 cwd 解析，文件必须存在
```

- **providers/models 必须是数组**：map 形状报
  `llm.providers: invalid type: map, expected a sequence`；v1 渲染因此全量改写。
- **retry 不能挂在 `llm.policies`**：`llm.policies: unknown field 'retry'`；请求内
  重试只能以顶层 `policies[]` 挂内部路由 `internal/llm:request`（ADR-024/M3，真实
  上游切备见 E17-T3）。集成测试保留 `llm.policies.retry` 被拒的反例。
- **`llm.policies.transformations` 是 untagged enum**：`response` 单独可用、
  `conditional` 单独可用，**同时出现**报
  `unknown field 'response', expected 'conditional'`。因此默认 header delete
  挂到每个 model，全局策略只承载普通**或** conditional 一种。
- **`CorsSerde.maxAge` 是时长字符串**：整数 600 报
  `invalid type: integer 600, expected a string`，`'600'` 报 missing unit，
  `'600s'` 才合法。
- **`llm.models[].displayName` 不存在**：`unknown field displayName`。
  同样没有 `maxBufferSize`（provider/model 均无），所以只能 warning + 省略。
- **MCP 是顶层段**：`mcp.targets[].sse` 用 `host`（`url` 报
  `host or backend is required`）；`port`/`path` 必须成对。顶层 MCP 与 llm
  可同时 validate 通过；**运行期未验证**。
- **promptCaching**：`enabled` 是 unknown field；合法字段是
  cacheSystem/cacheMessages/cacheTools/minTokens/cacheMessageOffset。
- **apiKey budgets 需要 database**：未配置 database 时 AG 报
  `API key budgets require config.database to be configured`，所以不渲染。
- **localRateLimit 是数组**，`fillInterval` 必填；一条规则只有一个 maxTokens，
  因此逐用户可变余额桶不可表达（E12）。
- **CEL merge 要 map 字面量**：`.merge({"temperature": ...})` 合法，
  `.merge("temperature": ...)` 报 `mismatched input ':'`。

集成测试 `api/tests/integration/test_ag_validate.py` 在找不到二进制时
**skip 并注明环境原因**；有二进制时验证黄金配置 + 证明 retry 被拒。

## 8. 已知残留 / 未决

- MCP 仅通过解析/validate；实际代理行为、鉴权与 SSE 语义未在运行期验证。
- 全局 transformations 不能同时承载普通与 conditional 规则：这是 1.7
  解析限制，UI 需要拆成 model 级 + 仅 conditional 的全局块。
- 逐用户预付余额由控制面账本执行；数据面只有全局 rpm/tpm 规则，重启清零
  （E12），UI 不得把余额说成数据面强一致。
- `displayName` / `modelAliases` / `maxBufferSize` /
  `remoteRateLimit` 在 1.7 无配置面，相关字段只能报错或 warning；retry 例外，
  只能走顶层 `policies[]` 的路由级条目（ADR-024）。
- apply/validate/rollback 的 v2 编排属于 ticket 08；本契约只覆盖渲染与
  capability 错误。
