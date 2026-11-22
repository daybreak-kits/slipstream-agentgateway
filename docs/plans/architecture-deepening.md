# 架构深化计划：5 条工作流

状态：**已确认，待实施；本轮只落计划与 ticket，不写业务代码。**
日期：2026-11-22
依据：用户 m08474 对 Q1-Q6 的拍板；只读架构评审报告 architecture-review-2026-11-22T03-07-29-054Z.html；当前 main @ d8b5498。
范围：系统层与 Web 控制台内部的模块深化；不碰数据面、AG renderer、ADR-024/028/029/030 的边界。

## 0. 完成定义

1. 5 张 ticket 全部完成，每张都能独立验收；每张完成后全量门禁通过。
2. 系统未上线，因此**不做旧策略兼容**：契约可以直接改，旧 JSON 键、旧手写类型、旧 api 调用、旧 mock 分支在对应迁移完成后删除，不保留长期兼容层。
3. 不拆分 aggregates.py 的 SQL 聚合实现；不改变数据面 / adapter SPI 的职责。
4. 文档同步：GLOSSARY、api-contract、相关 ADR 说明、生成契约；计划状态随 ticket 更新。
5. 不引入真实上游凭据；测试只用本地固定响应 / 内存 adapter。

## 1. 已定决策

### D1 五条独立工作流

| 编号 | 工作流 | 规模 | 依赖 |
|---|---|---|---|
| 01 | 日志查询 module | M | 无 |
| 02 | 尝试链归一 | S | 无 |
| 03 | 报表 payload 定型 | L | 02 |
| 04 | Web typed operations | XL | 01、02、03 |
| 05 | Playground chat module | M | 04 |

顺序：01 与 02 可并行起步，然后 03，然后 04，最后 05。每张 ticket 独立验收，不做一个大重构分支。

### D2 契约不兼容旧策略

- 系统未上线，不存在需要保持的旧策略；允许修改 JSON 字段、删除旧键、重命名、调整嵌套。
- 但**用户可见行为必须保持**：无权限时 money 字段仍应缺省而不是 null；日志查询语义、报表数值、路由链展示不能回退。
- 契约唯一来源是 api/src/l06_api 的 Pydantic / OpenAPI；前端类型由 ops/contract/gen_ts.py 生成，不手写影子类型。
- 旧的 web/src/types.ts 手写契约、旧 report-types.ts 形状、旧兼容别名在对应迁移完成后删除。

### D3 前端模块测试

- 新增 vitest（纯 TS 模块测试，不引 jsdom）与 npm test。
- 现有 Playwright / SSR / check-ui-foundation / check-semantic-dirty 门禁保留。
- 迁移完成后清理旧兼容层与旧测试断言，不保留两套入口。

### D4 04 分域迁移

顺序：upstreams → models → reports（等 03）→ logs → admin/settings/playground（不含 chat 请求）。
每域一个原子迁移：定义操作 → HTTP adapter → in-memory adapter → 迁调用方 → 删除该域旧 api/mock 分支 → 测试。逐域验收，不一次性切完。

### D5 05 最后做

Playground chat module 放在 04 之后，复用 typed operation / transport seam；不在旧 api 上写一版再迁一次。

### D6 计划产物

本文件，以及 .scratch/architecture-deepening/issues/ 下 5 张 ticket。编号与上表一致；ticket 顶部记录 Status / Blocked by。

## 2. 依赖与顺序

    [01 日志查询] ─┐
                   ├─→ [03 报表 payload] ─→ [04 Web typed operations] ─→ [05 Playground chat]
    [02 尝试链] ───┘

- 01、02 无依赖，可并行。
- 03 依赖 02：先建立“契约只加/改归一事实、生成契约、删除旧字段”的范式。
- 04 依赖 01、02、03：日志域要等 01；报表域要等 03；其余域可先做，但整张 ticket 在依赖清空后验收。
- 05 依赖 04：chat 的 transport 与 in-memory adapter 复用 04 的 seam。

## 3. 通用实施约束

