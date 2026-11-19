# W4-E19 探针实验：AG 1.7 遥测能力盘点（路由链数据的最后裁决）

实验票：只写 `ops/experiments/ag-lab/` 探针与证据，不改 api/src、web/src。产出进 `docs/experiments/P0-RESULTS.md` 新增「E19」节。pinned AG 1.7.0，mock upstream，不碰真实凭据。

## 背景

路由链可视化此前被砍（request_logs 26 列无 attempt，49 请求 49 行）。用户提供的资料指出：默认 stdout/访问日志只记「入口请求最终结果」，但网关的内部重试/切换可以通过 **OpenTelemetry Traces**（每次上游调用一个 span）、**Prometheus 指标**（重试/错误计数）、**访问日志字段定制**、**debug 日志级别** 观测。这些能力在 pinned 1.7.0 **standalone 二进制**上逐一是否存在、能否拿到「每次尝试的上游与失败原因」，必须实测裁决，不得凭文档推断（资料中 agctl、K8s 端口转发等内容可能来自其他部署形态/版本）。

## 实验

- T1 OTel：查 pinned 二进制的配置 schema（`ops/experiments/ag-lab/` 已有 pinned schema 与 `--validate-only` 手法）里有无 tracing/telemetry/otel 相键；有则配一个最小 OTLP 导出（指向本地接收脚本，如 `ops/experiments/ag-lab/otel-capture.py`，裸 HTTP 接 OTLP/HTTP protobuf 或 JSON 即可，不引 SDK 依赖），跑一次 E17 口径的「主 500→切备 200」三件套请求，看 span 树：是否每次上游尝试一个 span、span 里有无 upstream 标识/状态码/重试序号。
- T2 Prometheus：探 admin/诊断端口有无 `/metrics`（standalone 默认端口见 README/实验记录）；有则抓取并找 retry/eviction/上游错误码相关计数器；记录「重试率类」指标能否支撑宏观面板。
- T3 访问日志定制：AG 1.7 的 access log（我们摄取的 SQLite request_logs）schema 是否支持 CEL 定制字段（可在 schema/capability 探针里查，或试配 access log format 类配置后看表结构是否变化）。结论要覆盖：能否显式输出 retry 次数/reason 元数据。
- T4 debug 日志：standalone 进程有无日志级别开关（CLI flag/env）；debug 级别下重试/驱逐事件是否进 stdout（拿一次必现失败请求复现，摘录关键行）。
- T5 agctl：确认 standalone 二进制是否含 `agctl` 子命令（预期不存在，写明证据）。

## 产出与验收

1. E19 节：一张「能力 × 是否存在 × 能否拿到每次尝试详情」的裁决表 + 证据路径。
2. 明确结论三选一：路由链可视化 (a) 可经 OTel 实现（给出推荐架构草案：span→控制面摄取→日志详情链路图）；(b) 只能宏观指标（重试率面板）；(c) pinned 1.7 无任何途径（维持砍定，列 AG 上游版本要求）。
3. 回报写清每个 T 的证据摘录与 EXIT/输出路径。
