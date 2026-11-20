# M5-b 路由链前端：策略页链路追踪卡 + 日志详情路由链展示

> **已被 ADR-028 取代（2026-11-20）**：本票的策略页「链路追踪」卡已删除；日志详情路由链改读 `GET /admin/logs/{event_id}/attempts`（适配器归一化尝试），不再读 span 树。保留为历史设计记录。


前置：M5-a 已合入（OTLP 接收器、trace_spans 表、GET /admin/traces/{trace_id}、GET /admin/logs/{event_id} 出参带 trace_id、tracing 策略配置与渲染、contract.ts 已含新形状）。本票只做 web/src；后端禁区。

## 范围

### 1. 网关策略页「链路追踪」卡（pages/gateway-policies.tsx + components/governance/gateway-policies/*）
- 新卡：启用开关（默认关）+ OTLP 接收地址（host/port，默认 127.0.0.1:4318）+ 采样开关（randomSampling，默认开）+ 说明文案：**「启用后 AG 会把每次上游尝试作为 span 导出到控制面接收器（127.0.0.1:4318）；日志详情可查看请求内路由链；每请求约 4 个 span，量产环境可关闭采样」**。
- 保存走现有策略分区保存/下发流程（tracing 归入策略存储的哪个分区由 M5-a 后端实现为准——先读后端再接）。
- 卡内显示当前状态提示：未启用时说明「启用并下发后，新的请求日志会携带路由链数据（历史日志无）」。

### 2. 日志详情抽屉「路由链」区（components/logs/log-detail-drawer.tsx）
- 行 `trace_id` 存在时，抽屉追加「路由链」折叠区：按 attempts 顺序渲染时间线——每轮一行：`第 N 轮 → 上游（http_path 映射上游名，映射不到显示原始 path）· HTTP 状态码（语义色徽章）· 耗时 · 错误类型`；根 span 的 retry.attempt 与总耗时显示在区头。
- 数据获取：抽屉打开时若行带 trace_id，并发请求 `/admin/traces/{trace_id}`；404/null（无 span 数据，如 tracing 未启用的历史日志）则整个区不渲染。
- 上游名映射：用页面已有的上游列表（`GET /admin/upstreams` 或抽屉既有数据源）按 baseUrl path 前缀匹配 http_path，best-effort；映射不到显示原始 path。
- 列表页不动（不加链图标；如需可后续票）。

### 3. mock 更新（web/src/lib/mock.ts）
- `/admin/traces/{id}` mock（给若干 trace_id 备好 2-3 次尝试的样例，含一次失败尝试）+ 日志明细 mock 行带 trace_id——保证 mock 下路由链区可演示。

## 明确不做
列表页改动、span 明细原始 JSON 展示、采样策略精细化、gRPC。

## 验收
cd web（export TEMP/TMP=web/.scratch/tmproot）五门禁 EXIT=0（tsc/eslint/build/check-bundle/check-ui-foundation）；仓库根 terminology error=0；gen_ts --check（若前端类型取自 generated/contract.ts 则无 diff，报告说明）。浏览器冒烟（VITE_MOCK=1）：策略页链路追踪卡可用、保存后重开回显；日志详情（mock 行带 trace_id）展开路由链时间线（两轮：一轮失败红 + 一轮成功绿），无 trace_id 的行不渲染该区；截图存 web/.scratch/m5-b/。
提交：`web(m5-b): 链路追踪策略卡+日志详情路由链时间线`；逐文件 add 核对暂存数。不 push。
回报：改动文件清单（+x/-y）、门禁 EXIT 码、冒烟截图、遗留。