1. **先读文档**：docs/GLOSSARY.md、docs/DECISIONS.md、docs/contracts/adapter-spi.md、docs/api-contract.md；命名使用术语表词汇。
2. **契约生成**：改 Pydantic 后运行 python ops/contract/gen_ts.py；提交前 python ops/contract/gen_ts.py --check 必须通过。
3. **前端类型**：只从 web/src/generated/contract.ts 取 wire 类型；不新增手写重复类型。领域内派生类型可以存在，但不能重新声明 wire 形状。
4. **测试**：后端 pytest + ruff；前端 vitest（纯模块）+ tsc + eslint + vite build + check-bundle + check-ui-foundation + check-semantic-dirty + 术语门禁；交互变化用 Playwright 冒烟。
5. **无兼容层**：每个域迁完即删旧调用、旧 mock 分支、旧类型别名；不保留 deprecated 转发。
6. **提交粒度**：每张 ticket 至少一个独立 commit；04 可按域多个 commit，但 ticket 只在全部域完成后 resolved。
7. **文档**：改 HTTP 契约时同步 docs/api-contract.md；改系统边界时同步 ADR；不新增未记录的边界。

## 4. 01 日志查询 module

### 现状

- api/src/l06_api/routers_ops.py:125 定义 _LogQuery；:164-208 parse/422；:316-377 SQL 子句；:468-506 关键字预筛；:256-276 Python 精确匹配；:595-617 SQL 复检；:695-769 两条端点路径。
- 词表还出现在 web/src/components/logs/query-syntax-help.tsx:14-25。
- api/tests/integration/test_logs_sql_parity.py:3-5 把旧实现逐字拷进测试；:27-34 直接 import 6 个私有函数。

### 设计方向

- 新增 api/src/l05_service/log_query.py：token 表是唯一词表；parse 产出 typed predicate；内部提供 compile_sql(predicate) 与 matches(predicate, log) 两个 adapter。
- routers_ops.py 只保留 HTTP 边界：读 query、调 module、把 422 映射成现有错误格式；删除 _LogQuery 与 SQL/Python 复制。
- 新增 GET /admin/logs/query-syntax（logs:read）返回同一 token 表；前端 QuerySyntaxHelp 从该接口取词表，不再手抄 TOKENS。
- 对拍测试改为公开 predicate 的两种实现比较，不再 import 私有函数。

### 实施步骤

- [ ] 建 log_query.py 与单测：token 表、parse、边界值、422 文案。
- [ ] 把 SQL 子句与 Python matcher 移入 module；router 改调用。
- [ ] 加 query-syntax 响应模型与端点；生成契约。
- [ ] 前端 QuerySyntaxHelp 改为读取端点数据；删除手写 TOKENS。
- [ ] 重写 test_logs_sql_parity.py，覆盖现有 11 类 token 与组合、分页、排序、金额掩码。
- [ ] 全量门禁 + 日志页冒烟。

### 验收

- [ ] 现有查询语义逐字节一致；非法 token 的 422 与 details.token 不变。
- [ ] 测试不再 import _parse_log_query / _cache_ratio 等私有函数。
- [ ] 帮助弹窗的 11 类 token 与后端词表一致；前端无手写重复列表。
- [ ] pytest、ruff、tsc、build、check-ui-foundation、术语门禁通过。

### Out of scope

- 不新增查询 token；不改日志表结构；不改日志列表视觉；不把日志查询做成 DSL 编译器。

### 风险

- SQL 与 Python 匹配在 NULL、大小写、stream 回退、cache 比例边界上可能分叉；用现有矩阵 + 新增边界用例守住。
- query-syntax 接口让帮助弹窗多一次请求；加加载/错误态，不做本地兜底副本，避免再次分叉。

## 5. 02 尝试链归一

### 现状

- api/src/l06_api/schemas.py:593-605 LogAttemptOut 暴露 upstream_ref / upstream_name；前端 request-attempt-chain.tsx:31-39 从 upstream_ref 的 #N 后缀解析密钥序号。
- mock（web/src/lib/mock.ts:380-407 等）的 ref 没有 #N，漂移无测试可见。
- 后端 routers_ops.py:773-819 已经解析 upstream_name，但 upstream_ref 仍把 adapter 命名泄漏到展示层。

### 设计方向

