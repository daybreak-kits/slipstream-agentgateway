# 系统边界契约（System Boundary）

- 状态：现行（W6 ticket 01，基线 2287de5）
- 原则裁定：[ADR-029](DECISIONS.md#adr-029-系统与数据面边界系统层只依赖标准接口与领域事实)
- 适用范围：`api/src/l01_core`…`l07_jobs`、`web/src`、`docs/api-contract.md` 与 `web/src/generated/contract.ts`
- 执行检查：`python ops/checks/import_lint.py`（基线报告）、`--strict`（ticket 06 起强制）

本文把 ADR-029 的原则写成系统层可执行的规则。**系统层只依赖标准接口与领域事实**；具体数据面实现只允许出现在 `l03_adapters` 与适配器工厂。本文与 ADR-029 互相引用：ADR-029 负责裁定「为什么」，本文负责回答「哪里算系统层、什么能出现、怎么检查、换数据面时核对什么」。

## 1. 一句话判据

> 如果某个字段、表、端口、路径、文件格式或用户文案，在换掉 agentgateway、改接 LiteLLM 或自研数据面之后必须修改，它就属于适配层。

系统层只出现六类事实：**请求、模型、路由意图、金钱、权限、审计**。适配层吸收其余全部实现细节。

## 2. 系统事实白名单

系统表、API、生成契约与 UI 只允许消费下表中的中性事实。白名单之外的字段必须先由适配器归一化，或留在适配器内部。

| 事实类别 | 系统可拥有的内容 | 不得出现 |
|---|---|---|
| 请求 | `UsageEvent`：event id、started/completed、duration、TTFT、HTTP 状态、对外/上游模型、密钥归因、input/output/total/cache token | 数据面 request_logs 列名、attributes_json、wire 属性、原始行结构 |
| 尝试 | `RequestAttempt`：correlation key、attempt_no、upstream_ref、model、status/error、started/duration、outcome | trace/span/parent/OTLP/接收器、span 树、agentgateway_user |
| 路由意图 | PublicModel、ModelTarget、priority/weight/when 的业务语义、可用性 excluded/projection | CEL 字符串、`llm.*` 配置文件路径、provider 渲染名展开规则 |
| 金钱 | cost/charge/margin、ledger、daily aggregate、价格快照 | 数据面成本字段、上游账单格式 |
| 权限 | 用户、角色、会话、客户密钥元数据（label/masked/seq/status） | 明文密钥、密钥文件路径与权限位 |
| 审计/配置版本 | revision id、operator、reason、status、hash、adapter_id、validation_note、created_at | 数据面配置内容格式、热加载细节、版本号语句 |

补充约定：

- `adapter_id` 是审计元数据，可以出现在配置版本与健康事实中；它不得进入用户可见的产品文案，也不得成为 UI 分支依据。
- `correlation_key` 是跨请求日志与尝试链的领域连接键（ticket 05 已落地中性列；迁移前 wire 命名的旧列由 `init_db` 回填后保留，待词表门禁退役）。
- `raw_json` 只能在适配器已归一化的前提下作为诊断附件存在（票05 后仅用于关键词检索附件）；系统层不得在其中解析 `agw.*`、`gen_ai_*`、`agentgateway_*` 等实现字段，API 不再返回它。
- 配置版本 artifact 可以携带适配器辅助文件描述，但系统层不解释其磁盘格式。

## 3. 适配层吸收清单

| 数据面知识 | 归属端口/位置 | 系统层只看到 |
|---|---|---|
| 数据面配置与命名空间 | 适配器工厂/适配器配置 | `data_plane_adapter` 选择与中性运行参数 |
| 端点、端口、客户端调用契约 | `client_contract()` | `ClientContract`（endpoints、default_port、health_path） |
| 采集/遥测接收与生命周期 | `start_telemetry()` / `stop_telemetry()` + `AttemptSink` | 归一化 `RequestAttempt` |
| 日志存储与 payload 读取 | `read_log_payload(event_id)` | `LogPayload` 或 None |
| 日志保留清理 | `prune_logs(retention_days)` | 每表删除计数 |
| transform/CEL 编译与预览 | `preview_transforms(spec)` | `TransformPreview` |
| 凭据物化、白名单清理、磁盘格式 | `materialize_credentials(files, dry_run=...)` | `MaterializationResult` |
| 能力词表、说明文案、版本限制 | `describe()` + `capability_note(key)` | 中性 capability key + 适配器提供的文案 |
| 健康/版本/漂移语义 | `status()` / `health()` | `DataPlaneStatus` / `HealthSnapshot` |
| 上游探测出口知识 | 适配器私有实现或后续 probe 端口 | 中性探测结果 |

能力键使用中性词表（如 `routing.priority_failover`、`observe.request_log`、`usage.read_events`、`mcp.targets`）。数据面配置路径（如 `llm.policies.*`、`frontendPolicies.*`）只能作为适配器内部映射，不能成为系统 API 或 UI 的键。

## 4. 依赖方向

```
l06_api / l07_jobs  ──►  l05_service  ──►  l04_repo / l02_domain / l01_core
        │                     │
        └──────────────┬──────┘
                       ▼
              l03_adapters.spi
              l03_adapters.registry
                       │
                       ▼
              l03_adapters.<driver>   （只有这里知道具体网关）
```

规则：

1. 依赖只能指向编号更小的层；同层 import 合法。`l04_repo`/`l05_service` 不得 import 具体 driver。
2. `l05_service` 对适配层只允许 `l03_adapters.spi`；具体构造点在组合层 `l06_api/adapter_factory.py`（ADR-006）。
3. `l02_domain` 不得 import `l03_adapters`；共享校验结果类型放在域层，由 SPI 重导出。
4. `l06_api`/`l07_jobs` 只允许 import `l03_adapters.spi` 与 `l03_adapters.registry`；注册表负责实例化与遥测生命周期，组合根不得按适配器名字硬分派。
5. 适配器不 import `l04_repo`/`l05_service`；适配器只能通过 SPI 类型与领域模型和上层交接。
6. Web 只经 API 与生成契约消费系统字段；页面与 mock 不得复制适配器能力矩阵、端口、wire 字段或数据面配置路径。

## 5. import 规则

### 5.1 系统层允许

```python
from l03_adapters.spi import DataPlaneAdapter, LogPayload
from l03_adapters.registry import create, start_telemetry
```

### 5.2 系统层禁止

```python
# 系统 API/job 直接抓具体实现（ticket 02/03 清零）
from l03_adapters.agentgateway.usage import fetch_request_payload
from l03_adapters.agentgateway.transforms import compile_transforms
from l03_adapters.agentgateway.usage import cleanup_expired_logs

# 组合根按名字分派（ticket 04 清零）
if settings.data_plane_adapter == "agentgateway":
    ...

# 系统层硬编码客户端契约（ticket 04 清零）
settings.ag_llm_port
["/v1/chat/completions", "/v1/models", "/v1/embeddings"]
```

### 5.3 执行基线

`ops/checks/import_lint.py` 扫描：

- `api/src/l02_domain`、`l04_repo`、`l05_service`、`l06_api`、`l07_jobs` 的 Python import/引用；
- `web/src`（含 `web/src/generated/contract.ts`）中的具体适配器模块引用。

默认模式列出当前泄漏并以 EXIT=0 结束，不阻断；`--strict` 在有任何泄漏时 EXIT=1。W6 基线（2287de5）的 8 条已知泄漏：

| # | 位置 | 类型 | 迁移票据 |
|---|---|---|---|
| 1 | `api/src/l06_api/routers_log_payload.py:16` | 具体 usage reader import | 02 |
| 2 | `api/src/l06_api/routers_upstreams.py:15` | 具体 transform compiler import | 03 |
| 3 | `api/src/l07_jobs/log_cleanup.py:28` | 具体 retention helper import | 02 |
| 4 | `api/src/l06_api/adapter_factory.py:24` | 适配器名字分支/形状化 kwargs | 04 |
| 5 | `api/src/l06_api/routers_health.py:21` | 健康响应暴露数据面端口 | 04 |
| 6 | `api/src/l06_api/routers_meta.py:150` | connection 硬编码端点清单 | 04 |
| 7 | `api/src/l06_api/routers_ops.py:986` | playground 硬编码数据面地址/端口 | 04 |
| 8 | `web/src/lib/mock.ts:606` | 前端复制适配器能力矩阵 | 06 |

本票只建立基线，不把 `--strict` 接入任何门禁；ticket 06 在四侧迁移完成后清零并转强制。

## 6. 词表规则

### 6.1 系统层使用

usage event、request attempt、correlation key、availability、config revision、capability、data plane status、upstream model、public model、model target。

### 6.2 系统层禁止（除适配器内部、注释中的历史说明与 ADR 原文）

- 数据面专有名词：agentgateway、AG、agentgateway_user、agentgateway_group、gen_ai_*、agw.*、OTLP、trace、span、keyHash、virtualModels、llm.policies、frontendPolicies、ag-data.db、ag_config_dir、3600、4318。
- 数据面配置路径作为 capability key、API 字段或 UI 文案。
- 「AG 1.7 不支持/拒收」之类的版本语句直接出现在系统 UI；需要时由适配器通过 `capability_note` 提供中性文案。
- 旧英文产品名。产品对外名统一「模型接口网关」。

例外：`adapter_id` 审计值、ADR/历史归档、适配器私有注释与测试 fixture。例外不得扩散到 API 契约、生成类型或用户可见文案。

### 6.3 响应字段

API 与生成契约只使用中性领域字段。新增字段前先回答：换数据面后是否必须改？如果是，字段属于适配器端口，不属于系统契约。

## 7. 六类 SPI 端口与遥测生命周期

`l03_adapters/spi.py` 的 `DataPlaneAdapter` 在原有 describe/validate/render/apply/status/usage/health/rollback 之外声明：

| 端口 | 语义 | 返回值 |
|---|---|---|
| `read_log_payload(event_id)` | 读取适配器存储的请求/响应正文 | `LogPayload \| None` |
| `prune_logs(retention_days)` | 适配器执行保留清理，只碰日志事实 | `dict[str, int]` |
| `preview_transforms(spec)` | 在适配器内编译/预览规则，不写数据面 | `TransformPreview` |
| `materialize_credentials(files, dry_run=False)` | 写/清理适配器管理的凭据文件 | `MaterializationResult` |
| `client_contract()` | 端点、默认端口、健康路径等客户端事实 | `ClientContract` |
| `capability_note(key)` | 中性能力键对应的适配器文案 | `str`（未知为空串） |

遥测契约：

- `AttemptSink` 是适配器到系统的归一化尝试入口，类型由域层拥有、SPI 重导出；
- `start_telemetry(app, sink)` 由适配器挂接自己的采集/接收生命周期并返回可停止句柄；`stop_telemetry(handle)` 幂等；
- 注册表只负责委托，不按适配器名字 import 具体遥测模块；
- 系统不定义 OTel/trace/span 表，只存 `RequestAttempt`（ADR-028）。

## 8. fake adapter

`l03_adapters/fake.py` 的 `FakeAdapter` 是边界可测试性的反证：不启动真实数据面，也能走通启动、health、connection、usage 拉取/列表、日志列表/详情、渲染下发与清理。它：

- 通过 `registry.create("fake")` 可实例化，但**不进入 UI 选择**；控制台仍只显示配置的 adapter 事实；
- 实现全部 SPI 端口与遥测生命周期，使用内存事件/正文/凭据，不写入真实数据面库；
- 默认提供确定性的 usage 事件，供系统主流程测试使用；
- 不包含任何数据面 wire 格式、专有端口或配置路径。

真实适配器（agentgateway）与 mock 也必须满足同一结构协议；`api/tests/contract/test_spi_ports.py` 是 conformance 测试，`api/tests/integration/test_fake_adapter_main_flow.py` 是系统主流程测试。

## 9. 换数据面检查清单

替换或新增数据面时，逐项核对：

1. **系统层零改动**：`api/src/l02_domain`、`l04_repo`、`l05_service`、`l06_api`、`l07_jobs` 无需改 import、字段、表或路由；`web/src` 无需改字段与文案。
2. **SPI 完整**：新适配器实现 8 个基础方法 + 6 个业务端口 + `start_telemetry`/`stop_telemetry`；`isinstance(adapter, DataPlaneAdapter)` 通过。
3. **事实归一化**：usage、attempts、payload、availability、config revision、cost/charge 都落到系统中性事实；不得把数据面行结构直接存表或下发。
4. **客户端契约**：connection、health、playground 的端点/端口只来自 `client_contract()`，系统不拼数据面地址。
5. **凭据**：系统只保存凭据元数据；明文只经 `materialize_credentials` 边界，适配器负责路径、原子写、白名单清理。
6. **日志**：payload 读取与保留清理都经端口；系统不再打开数据面日志库。
7. **能力与文案**：能力键在中性词表内，文案由适配器提供；UI 不出现数据面配置路径或版本语句。
8. **遥测**：适配器自己采集并归一化为 `RequestAttempt`；系统不新增 trace/span 表或接收器。
9. **门禁**：`python ops/checks/import_lint.py --strict` 为 0；词表/契约门禁通过；fake adapter 主流程测试通过。
10. **回归**：全量 pytest、ruff、契约生成检查保持绿；用户可见行为无变化。

## 10. 与其它文档的关系

- ADR-029 是本契约的原则裁定与状态来源；本文是执行细则。
- `docs/contracts/adapter-spi.md` 描述端口/方法的详细语义；本文补充边界归属、六类端口、import/词表规则与迁移基线。
- `docs/contracts/ir-and-rendering.md` 描述 IR 与渲染；IR 中的适配器约束说明不得被误读为系统领域字段。
- `docs/api-contract.md` 与 `web/src/generated/contract.ts` 只允许系统事实；迁移期间的具体泄漏由 import-lint 记录。
