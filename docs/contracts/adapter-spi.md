# 数据面适配层契约（DataPlaneAdapter SPI）

位置：`api/src/l03_adapters/spi.py`。上层（`l05_service`）只认这个协议，不认任何具体网关。

## 1. 协议

```python
from typing import Protocol

class DataPlaneAdapter(Protocol):
    def describe(self) -> AdapterInfo: ...
    def validate(self, ir: GatewayIR) -> ValidationResult: ...
    def render(self, ir: GatewayIR) -> Artifact: ...
    def apply(self, artifact: Artifact) -> ApplyResult: ...
    def status(self) -> DataPlaneStatus: ...
    def usage(self, cursor: UsageCursor | None) -> UsagePage: ...
    def health(self) -> HealthSnapshot: ...
    def rollback(self, revision_id: str) -> ApplyResult: ...
```

## 2. 八个方法的语义边界

| 方法 | 纯函数 | 有副作用 | 说明 |
|---|---|---|---|
| describe | 是 | 否 | 返回版本、能力矩阵、支持的 IR 版本 |
| validate | 是 | 否 | 只校验 IR 是否合法、是否被该网关支持，**不落盘**；由上层在 apply 流程里、写任何文件之前调用（S3），失败即 `APPLY_FAILED` 并带 `details.errors` |
| render | 是 | 否 | IR → 具体配置文本，同输入必同输出（可做快照测试） |
| apply | 否 | 是 | 原子写 + 校验 + 热加载 + 确认，失败自动回滚 |
| status | 否 | 否（只读） | 读配置文件的**真实 sha256** 与最近一次 apply 落的 `<filename>.hash` marker 比对，返回 `config_hash` + 三态文案（见 §4.1）、进程版本、监听状态 |
| usage | 否 | 否（只读游标） | 增量拉取用量事件，分页、幂等、可重放 |
| health | 否 | 否（只读） | 数据面自身健康（不是上游健康） |
| rollback | 否 | 是 | 回到指定版本 |

### 2.1 validate 与 apply 的调用次序（S3）

`validate` 由**上层**在 apply 流程里调用，不是 applier 内部的一步：

1. `l05_service/rendering.py:build_render_plan()` 先做通用 IR 自校验（`l02_domain/validation.py:validate_gateway_ir`），失败 → `APPLY_FAILED` + `details.errors`。
2. 再调驱动自己的 `adapter.validate(ir)`：驱动可以拒绝通用校验放过的 IR（例如网关不支持某个字段）。失败 → `APPLY_FAILED` + `details.errors`，**此时还没有写 key 文件、没有 render、没有归档版本**。
3. 只有两步都通过，才 `write_key_files()` → `adapter.render(ir)` → `adapter.apply(artifact)`。

顺序理由：驱动校验不通过时，任何落盘都属于「明知不可用仍写文件」，会污染密钥目录与配置版本历史。

### 2.2 遥测生命周期与 AttemptSink（ADR-028）

`observe.request_attempts` 不是控制面请求路径上的方法，而是应用生命周期入口：

1. 系统启动时 `l03_adapters/registry.py:start_telemetry(app, sink, settings)` 按 `settings.data_plane_adapter` 惰性调用适配器的 `wire_telemetry(app, sink)`；返回的 receiver 挂在 `app.state`，shutdown 时停止。
2. 适配器启动自己的采集端（AG 1.7 是适配器模块内的 loopback OTLP/HTTP 接收器，监听默认 `127.0.0.1:4318`，可用 `SLIPSTREAM_AG_TRACE_PORT` 改；端口占用则降级为不采集，不阻塞启动）。
3. 适配器把采集到的 span 解码、按请求归一化为 `RequestAttempt(attempt_no, upstream_ref, model, status_code, error_type, error_message, started_at_ms, duration_ms, outcome)` 序列，调用 `AttemptSink(attempts) -> int`；系统实现按 `(correlation_key, attempt_no)` 幂等 upsert。
4. 系统只认 `RequestAttempt`，不知道 OTLP、span、trace 树；换 LiteLLM/自研适配器时用 callback/事件/DB 提供同一端口即可。
5. 采集开关不进入 `/admin/policies`：适配器在采集端可用时自行渲染数据面追踪配置；无该能力的适配器，`GET /admin/policies` 的 `capabilities.request_attempts.supported=false`，UI 隐藏路由链。

## 3. 能力矩阵

能力是**声明式**的，UI 据此置灰功能并给出原因，而不是假装支持。