- API 契约直接给归一事实：attempt、upstream_id、upstream_name、upstream_key_seq（int | None）、model、status_code、error_type、error_message、duration_ms、outcome、started_at_ms。
- 删除响应里的 upstream_ref；adapter 的 ref 解析只发生在后端 seam 内。
- 前端只用 upstream_name + upstream_key_seq 拼展示，不出现 lastIndexOf(“#”) 或字符串后缀解析。
- mock fixtures 直接写 upstream_key_seq；seed 的内部 attempt 记录仍可保存 ref，但 API 输出不暴露。

### 实施步骤

- [ ] 改 LogAttemptOut 与 routers_ops 映射；加 seam 内的 ref 归一 helper。
- [ ] 重新生成 contract.ts；删除前端 parsing；统一列表 popover 与详情抽屉的 label helper。
- [ ] 更新 mock fixtures；补有 #N 与无 #N 两条链。
- [ ] 补后端 attempt 映射测试 + 前端 check-ui-foundation 断言。
- [ ] 全量门禁 + 日志页冒烟。

### 验收

- [ ] 路由链仍显示“上游名#密钥序号”；无序号时显示上游名，不显示“-”。
- [ ] 前端源码不再出现 upstream_ref 后缀解析。
- [ ] mock 与真实契约同形；无 #N 的旧漂移被测试覆盖。
- [ ] 全量门禁通过。

### Out of scope

- 不改 attempt 持久化、不改重试策略、不改路由链交互。

## 6. 03 报表 payload 定型

### 现状

- api/src/l05_service/aggregates.py:413/498/690/932/1153 等返回 dict；routers_reports.py 只有 flow 声明 response_model=FlowReportOut（:398）；overview 在 :151-209 手拼 payload。
- web/src/components/dashboard/report-types.ts:87-405 手写 Raw/Report 形状，11 个消费方；report-mocks.ts 605 行再抄；generated/contract.ts 只有 FlowReportOut。

### 设计方向

- 在 api/src/l06_api 新建 report_schemas.py，为 overview、latency、timeseries、heatmap、flow 定义 Pydantic response model；router 逐端点声明 response_model。
- 不拆 aggregates.py 的 SQL 聚合；只把 HTTP payload 定型。允许清理重复/别扭的字段形状，但保留数值语义与无权限 money 缺省。
- 重点验证：response_model 不能把无权限时本应缺省的 money 键补成 null。必要时用显式 serializer / response_model_exclude_none 组合，测试兜底。
- 前端删除 report-types.ts 的手写 wire 类型，改为 generated contract + 少量派生类型；report-mocks 用生成类型约束；11 个消费方同步。

### 实施步骤

- [ ] 先为 flow 之外 4 个端点补模型，逐端点开关 response_model，保持响应内容不变。
- [ ] 处理 money 缺省语义；补 RBAC 缺省/null 测试。
- [ ] 生成契约；前端替换 Raw/Report 类型，保留 normalizeTimeseries 等派生函数但改用生成类型。
- [ ] report-mocks 改用生成类型；删除重复手写形状。
- [ ] 全量门禁 + 看板冒烟（含无权限用户）。

### 验收

- [ ] 5 个报表端点都有 response_model；OpenAPI/contract.ts 覆盖全部。
- [ ] 无权限时 money 键缺省，不出现 null；有权限时数值不变。
- [ ] 前端图表不再 import 手写 wire 类型；TypeScript 编译通过。
- [ ] aggregator SQL 未被拆改；报表数值与现有测试一致。
- [ ] 全量门禁通过。

### Out of scope

- 不拆 aggregates.py；不改图表视觉/计算；不新增报表维度。

### 风险

- dict 形状动态（单/双 metric、缺省 money、条件成员）与 Pydantic 校验冲突；逐端点迁移，保留现有响应 golden 对拍。
- 生成类型可能变大；只导出实际使用的类型，避免 any/unknown 扩散。

## 7. 04 Web typed operations

### 现状与目标

- 现状：web/src/lib/api.ts 的 raw path 接口；web/src/lib/mock.ts 1132-1814 按 path+method 假 HTTP；useMock 30 处/9 文件；97 处 api.get/post；types.ts 70 个手写 export 被 42 个文件 import。
- 目标：每个领域一个 typed operation module；HTTP adapter 与 in-memory adapter 实现同一操作集；调用方只调操作；useMock 只在组合根。

### 设计方向

- 新目录 web/src/lib/control-plane/：operations（按领域拆文件）、http-adapter、memory-adapter、errors、composition root。
- 操作返回 generated contract 类型；错误统一成 ApiError；不把 URL/query/response 细节暴露给页面。
- 内存 adapter 持有 fixtures 与少量命令状态；不再按 URL 重写后端。
- 删除旧 api.ts 的 mockRequest 分支、ENDPOINTS 调用方、mock.ts 的 path 分发；旧兼容层不留。

### 分域顺序与每域完成条件

- [x] upstreams：上游列表/详情/创建/编辑/删改/密钥/探测/发现。
- [x] models：上游模型、公开模型、成员、价目、同步。
- [x] reports：看板 5 个报表（等 03）。
- [x] logs：列表、详情、payload、attempts、查询语法（等 01）。
- [x] admin/settings/playground 非 chat：用户、角色、连接密钥、审计、配置版本、设置、运营设置。
- 每域：定义操作 → HTTP adapter → in-memory adapter → 迁调用方 → 删旧 api/mock 分支 → vitest 单测 → 页面冒烟。

### 验收

- [x] 页面/hooks 不再直接 api.get/post；只剩 control-plane。
- [x] useMock 只在组合根；页面不知道 mock。
- [x] 旧 mockRequest path 分发、旧 ENDPOINTS 引用、旧兼容类型删除。
- [x] 离线演示（in-memory adapter）完整可用。
- [x] vitest 覆盖操作集与错误映射；全量门禁通过。

### Out of scope

- Playground chat 请求（05）；报表契约（03）；后端 API 行为改动。

### 风险

- XL，容易中途两套入口并存；按域原子迁移，ticket 未完成不合并半域。
- mock 与真实行为漂移；每域用同一组 vitest 跑两个 adapter。

## 8. 05 Playground chat module

### 现状

- 参数知识四份：web/src/lib/playground.ts:594 FORWARDED_CHAT_PARAMS、:1180 validateChatParams、:1262 chatParamsFromInput；api/src/l06_api/routers_ops.py:922-1006 relay；schemas.py PlaygroundRequest；mockStreamChat（:871）。
- 页面 import 18 个符号；params-panel 再 import 10 个。

### 设计方向

- 新 web/src/lib/chat/：params 表（允许字段/default/校验/转发）、stream 解析（SSE/thinking/usage）、sendTurn 操作；通过 04 的 transport 调用后端。
- 后端把允许参数与 relay body 映射收成一张表（Pydantic request + 单一映射），前端与 mock 不再各写一份。
- 页面/params-panel 只依赖 chat module 的少量命令与事件；删除旧 helper 直连。
- mock 流实现同一事件集，供离线演示与测试。

### 实施步骤

- [ ] 定义参数表与请求 schema；生成类型。
- [ ] 后端 relay 改单一映射；保留 stop/top_k 等现有转发。
- [ ] 实现 chat module + SSE/thinking/usage；页面接入。
- [ ] mock adapter 实现流式事件；补 vitest 假 transport 测试。
- [ ] 全量门禁 + Playground 对话冒烟。

### 验收

- [ ] 页面/params-panel 不再 import 18/10 个底层 helper。
- [ ] 参数白名单/default 只有一张表；新增字段只改一处。
- [ ] 流式、思考等级、usage、stop 行为不回归。
- [ ] 离线 mock 与真实后端事件形状一致。
- [ ] 全量门禁通过。

### Out of scope

- 不新增模型能力/UI 功能；不改数据面；不做对话历史重写。

## 9. 全量门禁

每张 ticket 完成前执行：

    cd api && python -m pytest
    cd api && python -m ruff check src tests
    python ops/contract/gen_ts.py --check
    cd web && npm run typecheck
    cd web && npm run lint
    cd web && npm run build
    cd web && npm run test
    cd web && npm run check:bundle
    node web/scripts/check-ui-foundation.mjs
    node web/scripts/check-semantic-dirty.mjs
    node ops/checks/terminology_audit.mjs

交互变化另跑 Playwright 冒烟；API 全量 pytest 从 api 目录运行，避免 scripts 模块路径问题。

## 10. 风险汇总

| 风险 | 影响 | 缓解 |
|---|---|---|
| 报表 response_model 把 money 缺省补成 null | 权限泄漏/契约错误 | 先写 RBAC 缺省测试；必要时自定义 serializer |
| 生成契约类型与手写类型并存 | 两套类型漂移 | 每域迁移后删除旧类型，禁止新增影子类型 |
| 04 体量大、半域并存 | 回归窗口长 | 按域原子迁移；ticket 未完成不合并半域 |
| 05 流式/思考/usage 回归 | Playground 不可用 | 假 transport 单测 + 真实冒烟；保留事件形状测试 |
| 无兼容层导致一次性改动大 | 合并冲突 | 按 ticket 分阶段；每阶段全量门禁 |

## 11. Ticket 索引

- 01：.scratch/architecture-deepening/issues/01-log-query.md
- 02：.scratch/architecture-deepening/issues/02-attempt-contract.md
- 03：.scratch/architecture-deepening/issues/03-report-payload.md
- 04：.scratch/architecture-deepening/issues/04-web-typed-operations.md
- 05：.scratch/architecture-deepening/issues/05-playground-chat.md
