# M5-a 路由链后端：OTLP 接收器 + span 存储 + 查询端点 + tracing 渲染

> **已被 ADR-028 取代（2026-11-20）**：追踪实现收归 AG 适配器，系统不再有 OTLP 接收器、`trace_spans` 表、`/admin/traces/{trace_id}` 与系统级 tracing 配置；本票保留为历史设计记录。现行契约见 `docs/DECISIONS.md` ADR-028、`docs/contracts/adapter-spi.md` §2.2、`docs/api-contract.md` `/admin/logs/{event_id}/attempts`。


依据：E19（docs/experiments/P0-RESULTS.md §E19）已裁决 pinned AG 1.7.0 的路由链数据源 = OTel Traces。本票实现后端全链路；M5-b（前端路由链展示+策略页开关 UI）在本票合入后另行派发。

## 已钉死的事实（E19 实测，不要凭文档推翻）

1. 挂载点 = `frontendPolicies.tracing`（**顶层 tracing 键会被拒收**——那是 xds 控制面根）；协议用 `http`（OTLP/HTTP）；**`randomSampling` 必须显式 "true" 否则无 span**。
2. span 形状：1 请求 = 1 server 根 span + **每次上游尝试 1 个 client span**；client span 属性含 `http.path`（=上游路径前缀，即上游身份）、`http.status`、`error.type`、`agentgateway.outbound.kind/subtype`；根 span 属性含 `retry.attempt`、gen_ai.*（model/provider/usage）、duration。
3. 尝试序号无显式属性——**按 span start 时间排序复原**（E19 已验证与 mock 命中矩阵一致）。
4. 启用 tracing 后 request_logs 的 `trace_id`/`span_id` 填充，`span_id`==根 span id → **DB↔span 树以 trace_id join**。
5. accessLog 的 upstreamCalls CEL 字段在 1.7.0 静默失效——**不要走访问日志路线**；metrics 无 endpoint 标签——不做宏观点位。
6. AG 对接收器宕机时的导出重试行为未测——接收器做成控制面常驻被动服务（AG 只在 tracing 启用时才导出，控制面与 AG 同机部署时接收器天然在线），span 丢失可接受（尽力而为观测）。

## 范围（api/src 全部，web/src 不碰）

### 1. OTLP/HTTP 接收器（常驻被动服务）
- 新模块：解码器**移植并改造自 `ops/experiments/ag-lab/otel_capture.py`**（E19 已验证的手搓 protobuf wire-format 解码，traces 布局；保留其测试手法做单测）。分层落点按仓库铁律自定：建议解码器放 `l03_adapters/agentgateway/`（AG 遥测属适配层）或独立 `l0x` 模块，写入走 l05 service → l04 repo；底层不得 import 高层。
- 独立端口 ASGI 服务（默认 `127.0.0.1:4318`，`SLIPSTREAM_TRACE_OTLP_PORT` / `SLIPSTREAM_TRACE_OTLP_HOST` 可配），端点 `POST /v1/traces`；由 `server.py` wiring 常驻启动（类似 jobs 的接线方式）；**绑定失败只 warning 降级，不许 crash 主进程**；每请求 ≥4 span 的量级注记——解析要轻，attributes 只提取白名单键（http.path/http.status/error.type/retry.attempt/gen_ai 系/duration/start），其余丢弃。
- 一次性请求上限/体积防护（如 body ≤8MB）。

### 2. 存储
- 新表 `trace_spans`：trace_id(索引)、span_id、parent_span_id、kind(server/client)、http_path、http_status、error_type、retry_attempt、start_ms、end_ms、duration_ms、attributes_json(白名单子集)、ingested_at_ms；复合索引 (trace_id, start_ms)。
- `gateway_usage_events` 加 `trace_id` 列（init_db additive 惯例）；`usage_ingest`/`usage.py` 的列映射补 trace_id（AG 26 列里本来就有，此前被丢弃）。
- 留存清理：`log_cleanup` 任务追加 `cleanup_expired_spans`（沿用 log_retention_days 天级截断，只删 trace_spans，零影响断言）。

### 3. 查询端点
- `GET /admin/traces/{trace_id}` → `{trace_id, spans:[按 start 排序], attempts:[由 client span 复原：序号/上游(http_path)/状态码/错误/耗时]}`；权限 `logs:read`。
- `GET /admin/logs/{event_id}` 的明细出参**追加 `trace_id`**（additive，来自新列）。
- `docs/api-contract.md` 增行 + `ops/contract/gen_ts.py` 重生成（contract.ts diff 归本票）。

### 4. tracing 渲染
- 策略存储新增 tracing 配置：`{enabled(默认 false), host(默认 127.0.0.1), port(默认 4318), protocol:"http", random_sampling(默认 true)}`；`enabled=true` 时渲染 `frontendPolicies.tracing {host, protocol:"http", randomSampling:"true"|...}`（host/port 拼进 exporter endpoint——按 E19 cfg-E19-T1-otel.yaml 的实测形状）；disabled 时完全不产 tracing 块。
- 现有策略保存/下发/dry-run 流程不变；golden 补一个 tracing 启用形状（用真实 1.7 二进制 `--validate-only` 的 opt-in 测试若环境可用，否则 golden 对照 E19 cfg）。
- **不做**：策略页 UI（M5-b）、gRPC OTLP、采样策略精细化（只给布尔开关）。

### 5. 测试
- 解码器单测（手工构造 OTLP bytes 往返断言，可参考 otel_capture.py 内已有断言）。
- 接收端点集成测试（POST 模拟 OTLP → 落库 → /admin/traces 查询 → attempts 复原顺序与字段）。
- trace_id 列 additive 迁移 + ingest 映射用例。
- 留存清理用例 + 零影响断言（不删 request_logs/usage_events）。
- 渲染 golden（enabled/disabled 两态）。
- 全量 pytest EXIT=0（约 700 基线 + 新增）。

## 提交与回报
- 提交一笔 `api(m5-a): OTel 接收器+span 存储+traces 端点+tracing 渲染`（contract.ts 若 diff 归这笔）；逐文件 add，提交前核对暂存清单。不 push。
- 回报：改动文件清单（+x/-y）、每条门禁 EXIT 码（api 全量 pytest、gen_ts --check；web 门禁不适用）、分层落点选择与理由、遗留。
- 铁律：不碰 api/.data_store（用户真实数据）；不起 3700/3600；不碰 web/src；测试用隔离库；uv 环境无 pip，缺依赖用 `uv pip install ... --python api/.venv/Scripts/python.exe`（protobuf 解码优先标准库手搓——E19 已证可行，不要引入 protobuf 重依赖）。