| 能力键 | 含义 | AG v1.7.0 |
|---|---|---|
| `routing.priority_failover` | 按 priority 分层故障转移 | 支持 |
| `routing.weighted` | 单层加权 | 支持（单层内生效，与分层 failover 互斥；v1 **已用**：IR `weighted` 模式按 IR 顺序下发，`weight` 为整数相对比例） |
| `routing.conditional` | CEL 条件路由 | 支持（按序求值、末位可省 `when`；v1 高级模式启用） |
| `routing.callout` | 外部服务选路 | 支持（v1 不用：不在 `ROUTING_MODES`） |
| `auth.api_key_static` | 静态密钥鉴权 | 支持 |
| `auth.ext_authz` | 外部鉴权服务 | 支持（v1 不用：会把 Python 拉进热路径） |
| `quota.budget` | token/费用预算 | 支持（v1 不用：ADR-007 改用预付余额 + `localRateLimit`） |
| `quota.rate_limit_local` | 本地限流 | 支持 |
| `guardrail.request` / `guardrail.response` | 护栏 | 支持**仅限** `binds[].listeners[].routes[].backends[].ai.policies` 层级；简化 `llm:` 没有配置面，当前驱动能力矩阵也不声明这两键，v1 不下发 |
| `transform.headers` | 请求头改写 | 支持 |
| `observe.request_log` | 请求日志落库 | 支持 |
| `observe.prometheus` | 指标 | 支持 |
| `observe.request_attempts` | 请求尝试链（ADR-028）：每次上游尝试归一化为 `RequestAttempt`，经 `AttemptSink` 交给系统落 `request_attempts`；OTLP/接收器/span 都是适配器内部实现 | 支持（AG 1.7 适配器私有 OTLP 接收器采集；`verified=true`） |
| `config.validate_only` | 配置预校验 | 支持 |
| `config.hot_reload` | 热加载 | 支持（P0-R2 待验证对在飞请求的影响） |
| `usage.read_events` | 增量读用量 | 支持（读其 SQLite） |

每个能力带 `supported: bool`、`since_version: str`、`note: str`、`verified: bool`。**未实测的能力一律 `verified=false`**，UI 上标灰。

## 4. apply 的原子性要求

1. 上层先跑 `validate`（S3，见 §2.1）；不通过就结束，不写任何文件
2. 把 artifact 写临时文件，保留上一版内容在内存里
3. `os.replace` 原子覆盖到白名单目录下的目标文件
4. **读回确认**：把读回内容与 artifact 文本去掉 AG 自己写回的 `session.*` 行后比对；不一致就立刻恢复上一版
5. 确认通过后写 `<filename>.hash` marker（内容 = artifact 的 sha256），供 `status` 比对
6. 失败路径返回 `ApplyResult(ok=False, rolled_back=True, message=...)`，上层归档一条 `status="failed"` 版本并抛 `APPLY_FAILED`；成功路径归档 `status="active"` 并把旧版本置 `superseded`

**官方二进制预校验（ticket 08，ADR-010 E8）**：注入 validator 时，在步骤 1 之后、写目标文件之前多一步——

0. 把候选配置写进**目标目录**（AG 按配置文件所在目录解析 `params.apiKey.file`），跑 `agentgateway --validate-only -f <candidate>`；候选文件随后删除。拒绝时**不碰**目标文件与 marker，返回 `ApplyResult(ok=False, errors=(...), validation_note="...")`，错误文本来自二进制 stderr（去掉 `Error: ` 前缀、截断到可展示长度），上层原样放进 `APPLY_FAILED.details.errors`。二进制不存在时跳过校验但把 note 记录到 apply 结果与 revision 行（`validation_note`），绝不静默当作通过；`--validate-only` 通过不代表业务不变量成立（E8：它接受 `priority=0`），所以上层 IR 自校验仍然必须先跑。

**ApplyResult 的 ticket 08 字段**：`errors: tuple[str, ...]`（可展示错误）、`file_hash: str | None`（apply 成功后盘上文件的归一化 sha256，用于 revision 的 `artifact_hash`）、`validation_note: str`（通过/跳过的说明）。版本行新增 `error_detail`（失败原因）与 `validation_note`，列表与 latest 接口都会返回。

**不写回滚之外的东西**：applier 只允许写目标配置目录（`config_dir` 白名单），不重启进程（E2：热加载不打断在飞 SSE）。

**不允许**：直接覆盖后不管结果；不允许部分字段生效。

### 4.1 status 的判据是文件，不是 marker（S5）

`status()` 必须回答「数据面**现在**服务的是哪份配置」，所以判据是配置文件本身：

1. 读 `<config_dir>/<filename>`，剔除 AG 加载时写回的 `session:` 块与 `session.key` 行，再算 sha256（marker 里存的是 `sha256(artifact.content)`，不归一化就永远像 drift）。
2. 读 `<filename>.hash` marker（最近一次成功 apply 落的 hash）。
3. 两者比对，`DataPlaneStatus.detail` 只有这几种文案：`config file matches last applied hash`、`config drift: file <前12位> != applied <前12位>`、`config file missing; hash from last apply marker`、`no config applied yet`、`config file present; no apply marker`。

**为什么要这样**：marker 只能证明「我们写过什么」，不能证明「盘上现在是什么」。手改、被别的工具覆盖、被运维替换都必须显示成 drift，而不是回显 marker 假装一致。

`GET /admin/config/status`（ticket 08）直接返回同一份 `DataPlaneStatus`（`config_hash` / `detail` / `process_version` / `listening`）并附当前 `active_revision`；detail 文案就是上面五种，前端不需要猜。

### 4.2 rollback 的语义（12:40 修复）

`rollback(revision_id)` 的参数是**数据面版本号**，即 artifact 下发时使用的 `Artifact.revision`（控制面 `config_revisions.id`），**不是** artifact hash。实现与上层约定：

1. 驱动按版本号取自己保存的上一版 artifact，走与 `apply` 相同的原子写 + 读回确认路径，返回 `ApplyResult`（`rolled_back=True`）。
2. 驱动没有该版本（进程重启后内存历史丢失是正常情况）时返回 `ok=False`；上层**不会**因此判回滚失败，而是用归档在控制面 DB 里的 artifact 内容重建 `Artifact`，再走 `apply` 重放（`make_artifact(target.artifact, revision=target.id)`）。
3. 两条路都失败时：归档一条 `status="failed"` 版本（保留审计），**不**标记新 active，旧 active 继续服务，并抛 `APPLY_FAILED` + `details.message`。
4. 成功时归档 `status="active"`，`artifact_hash` 取 `ApplyResult.file_hash`（盘上真实 hash），缺失时回退到 `applied_hash` / 归档 hash；旧 active 置 `superseded`，并更新 `active_revision` 设置。失败行记录 `error_detail`（双失败时是 fallback apply 的 message）与 `validation_note`。
5. 回归测试：`api/tests/integration/test_config_rollback.py`（传版本号不传 hash、历史丢失回退、失败归档且旧版本继续服务）。

## 5. 契约测试（每个 driver 必过）

- `render` 幂等：同 IR 两次渲染字节一致
- `render` 覆盖全部 IR 字段：IR 里每个字段都有对应断言
- `validate` 能拒绝非法 IR（重复对外模型名、优先级为负、目标指向禁用上游等）
- `apply` 成功后 `status` 的 config hash 与 artifact hash 一致
- `apply` 失败后配置回滚到上一版
- `usage` 幂等：同一游标拉两次不产生重复事件
- `validate` 失败时上层 apply 流程**一个文件都不写**（不写 key、不 render、不归档）：`api/tests/integration/test_apply_validation.py::test_apply_stops_before_render_when_adapter_validate_fails`
- `status` 的 `config_hash` = 配置文件真实 sha256，且与最近一次 apply 的 artifact hash 相等：`api/tests/unit/test_apply_status.py::test_status_matches_applied_file`、`api/tests/contract/test_agentgateway_adapter.py::test_apply_then_status_reports_applied_hash`
- 外部手改配置后 `status` 报 drift（不是回显 marker）：`test_apply_status.py::test_status_reports_drift_after_external_edit`、`test_agentgateway_adapter.py::test_status_detects_hand_edited_config`
- AG 写回的 `session.*` 不算 drift；文件被删时回退到 marker：`test_apply_status.py::test_status_ignores_gateway_written_session_block`、`test_status_falls_back_to_marker_when_file_gone`
- 渲染不下发 IR 里数据面没有配置面的块（guardrails / mcp）：`test_apply_validation.py::test_render_never_emits_unsupported_blocks`
- `--validate-only` 拒绝时一个文件都不写（目标文件、marker、候选文件全部不存在），错误可展示：`api/tests/unit/test_apply_validate_gate.py::test_rejected_config_writes_nothing`
- 校验失败保留上一版继续服务且 `status` 仍与上一版一致：`test_apply_validate_gate.py::test_rejected_config_keeps_previous_config_serving`
- apply 成功后 revision 的 `artifact_hash` = 盘上文件真实 sha256：`test_apply_validate_gate.py::test_apply_records_real_file_hash_and_validation_note`
- 回滚重放走同一条校验门：`test_apply_validate_gate.py::test_rollback_replays_through_the_validation_gate`
- 真实二进制端到端（存在则跑，缺失则 skip）：`api/tests/integration/test_apply_binary_gate_real.py`
- 旧 priority 语义迁移：`api/tests/unit/test_priority_migration.py`、`api/tests/integration/test_priority_migration_demo.py`