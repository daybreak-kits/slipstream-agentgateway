# P0 · agentgateway 隔离实例行为验证（task-162）

状态：已完成 E1–E15（E9–E11 为第二轮追加；E12 额度/localRateLimit、E13 retry、E9 追加 CEL 字符串函数为第三轮；E14 状态码矩阵/route 层 retry/非 chat 透传为第四轮；E15 真实上游复验请求内重试/故障转移/流式中杀为第五轮）。实验脚本与原始日志见 slipstream/ops/experiments/ag-lab/ 与 evidence/。

执行环境：Windows 单机、agentgateway v1.7.0 官方二进制（git 26f5aebe99a36a037fe54f8080a608aca5547e15、rust 1.99.0、x86_64-pc-windows-msvc；该构建 --version 打印 "True"，版本号以 release/schema 为准）。E1–E13 期间复用 C:/Users/microsoft/agentgateway/ 内的二进制（只读）；该目录已不存在，E14 起改用从 GitHub releases 重新下载的同一构建（sha256 909b93dc…ed3c 与官方 .sha256 一致），存放于 ops/experiments/ag-lab/bin-e14/，lab.py 按 $AG_EXE → bin-e14 → 旧路径 的顺序解析。隔离端口：llm 3692 / admin 3921 / stats 3922 / readiness 3923；E14 另用纯 HTTP 网关端口 3694；自建 mock 上游 8099。全程未访问生产端口 3691 / 19004–19006。

可复现：

    cd slipstream/ops/experiments/ag-lab
    python mock_upstream.py --log-file evidence/mock.jsonl      # 终端 A，8099
    python lab.py e1        # 每个实验独立起停 AG，证据写 evidence/
    python e12_ratelimit_retry.py   # E12/E13/E9 追加：本地限流、retry 可见性、CEL 字符串函数
    python e12_followups.py         # E12 追加：metadata 拍平、reload 桶保留、30k 桶淘汰探测
    python e14_retry_status.py      # E14：状态码矩阵、route 层 retry、非 chat 端点透传
    python e15_real_upstream.py     # E15：真实上游（.env.e15）S1–S5，密钥写 .e15-tmp/*.key 并以 apiKey.file 引用

## 结论速览

| 实验 | 一句话结论 |
| --- | --- |
| E1 | 失败 target 不会在同一请求内切到另一 target（同层、跨层都 0 次）；首个失败请求把 5xx 直接返回客户端，后续请求才改走健康 target。 |
| E2 | 配置热加载生效（日志 + 路由行为双证），对在飞的 41 chunk / 8.4s SSE 流无中断、无错序。 |
| E3 | 健康状态只存在进程内：显式 eviction 连续 2 次失败后整层降级；重启 AG 后需重新累计失败，健康状态不持久。 |
| E4 | visibility: internal 模型被客户端直连返回 404 {"error":{"message":"Model not found","type":"invalid_request_error","code":"model_not_found"}}。 |
| E5 | failover.targets[].model 不能指向 virtualModel：--validate-only 直接报 "virtual model target vm-e7a does not match any llm.models entry"。 |
| E6 | AG SQLite 4 张表：request_logs（26 列，含 tokens/cost/ttft/模型/user 元数据）、request_log_payloads（prompt/completion 全量）、budget_usage（budget_id/window_start/window_end/unit/used_amount/updated_at）、迁移表；计费字段充分。 |
| E7 | 同层多 target 不是均匀分布：200 次 127/73、60 次 21/39（偏置方向每轮不同）；不同 priority 严格低值优先（30/30 全打 p1）。 |
| E8 | --validate-only 能抓 YAML 语法、未知字段、未知 provider 引用；但 priority=0 被接受。运行中写坏配置 reload 失败，旧配置继续服务；恢复后热加载成功。 |
| E9 | llm.policies.transformations 与 model 级 requestTransformation 的 request/response 头部与 body 改写全部实测生效；CEL 可用变量/函数已记录。 |
| E10 | Tokens=100 + Block：第 14 个请求开始 429 budget_exceeded（先计费后拦截，最多超一个请求）；无 modelCatalog 时 USD 预算不计数、不拦截；reload 保留已用额度，进程重启清零。 |
| E11 | keyHash: sha256:<hex> 鉴权正常；hex 大小写不敏感；明文 key 与 keyHash 可共存；未知 key 401 "authentication failed"；非法 hex 只在启动期报泛化错误。 |
| E12 | localRateLimit 是单实例内存令牌桶：key 可用 apiKey.metadata.user_id（也可用拍平写法 apiKey.user_id）；同 user_id 共享桶；type=tokens 按 prompt+completion 总量扣；tokensPerFill=0 不补充、持续 429；改 maxTokens 热加载会把桶容量改为新 max（充值可行）；重启清零；30k 个桶未见淘汰。 |
| E13 | v1.7.0 的 LLM 配置面不接受 retry：llm.policies 与 llm.models 配 retry 均 validate exit=1（unknown field），retry 只存在于 routes/backends 的 FilterOrPolicy；v1 不能靠配 retry 拿到请求级故障转移。 |
| E14 | 状态码语义：上游 4xx/429/499 一律原样透传且不触发健康驱逐；任意 5xx（含 505/520/599）原样透传但 p1 立即被降级（影响后续请求）；连接拒绝=503 + 驱逐；AG 无默认上游超时。route 层 retry 被接受且真的产生请求内重试（同后端、attempts+1 次上游命中），但完全不作用于 LLM 监听器。非 chat 端点：/v1/embeddings、/v1/images/generations 透传（前者改写模型名并记 tokens，后者不改写）；/v1/systemone 不透传（AG 按 SystemOne 协议解析，缺字段直接 400）。 |
| E15 | 真实上游（NVIDIA/OpenRouter）复验 E14：401/404 原样透传且 0 次请求内切换；流式中途断连客户端拿到截断 SSE、不切备 target（request_logs 记 200 + "response body failed"）；weighted 3:1 两批 18:2 与 15:5（抽样噪声内）；route 层 retry 在纯 HTTP 路由命中 3 次/请求，同一配置 LLM 面 5 请求仅 5 次上游命中——**E14 结论一致，不推翻**。 |

## E1 · 同层失败是否在请求内切 target（最关键）

目的：确认 AG 的 failover 是「请求内重试」还是「后续请求改选路」，直接决定 v1 的 5xx 语义与是否自己做重试。

配置：

- E1a：vm-e1 = m-fail(priority 1) + m-ok(priority 1)（同层两 target，其一恒 500）。
- E1b：vm-e1b = m-fail(1) + m-ok(2)（跨层，低层恒 500，默认健康策略）。

做法：逐请求 POST /reset 清空 mock 计数 → 发 1 个请求 → 读 /stats，判断该请求打了 1 个还是 2 个上游。

原始证据：evidence/E1-same-layer-failover.json.md、evidence/ag-e1.log、evidence/ag-e1-cross-layer.log。

观察：

- E1a（12 次单请求）：请求内同时命中 /fail 与 /ok 的次数 = 0；只打 /fail 且返回 500 的 trial = [1, 3, 6, 11]。序列：500(fail), 200(ok), 500(fail), 200(ok), 200(ok), 500(fail), 200(ok) ×4, 500(fail), 200(ok)。
- E1b（8 次单请求）：请求内同时命中 = 0；trial 1 打 /fail 返回 500，trial 2–8 全部 /ok 200。

结论：AG 不在单个请求内做跨 target 重试。首个选中的失败 target 的 5xx 原样返回客户端；健康/降级判定影响的是后续请求的选路（同层改选其它 target，或整层降级到下一 priority）。

对设计的影响：

- v1 不能宣称「请求级自动 failover」。若产品需要客户端无感重试，只能由控制面另做（v1 范围外），或把文案写成「同层/下层故障切换作用于后续请求」。GLOSSARY 的 Failover 定义需补一句「非请求内重试」。
- ADR-003 的「数据面同层选路」需明确：失败请求本身报错，健康切换是状态机行为。

## E2 · 热加载对在飞长 SSE 流的影响

目的：确认写 config → AG 自动 reload 时，已在传输的长流是否被截断/错乱。

做法：vm-e2 → m-slow（mock /slow，40 chunk × 200ms ≈ 8s）。先跑无改动对照流；再起一条同样的流，1.5s 后改写 run-config（把 vm-e7b 的 t2 优先级改为 99），观察流是否完整。随后把 vm-e7b 改成单 target m-t2，10 次请求验证 reload 真的生效。

原始证据：evidence/E2-reload-during-stream.json.md、evidence/ag-e2.log。

观察：

- 对照流：41 chunk、done=true、8.409s、无错误。
- 热加载流：41 chunk、done=true、8.261s、无错误；AG 日志在流进行中出现 18:14:42.813 state_manager loaded config from File(...)（流起于 ~18:14:41，止于 ~18:14:49）。
- 行为验证：把 vm-e7b 改为单 target m-t2 后，10/10 请求命中 /t2。

结论：文件热加载生效且不打断在飞 SSE；流式响应不受 reload 影响。

对设计的影响：adapter apply 可安全「写文件 → 等 reload」；长流不受影响，不需要排空连接。

## E3 · 健康状态是否跨重启持久

目的：确认数据面健康/熔断状态是否落盘，决定 v1 的 Ban/Cooldown 是否只能放控制面。

做法：vm-e3 = m-fail(1) + m-ok(2)，m-fail 显式 health.eviction = {consecutiveFailures: 2, duration: 45s}。先 8 次请求记录选路；停 AG（保留 data.db）→ 重启 → 再 3 次。

原始证据：evidence/E3-health-across-restart.json.md、evidence/ag-e3.log、evidence/ag-e3-restart.log。

观察：

- 重启前：500(fail), 500(fail), 200(ok) ×6 —— 连续 2 次失败后 p1 整层被跳过。
- 重启后：500(fail), 500(fail), 200(ok) —— 失败计数从 0 重新累计。

结论：健康状态仅进程内，不跨重启持久（E10 的预算计数同样重启清零，见 E10）。

对设计的影响：ADR-004 的 Ban（永久）与 Cooldown（临时）必须由控制面持久化并在渲染配置时直接剔除目标；不能依赖 AG 的健康状态表达「封禁/冷却」。AG 重启后短暂会把已封禁目标当健康，控制面要在 apply 时就排除它们。

## E4 · visibility=internal 直连行为

做法：用有效 key 直接请求 m-ok（internal）；再试无 key / 错 key。

原始证据：evidence/E4-internal-visibility.json.md。

观察：

- internal 直连：404，{"error":{"message":"Model not found","type":"invalid_request_error","code":"model_not_found"}}。
- 无 key：401，body 为纯文本 authentication failed（不是 JSON）。
- 错 key：401 同上。

结论：internal 模型名对外不可见，直连返回「模型不存在」，不会泄露其存在；鉴权失败是 401 纯文本。

对设计的影响：与 Lead 第 5 点「PublicModel 只是别名层、绝不暴露上游模型名」一致；渲染 upstream model 一律 visibility: internal。v1 对外错误体需要统一包装（AG 401 是纯文本，控制面/前端要能处理）。

## E5 · failover target 能否指向另一个 virtualModel

做法：vm-e5 的 failover.targets[].model 写成 vm-e7a（另一 virtualModel 名），先 --validate-only。

原始证据：evidence/E5-virtualmodel-as-target.json.md、evidence/cfg-e5.yaml。

观察：--validate-only exit=1，stderr：Error: virtual model target vm-e7a does not match any llm.models entry。

结论：failover 的 target 只能是 llm.models[] 条目，不能嵌套 virtualModel。

对设计的影响：IR 渲染必须把 PublicModel 打平成 upstream model target（与 v1「不做嵌套」一致）；渲染器要在 apply 前自己拒绝任何指向 PublicModel 的 Target，给出清晰错误。

## E6 · AG SQLite 表结构（计费字段）

做法：跑 3 个请求后停 AG，以只读方式读 data.db。

原始证据：evidence/E6-sqlite-schema.json.md（含建表列与样例行）。

表：request_logs、request_log_payloads、budget_usage、_agentgateway_request_log_migrations。

request_logs 26 列（计费可用）：id, started_at, completed_at, duration_ms, trace_id, span_id, http_status, error, gen_ai_operation_name, gen_ai_provider_name, gen_ai_request_model, gen_ai_response_model, input_tokens, output_tokens, total_tokens, cost, agentgateway_user, agentgateway_group, user_agent_name, has_payload, attributes_json, cache_read_input_tokens, cache_creation_input_tokens, reasoning_tokens, time_to_first_token_ms, time_per_output_token_ms。

样例行：input_tokens=5, output_tokens=3, total_tokens=8，agentgateway_user=lab-client（= apiKey 的 metadata.name），cost=None（未配置 modelCatalog/价格时为空），attributes_json 存 gateway/listener/route/endpoint/http.* 等属性。request_log_payloads：log_id, request_prompt_json, response_completion_json（accessLog.database.llm=full 时写全量，已在样例中看到完整的 messages/parts JSON）。

结论：ADR-005 的用量链路可从 request_logs 增量拉取（建议游标 started_at + id），tokens/模型/耗时/用户元数据齐全；cost/USD 只有配置 modelCatalog 后才有值（E10 佐证）。

对设计的影响：控制面账本事件字段可直接映射；USD 计费需要自建价格表（modelCatalog 或用控制面 price_version 计算），不能指望 AG 在无 catalog 时给出 cost；payload 表可留作审计/明细，但拉取要按 has_payload 控制。

## E7 · 同层分布与跨层优先级

做法：vm-e7a（t1、t2 同为 priority 1）60 次；vm-e7b（t1=1、t2=2）30 次；另加 200 次同层长跑。

原始证据：evidence/E7-distribution.json.md 与 evidence/mock.jsonl。

观察：

- 同层 60 次：/t1=21, /t2=39；同层 200 次：/t1=127, /t2=73。两轮偏置方向相反，比例约 2:1。
- 跨层 30 次：/t1=30, /t2=0（p1 健康时严格先用 p1，不用 p2）。

结论：priority 跨层语义严格（低值优先）；同层不是 round-robin，也不是均匀随机，而是带每轮偏置的随机（约 1/3 : 2/3）。健康分/延迟分的具体权重未暴露（stats/admin 端口也没有可直接读取的「健康分」字段）。

对设计的影响：v1 不要假设同层均匀；若产品需要明确权重，应使用 AG weighted routing（v1 明确不做权重，则接受「同层随机 + 健康切换」并写进 UI 说明）。E1/E3 的健康行为解释也要按「同层随机、失败后健康切换」来写。

## E8 · 写坏配置：validate 报错格式与 reload 失败回退

做法：

1. 用 4 份坏配置跑 agentgateway --validate-only -f；
2. AG 运行中把 run-config 覆盖成坏 YAML，2s 后发请求，看旧配置是否仍服务；再恢复配置。

原始证据：evidence/E8-config-errors.json.md、evidence/cfg-bad-*.yaml、evidence/ag-e8.log。

观察（--validate-only）：

| 坏配置 | exit | stderr |
| --- | --- | --- |
| YAML 语法错（adminAddr 写成 flow sequence 未闭合） | 1 | Error: invalid config: config.adminAddr: invalid type: sequence, expected a string at line 2 column 14 |
| 未知字段 config.noSuchField | 1 | Error: invalid config: config: unknown field ... expected one of enableIpv6, dns, localXdsPath, modelCatalog, database, storage, ... |
| 引用不存在的 provider | 1 | Error: model x references unknown provider does-not-exist |
| priority=0 | 0 | 空（AG 接受 0，不校验正整数） |

运行中 reload 失败：

- 日志：error state_manager Failed to reload config: did not find expected ',' or ']' at line 3 column 1, while parsing a flow sequence at line 2 column 14。
- 旧配置继续服务：请求仍 200（旧路由正常）。
- 恢复合法配置后 reload 成功，请求 200。

结论：validate-only 是可靠前置门禁（但漏 priority 正整数等业务不变量）；reload 失败不影响存量配置，audit 可直接抓 Failed to reload config 日志行。

对设计的影响：adapter apply 必须先 --validate-only，再加自己的 IR 不变量校验（priority≥1、每 PublicModel 至少一个目标等），否则 priority=0 会静默进配置。reload 失败可安全回滚（旧配置仍在），但必须记录 config_revisions 的失败状态。

## E9 · transformations：request/response 头部与 body 改写（v1 必须支持）

目的：验证 AG llm.policies.transformations 与 model 级 requestTransformation 能否真正改写请求/响应的 header 与 body，并记录 CEL 可用变量与函数。

做法（三组，均为 policy 级或 model 级配置 + 单 target vm-e9 → m-t1）：

1. transformations.request.set/add（常量 + 取 request.headers['x-trace-in']）+ response.set；
2. transformations.request.body 整包替换（body 内保留可路由 model vm-e9、messages 改写、max_tokens=7）+ response.body/header 替换；
3. model 级 requestTransformation（llm.models[].requestTransformation.set/add/body）。

原始证据：evidence/E9-transformations.json.md、evidence/ag-e9-headers.log、evidence/ag-e9-body.log、evidence/ag-e9-model-level.log、evidence/cel-variables.md、evidence/cel-functions.md。

观察：

- E9a（policy 级 header）：上游收到 x-lab-req=set-by-ag、x-lab-added=add-val、x-slipstream-trace=trace-123（取自客户端 x-trace-in: trace-123），且客户端原始 x-trace-in 也被转发；客户端响应头出现 x-lab-resp=resp-set。
- E9b（policy 级 body）：客户端响应 200，响应体被替换为配置字符串；上游收到的 messages 已被替换为 content: rewritten-by-ag、max_tokens=7。
- E9c（model 级 requestTransformation）：上游 headers x-lab-req=set-model-level、x-lab-added=add-model-level，messages/max_tokens 均按配置改写，客户端 200。
- 附带发现：第一版实验把 body 里的 model 改成非路由名（model-t1）时，客户端得到 404 —— 说明 request body 改写发生在模型解析之前，改 body 中的 model 会改变实际选路；改写 body 时必须保留可路由的 PublicModel 名（或在控制面保证不改 model 字段）。
- 另：response transformation 对错误响应同样生效（404 的错误体也被替换），排障时注意别把错误信息掩盖掉。

CEL 变量（节选，完整见 evidence/cel-variables.md）：request.method/uri/host/scheme/path/pathAndQuery/version/headers/body/bodyPrefix/startTime/endTime、response.code/headers/body/bodyPrefix、proxy.*、env.*、jwt.*、apiKey.key/metadata.*、llm.streaming/requestModel/originalModel/responseModel/provider/inputTokens/outputTokens/totalTokens/timeToFirstToken/params.*/prompt/completion/toolCalls/cost/costRates 等。

CEL 函数（节选，完整见 evidence/cel-functions.md）：json()、toJson()、with()、default()、coalesce()、mapValues、filterKeys、merge、flatten、sha1.encode/sha256.encode/md5.encode、base64.encode/base64.decode、url.encode/url.decode、form.*、regexReplace/regexReplaceAll、random、uuid、fail，以及 CEL 标准函数/字符串/数学扩展。

结论：v1 要求的请求/响应头与 body 改写能力在 AG 侧可用，policy 级与 model 级都行；CEL 变量/函数足够做 header 注入、body 字段改写、按 apiKey 元数据做条件逻辑。body 有 2 MiB 缓冲上限（默认），超限表达式不可用。

对设计的影响：

- IR 增加 transforms 块，渲染到 llm.policies.transformations.request/response（或按目标渲染到 model 级），与 Lead 第 3 点一致；
- 渲染器需禁止/警告「改写 body 中 model 字段」的规则（会改选路）；
- response 改写对错误响应也生效 → 不要用固定 body 替换生产错误体，除非刻意统一错误格式；
- CEL 求值失败时字段会被静默移除（模型级 transformation 文档明示），控制面校验只能做语法/变量静态检查。

### E9 追加 · CEL 字符串替换与大小写函数（Lead 追问）

目的：确认改写规则能不能做字符串替换、大小写转换，决定控制面「改写」能力是否要置灰。

做法：在 llm.policies.transformations.request.set 里用 CEL 表达式写 6 个请求头，跑一次 vm-e12 → m-ok：

- regexReplace: "/id/1234/data".regexReplace("/id/[0-9]*/", "/id/{id}/")
- regexReplaceAll: "id=1 id=2".regexReplaceAll("id=[0-9]+", "[ID]")
- upperAscii: "aBc".upperAscii()；lowerAscii: "ABC".lowerAscii()
- replace: "a-b-c".replace("-", "_")；trim: "  padded  ".trim()

原始证据：evidence/E12-local-rate-limit-and-retry.json.md（e9_cel_string_functions 段）、evidence/cfg-e9-cel-strings.yaml、evidence/ag-e9-cel-strings.log、evidence/mock.jsonl。

观察：validate exit=0，请求 200，上游收到的头为 x-cel-regex=/id/{id}/data、x-cel-regex-all=[ID] [ID]、x-cel-upper=ABC、x-cel-lower=abc、x-cel-replace=a_b_c、x-cel-trim=padded，全部符合预期。

文档侧（evidence/cel-functions.md）：regexReplace / regexReplaceAll 是 AG 自带函数；字符串扩展另有 charAt、indexOf、join、lastIndexOf、lowerAscii、upperAscii、trim、replace、split、substring、stripPrefix、stripSuffix。

结论：改写的字符串替换与大小写能力齐全，不需要置灰；控制面静态校验只能做 CEL 语法/变量检查（求值失败会被静默跳过或字段移除），不能代替运行时验证。

## E10 · 预算行为（Tokens/USD、reload、重启、window）

目的：验证 v1 额度方案是否可完全依赖 AG budget。

做法：llm.policies.apiKey.keys[] 配两个 key：KEY 带 budgets=[{name: tokens-100, limit:{unit: Tokens, amount:100}, window:{rolling: "30d"}, onBudgetExceeded: "Block"}]；KEY2 带 USD=1 的同样结构。用 KEY 顺序发 16 个请求（mock 每次 usage=8 tokens），再用 KEY2 发 4 个。

原始证据：evidence/E10-budget.json.md、evidence/ag-e10*.log。

观察：

- Tokens=100：第 1–13 个请求 200，第 14 个起 429；超额响应体 {"error":{"message":"budget exceeded","type":"rate_limit_error","code":"budget_exceeded"}}。（13×8=104 > 100；第 13 个仍放行，说明「先计费后拦截」，最多超一个请求。）
- USD 预算（未配置 modelCatalog）：4 次全部 200，不计数也不拦截（与 E6 的 cost=None 一致）。
- reload（同进程重写同配置）：第 5 个请求后 reload，随后第 14 个才 429 —— 已用额度保留。
- 进程重启（同一 data.db）：重启后 3 次全 200 —— 额度计数清零，未持久化。
- budget_usage 表在跑完 16 个请求后仍为空（列 budget_id, window_start, window_end, unit, used_amount, updated_at）；计数在内存中，未见落盘。
- window 对齐：schema 文档明示「aligned to the Unix epoch：1h 跟 UTC 整点、24h 从 UTC 0 点、30d 连续 30 天周期」；本次无法实测（窗口未到且表为空），标记为「文档声明、待阶段 B 用 1h 窗口实测」。

结论：AG budget 可做单实例内的软额度，但① 无 catalog 时 USD 预算完全不生效；② 计数进程重启清零 → 对 v1「用户额度要持久、要精确」而言不能单独依赖 AG；③ 超额是 429 + budget_exceeded，语义清晰。

对设计的影响：v1 额度建议以控制面账本（ledger_entries/daily_aggregates）为准做实时拦截（请求前查余额），AG budget 可作为单实例兜底（配置 window/Block，但要接受重启清零与最多超一请求）；USD 必须配 modelCatalog 自建价格表，否则 AG 不产生 cost；窗口对齐按 epoch 设计（与账本口径一致）。

## E11 · keyHash 鉴权

目的：确认能否不落明文密钥、支持哪些哈希格式。

做法：keys 里放 {keyHash: "sha256:<sha256(KEY2) 小写 hex>"} 与 {key: KEY}，分别请求；再测大写 hex、非法 hex。

原始证据：evidence/E11-keyhash.json.md、evidence/ag-e11.log、evidence/ag-e11-upper.log。

观察：

- 小写 sha256:<64 hex>：validate 0，原 key 请求 200。
- 明文 key 与 keyHash 可共存，明文 key 请求 200。
- 未知 key：401 authentication failed。
- 大写 hex：validate 0，请求 200 —— 大小写不敏感。
- 非法 hex（sha256:not-a-hex）：validate exit=1，但错误泛化为 Error: llm.policies: data did not match any variant of untagged enum LocalAPIKey at line 175 column 17（不会指出是哪把 key 的 hash 非法）。

结论：v1 可只存 sha256:<hex>（不落明文），AG 按哈希匹配；控制面需要自己校验哈希格式并给出可读错误。

对设计的影响：与 Lead 第 4 点「客户端密钥 sk- + 长度档位、默认 64、字符集规则」一致：生成后只展示一次，库中存 sha256；渲染 keys[].keyHash；明文兼容仅作过渡（或完全不支持，避免明文落盘）。

## E12 · localRateLimit 实测（额度方案是否成立）

目的：判定 v1 的额度/限流能否建立在 AG 本地限流上，尤其是「充值」能不能靠重渲染 maxTokens 生效。

配置结构（schema $defs/RateLimitSpec）：llm.policies.localRateLimit = [{maxTokens, tokensPerFill, fillInterval, type: requests|tokens, key: CEL}]。
可观测面：每个响应带回 x-ratelimit-limit、x-ratelimit-remaining、x-ratelimit-reset（秒）；超限为 429、纯文本 body "rate limit exceeded"、带 retry-after。

原始证据：evidence/E12-local-rate-limit-and-retry.json.md、evidence/E12-followups.json.md、evidence/cfg-e12-*.yaml、evidence/ag-e12-*.log；脚本 e12_ratelimit_retry.py、e12_followups.py。

### 1) key 表达式能否用 apiKey.user_id（metadata 拍平）

- apiKey.metadata.user_id：有效。两把 key 的 metadata 分别为 user_id=u1 / u2，maxTokens=2、tokensPerFill=0、fillInterval=1h；KEY（u1）三次请求 = 200,200,429；随后 KEY2（u2）请求 = 200（独立桶）。
- apiKey.user_id（拍平写法）：同样有效。同样 u1/u2 两把 key，KEY 打满后 KEY2 仍 200（独立桶）；把两把 key 的 metadata 都设为 user_id=u1 后，KEY 打满，KEY2 = 429 → 两把 key 共享同一个桶。
- apiKey.no_such_field 这种不存在的字段：两把 key 均落同一默认桶（属 schema 说明的「取不到 key 的请求共用一个桶」）。
- 结论：metadata 字段在 CEL 里两层都可读，推荐显式写 apiKey.metadata.<field>；同一个值就是一个桶，多把 key 可共享一个用户桶。

### 2) type=tokens 扣减的是 prompt+completion 还是单边

mock 上游按模型名返回不同 usage（mock_upstream.py 新增 _usage_for）：

- 默认 usage（prompt=5 / completion=3 / total=8），maxTokens=13：请求 1 = 200（remaining 13）、请求 2 = 200（remaining 5）、请求 3–5 = 429。两次共扣 16（每次 8），说明按 total_tokens 扣。
- prompt=100 / completion=0（model usage-p100），maxTokens=100：请求 1 = 200，请求 2 = 429 → prompt 计入。
- prompt=0 / completion=100（model usage-c100），maxTokens=100：请求 1 = 200，请求 2 = 429 → completion 也计入。
- 「一次扣多少」可观测：x-ratelimit-remaining 是按请求实际 total_tokens 递减的（本组 13→5→0）；429 时带 retry-after；没有单列「本次扣减」字段，需要按相邻 remaining 差值或 request_logs 的 input/output tokens 推算。
- 注意细节：请求被放行时的 x-ratelimit-remaining 显示的是「扣减前」的桶值（如 13、5），不是扣减后的值；判断桶是否耗尽要看后续请求是否 429。
- 结论：tokens 模式按 prompt+completion 总量扣减，可作 TPM 类限流；精确的「每请求扣减明细」需自建日志侧计算。

### 3) tokensPerFill=0 的表现

maxTokens=2、tokensPerFill=0、fillInterval=1h、type=requests：前 2 个请求 200，之后连续 8 个请求全部 429；等待 2s 再请求仍 429（x-ratelimit-reset 从 3598 倒数到 3596）。不报错、不会退化为不限流；它会一直拒绝到 fillInterval 到期（本次 1h 未到，用 retry-after 观察）。

结论：tokensPerFill=0 = 纯一次性配额（每窗口补充 0），适合「总量封顶」；不适合按分钟/小时自动恢复的限流。

### 4) maxTokens 调大（热加载）后桶内当前值如何变化 —— 充值能不能靠重渲染

- 主实验：maxTokens=2、tokensPerFill=0、1h；请求 1–2 = 200，请求 3 = 429（桶 0）。改写 run-config 把 maxTokens 改为 5，日志出现 loaded config from File(...)（reload_ok=true）后立即请求：200（remaining 4）、200（remaining 3）、200（remaining 2）、200（remaining 1）——桶容量变成 5，等效「充值到满额」。
- 对照实验：规则不变、只改无关字段（新增一个 virtualModel 再 reload）：桶状态保留——reload 前 remaining 1，reload 后请求 200（remaining 1）、再 200（remaining 0）。说明热加载不会无差别重置未变更的规则桶。
- 结论：充值用「重渲染 maxTokens」可行（把该限流规则的 maxTokens 调大并热加载，桶容量重置为新 max，已耗尽时等效满血）。但它不是「+N 额度」的增量语义：容量以新 max 为准，且改规则会重置该规则下桶（多 key 场景下是否所有 key 桶都一并重置本次未单独验证，见风险）。另外必须保证只改 maxTokens、其余字段不变，否则同样会触发规则变更。
- 备选/兜底：per-key budget（E10）可做 USD/Tokens 硬上限，但重启清零、reload 保留已用额度、且无「充值」语义；持久、可精确充值的额度仍应放控制面账本（请求前拦截）。

### 5) 进程重启与 LRU 淘汰

- 重启：同配置、同 data.db 重启 AG，桶归零——重启前 200,200,429，重启后 200,200。与 E3 健康状态、E10 预算计数一致：都是进程内状态。
- 淘汰：key 用 request.headers["x-bucket"] 动态造桶。先把 old 桶打满（200,200,429），再灌 2000 个、12000 个、30000 个不同桶（全部 200），old 桶重试仍是 429 → 30k 规模内未观察到 LRU 淘汰；schema 只说「每个规则保留有界数量、丢弃最少使用的」，上限与淘汰行为未暴露；/metrics 也没有 rate-limit 桶数量/命中指标（只有 gen_ai token、请求耗时、连接数等），无法观测桶数量与淘汰触发点。
- 结论：localRateLimit 只适合单实例瞬时限流（RPS/TPM/一次性总量）；不能当持久额度，也不能依赖它做跨实例一致限流。

对设计的影响：

- v1 的「实时限流」可用 AG localRateLimit：RPS/TPM 用 key=apiKey.metadata.user_id（per-user）、fillInterval 按分钟/小时；总额封顶用 tokensPerFill=0。
- 「充值/提额」可以靠重渲染 maxTokens 实现，但要按规则粒度操作，并接受「容量重置为新 max」而不是增量；同时多 key 场景的重置行为要补测。
- 持久额度、精确计费与跨重启一致性仍以控制面账本为准；AG budget/localRateLimit 都只是单实例兜底。

## E13 · retry 策略可用性与「请求内故障转移」

目的：确认 v1 能否通过 AG 的 retry 策略拿到「请求内故障转移」（同 priority 两个 target，第一个 500 时重试另一个），以及 retry 对 SSE 的影响。

做法：

1. 在 llm.policies 下配 retry = {attempts: 2, codes: [500,502,503], backoff: "50ms"}，跑 agentgateway --validate-only；
2. 在 llm.models[0] 下配 retry，再 validate；
3. 查 schema 里 RetryPolicy 的定义与所有引用位置。

原始证据：evidence/E12-local-rate-limit-and-retry.json.md（e13_llm_policy_retry、e13_model_retry 段）、evidence/cfg-e13-llm-retry.yaml、evidence/cfg-e13-model-retry.yaml、schema-config.json。

观察：

- llm.policies.retry：validate exit=1，stderr "Error: llm.policies: unknown field retry at line 234 column 17"。
- llm.models[].retry：validate exit=1，stderr 列出该对象全部允许字段（id/name/visibility/params/provider/passthrough/authorization/defaults/overrides/transformation/finalTransformation/requestTransformation/requestHeaders/responseHeaders/backendTLS/tls/auth/health/backendTunnel/guardrails/promptCaching/matches）——没有 retry。
- schema：RetryPolicy = {attempts(默认1), backoff, codes(必填), precondition(CEL，false 时禁用重试), condition(CEL，按响应决定是否重试)}，只被 $defs/FilterOrPolicy 的 retry 属性引用；FilterOrPolicy 用于 routes（LocalRoute.policies）、top-level policies（LocalPolicy.policy）、MCP。LocalLLMPolicy 的属性只有 oidc/jwtAuth/authorization/extAuthz/extProc/cors/transformations/basicAuth/apiKey/guardrails/localRateLimit/remoteRateLimit/timeout，没有 retry。
- 文档站有 Retries 页（standalone 1.6.x），但其 attach 点是 routes/backends 这类通用 HTTP 路由层，不是 LLM 简化配置面；本机 v1.7.0 校验器的行为与此一致。

结论（一句）：v1 不能通过配 retry 拿到「请求内故障转移」——v1.7.0 的 LLM 配置面根本不接受 retry（validate 直接拒绝），retry 只存在于非 LLM 的路由/后端层；因此「retry 是否重新选路」「retry 是否重试同一个后端」「retry 对 SSE 的降级影响」在 LLM 面不可达，也不应写进 v1 能力清单。与 E1 结论一致：AG 对 LLM 请求不做请求内重试，失败只影响后续选路。

对设计的影响：

- ADR/GLOSSARY 保持「非请求内重试」；产品文案不承诺 retry。
- 若未来要请求级重试，只能控制面自己做（重放请求需考虑幂等性与流式缓冲），或用更高版本 AG 并重测；升级后重点验证：retry 是否重新选 target、precondition 对流式的作用、codes 与 condition 的组合。

## E14 · 状态码矩阵、route 层 retry 实测、非 chat 端点透传

目的：① 把「哪些上游状态码会被 AG 当失败、哪些直接透传」从 E1 的单一 500 扩成 200–599 矩阵；② 实测 E13 没测的 route 层 `FilterOrPolicy.retry` 是否真的产生请求内重试、是否影响 LLM 流量；③ 验证非 chat 端点经 AG LLM 监听器的透传行为。

做法（脚本 e14_retry_status.py，一轮跑三个场景）：

1. 场景 A（无任何 retry/timeout 配置）：15 个状态码各建独立 provider（baseUrl 前缀 /sc<code>）+ model（params.model=code-<code>）+ virtualModel（target A=p1 的 code target，target B=p2 的 m-ok）。对每个码 mock /reset 后连发 3 个请求，逐请求读 mock /stats：一个请求内出现两个前缀 = 请求内切换；第 2/3 个请求换打 /ok = 驱逐。另测「上游挂起 40s」（model=code-timeout-40）与「连接拒绝」（provider 指向无监听的 8098）。
2. 场景 B（route 层 retry）：同配置加 gateways={gw-lab: 3694} + routes=[{policies.retry={attempts:2, codes:[429,500,502,503], backoff:"100ms"}, backends:[{host:"127.0.0.1:8099"}]}]。先 --validate-only；通过后在 3694 上打 /plain/<code>（恒定码）与 /plain/seq-500-200（第一次 500 第二次 200），再对 3692 的 LLM 流量重复 429–504。
3. E14b：经 3692 依次 POST /v1/embeddings、/v1/images/generations、/v1/systemone（mock 对三个后缀返回合法 JSON），看透传/改写/拒绝与 request_logs。

原始证据：evidence/E14a-status-matrix.json.md、evidence/E14a-route-retry-layer.json.md、evidence/E14b-nonchat-passthrough.json.md、evidence/cfg-e14-retry-layer.yaml、evidence/ag-e14-a.log、evidence/ag-e14-b.log、evidence/ag-e14-nonchat.log。二进制：bin-e14/agentgateway.exe（v1.7.0，sha256 909b93dc8fb5486cc0418a818b4a28fa60046cbd619013e33d1e4b20b889ed3c，与 E1–E13 的构建同 git revision）。

观察：

- 场景 A 状态码→行为对照（每码 3 个请求，counters 为该请求的上游命中）：
  - 200：正常（首请求 502 是 mock 构造物——mock 对 code-200 也返回了 error 形状 body，AG 在 LLM 路径会解析上游 200 响应体，解析失败给客户端 502 reason=UpstreamFailure，并把 p1 驱逐；这是一条独立发现：AG 不是纯透传代理，会校验 200 的 body 结构）。
  - 400/401/403/404/408/429/499：原样透传给客户端（body 为上游原文），且完全不触发健康切换——3 个请求全打 p1，target B 0 命中。
  - 500/502/503/504/505/520/599：失败请求本身原样透传（客户端拿到上游码与上游 body），请求内 0 次切换；但该请求结束后 p1 立即降级，第 2/3 个请求全走 p2（m-ok）→ 200。505/520/599 这类非标准码与 500 同等对待。
  - 上游挂起 40s：客户端 30s 超时断开；AG 日志 30s 内无任何上游超时动作，request_logs 行 http_status=NULL、error=NULL、duration≈30s——默认无上游超时，请求因客户端断开而终止。
  - 连接拒绝：第 1 请求客户端 503、body 纯文本 "connection refused"，request_logs error="upstream call failed: Connect: … (os error 10061)"、duration 2062ms；随后请求改走 p2（1 次连接失败即驱逐）。请求内仍 0 次切换。
  - 全场景 48 个 code 请求 + 拒绝/挂起：请求内切换次数 = 0（与 E1 一致）。
- request_logs（场景 A）：49 个客户端请求 → 49 行，严格 1:1（重试/驱逐/多次上游命中都不产生额外行）。trace_id 与 span_id 在所有行均为 NULL（未配 tracing 时不填充）。error 列只填 AG 自生错误（502 解析失败、503 连接失败）；透传的上游 4xx/5xx 行 error=NULL。
- 场景 B：validate exit=0（"Configuration is valid!"）——llm 段与 gateways/routes 段可共存；schema 里 retry 只挂在 routes 的 FilterOrPolicy（backends 层 LocalBackendPolicies 无 retry 字段）。运行时：3694 上 429/500/502/503 每个客户端请求上游命中 3 次（原始+2 次重试），客户端最终拿到上游码；/plain/seq-500-200 第 1 次命中 500、重试第 2 次命中 200，客户端拿到 200 → route 层 retry 真实产生「请求内重试」，且重试同一后端；504 不在 codes 内 → 1 次命中直接透传。同一配置下 3692 的 LLM 流量完全不受影响（每码 1 次上游命中、立即透传）——内部路由 internal/llm:request 挂不上这条 retry。3694 的 6 个普通代理请求完全不进 request_logs（表里只有 5 个 chat 行）。
- E14b：
  - POST /v1/embeddings：透传到 provider baseUrl 拼路径，AG 把 body 里的 vm-e14b 改写为上游名 model-ok（响应回显 model-ok），gen_ai_operation_name=embeddings，input_tokens=1（取自上游 usage）。
  - POST /v1/images/generations：原样透传，body 模型名不改写（日志 gen_ai.request.model=vm-e14b），gen_ai_operation_name=image_generation，不记 tokens（images 响应无 usage）。
  - POST /v1/systemone：不透传。AG 把该路径识别为 SystemOne 协议请求并校验 body：客户端 400 "failed to process LLM request: failed to parse SystemOne request: missing field `state`"（reason=InvalidRequest），上游 0 命中。"SystemOne" 在 schema-config.json 与二进制字符串中均出现——是 AG 内置的协议路径，不是未知路径兜底。

结论（一句）：上游状态码语义 = 「4xx 系透传不驱逐；5xx 系透传且当请求结束即降级；连接错误 503+驱逐；无默认上游超时」，任何情况下 LLM 请求内都不切换 target；route 层 retry 可用且真的重试（同后端、attempts+1 次上游命中），但与 LLM 监听器互不相通；/v1/embeddings 与 /v1/images/generations 可透传（改写行为不一致），/v1/systemone 是 AG 内置协议路径、非法 body 直接 400 不透传。

对设计的影响：

- v1 状态码语义按本矩阵定稿：客户端可见的错误码就是上游原码（4xx/5xx 全透传）；「健康切换只影响后续请求」的文案对全部 5xx 成立，4xx 不影响健康。
- 控制面若做请求级重试，不能指望 AG LLM 面（E13+E14 双证）；也不能通过给 LLM 流量套 route 层 retry 实现（不生效）。
- 非 chat 端点：embeddings/images 可直接经 AG 代理（注意 embeddings 改模型名、images 不改、images 不记 tokens）；自定义 AI 路径若与 AG 内置协议名冲突（如 systemone）会被解析拦截，控制面选路径要避开 AG 内置协议名或准备处理 400。
- request_logs 只记 LLM 协议流量；普通代理路由（3694）不进表——用 AG 做纯 HTTP 代理的可观测性要走访问日志而非 request_logs。
- 上游 200 但 body 非法 → AG 502 UpstreamFailure：上游兼容性测试（阶段 B）要包含「200 + 非 OpenAI 结构 body」的用例。

## E15 · 真实上游复验：请求内重试 / 故障转移 / 流式中杀

目的：E14 用 mock 上游测得「LLM 面请求内零重试、零切换」，用户不接受 mock 结论，要求用**真实上游**（部分故意报错、部分正常）复验同一批行为，确认 E14 结论是否成立。

环境：三个真实上游（凭据只从 ops/experiments/ag-lab/.env.e15 读取，该文件 gitignored）。SENSENOVA（sensenova-6.8-flash-lite）、NVIDIA（nvidia/nemotron-3.5-lightning-30b-a3b）、OpenRouter（nvidia/nemotron-3.5-lightning:free，仅用 :free 模型）。密钥写入临时目录 .e15-tmp/*.key（.gitignore 已加 ops/experiments/ag-lab/.e15-tmp/），配置里用 `params.apiKey: {file: ...}` 引用，证据/配置/日志一律不含明文密钥。实验期间 SenseNova 触发账号级限流（所有请求 429），故健康对照与备 target 改用 NVIDIA + OpenRouter；SenseNova 的限流本身是环境约束，不是 AG 行为。

做法（脚本 e15_real_upstream.py，每场景独立起停 AG）：

1. S1 错误 key 主目标：主 target=NVIDIA + 故意写错的 key（真实 401），备 target=OpenRouter；5 次 chat。
2. S2 编造模型名：主 target=NVIDIA + 不存在的 model（真实 404），备 target=OpenRouter；5 次 chat。
3. S3 流中终止：本地 TCP 代理（明文 HTTP 入、TLS 转发到真实 NVIDIA、收到首个响应分片后杀连接）做主 target，OpenRouter 直连做备 target；5 次流式请求。
4. S4 全健康负载分摊：OpenRouter 与 NVIDIA 同 virtualModel 用 `routing.weighted` 3:1，20 次 × 2 批。
5. S5 请求内重试复核：S1 配置 + 纯 HTTP 网关（3694）route 层 retry（attempts=2, codes=[401,404,429,500,502,503], backoff=100ms）；LLM 主 target 经**计数代理**（kills=0）转发到真实 NVIDIA，直接数上游命中次数。

原始证据：evidence/E15-S1-bad-key-primary.json.md、evidence/E15-S2-fabricated-model.json.md、evidence/E15-S3-stream-kill.json.md、evidence/E15-S4-weighted-3-1.json.md、evidence/E15-S5-retry-recheck.json.md，及对应 evidence/cfg-E15-*.yaml、evidence/ag-E15-*.log。二进制：bin-e14/agentgateway.exe（v1.7.0，sha256 909b93dc…ed3c）。

观察：

- S1：5/5 客户端拿到 **401**（NVIDIA 原文 `{"status":401,"title":"Unauthorized",...}`）；5 次全部只打主 target，备 target（OpenRouter）命中 **0**；request_logs 5 行，http_status=401、error=NULL、gen_ai_request_model=nvidia/nemotron-3.5-lightning-30b-a3b。→ 401 原样透传、请求内不切换。
- S2：5/5 客户端拿到 **404**（NVIDIA 原文 `404 page not found`）；备 target 命中 0；request_logs 5 行，model=e15-fabricated-model-xyz。→ 404 原样透传、不切换。
- S3：5/5 流式请求都只收到 **1 个 SSE 分片后连接中断**（chunks=1、done=false、客户端无异常对象，流自然结束）；代理 5 次全部触发 kill；备 target（OpenRouter）**0 命中**；request_logs 5 行均为 http_status=200、model=nvidia/nemotron-3.5-lightning-30b-a3b、error=`response body failed: error reading a body from connection`。→ **流式一旦吐出首片就不可切换**，客户端拿到截断的 SSE，不会续到备 target。
- S4：第 1 批 20 次 200（OpenRouter 18 : NVIDIA 2）；第 2 批 20 次 200（OpenRouter 15 : NVIDIA 5，恰好 3:1）；合计 33:7 ≈ 4.7:1，配置为 3:1。两批各自的偏差都在 n=20 的抽样噪声内（第 2 批正好是 3:1），未见 AG 违反权重；小样本下方差较大，若 v1 要严格比例需加大样本或改用 round-robin。
- S5：route 层 retry 在纯 HTTP 路由上真实生效——401、404 每个客户端请求上游命中 **3 次**（原始 + 2 次重试），客户端最终拿到上游码；同一配置下 LLM 面 5 个客户端请求只产生 **5 次上游命中**（计数代理直接计数），客户端拿到 401，request_logs 5 行。→ **route 层 retry 完全不作用于 LLM 监听器**，与 E14 一致。耗时也佐证：S5 的 5 次 LLM 请求 duration 401–562ms，与无 retry 的 S1（131–389ms）同量级；若真重试 2 次，应多出约 2×上游往返 + 200ms backoff。
- request_logs（全场景）：严格 1 请求 1 行（S1/S2/S5 各 5 行、S3 5 行、S4 每批 20 行）；trace_id / span_id 全部为空（未配 tracing）；gen_ai_provider_name 恒为 openai；透传的 4xx 行 error=NULL；只有 AG 自生错误（S3 的 response body failed）才填 error。

一致性判定（E15 真实上游 vs E14 mock）：

- **一致**。E14 的四条核心结论在真实上游下全部复现：① LLM 请求内不切换 target（S1 401、S2 404、S3 流中断均为 0 次切换）；② route 层 retry 只作用于纯 HTTP 路由、不作用于 LLM 监听器（S5：plain 3 次命中 vs LLM 5 请求 5 次命中）；③ request_logs 1 请求 1 行、trace_id 不填充、只记 LLM 流量；④ 上游 4xx 原样透传（S1 401、S2 404 客户端可见）。
- E15 新增的观测（E14 未覆盖）：**流式响应中途断连时，AG 不会切到备 target**，客户端拿到截断的 SSE；request_logs 记为 http_status=200 + error="response body failed: error reading a body from connection"。这与「非请求内重试」是同一语义的流式版本。
- 未发现任何与 E14 矛盾的行为，因此**不推翻**「请求内零重试」结论；E14 的 mock 结论在真实上游下成立。

对设计的影响：

- 「LLM 面请求内不重试/不切换」已由 mock（E14）+ 真实上游（E15）双重验证，v1 控制面若需要请求级重试必须自己做，不能依赖 AG。
- 流式一旦开始吐字即不可切换：v1 的「失败转移」只能作用于尚未产生首字节（或首字节前）的请求；已经开始的 SSE 只能中断并让客户端重试。
- 纯 HTTP 路由的 route 层 retry 可用，但 LLM 流量走的是内部路由 internal/llm:request，套不上；v1 若统一网关，需区分两类流量。
- request_logs 对「上游已断但 HTTP 头已回 200」的流式失败会记 200 + error，账本/告警不能只看 http_status，要同时看 error 列。

## 对 v1 设计的影响汇总

1. 路由语义：priority 分层严格；同层随机（约 1/3:2/3 偏置）；失败不请求内重试，只影响后续选路。GLOSSARY/ADR-003 需补「非请求内重试」。
2. 健康/熔断：E1b 默认 1 次 5xx 即可让整层降级；E3 显式 eviction 需连续 N 次。健康状态进程内、重启清零 → Ban/Cooldown 只能控制面持久化并渲染剔除。
3. internal：对外 404 model_not_found，不暴露上游模型名；与 PublicModel 别名层一致。
4. failover target：只能是 llm.models[]，不能嵌套 virtualModel → IR 渲染必须打平。
5. 热加载：文件 watcher 自动 reload，失败保留旧配置；在飞 SSE 不受影响；AG 启动会把 config.session.key 写回配置文件（apply 的 config hash 读回要容忍/排除该字段）。
6. 校验：--validate-only 可抓语法/未知字段/未知 provider，但不校验 priority 正整数；控制面必须自校验 IR 不变量。
7. 计费/账本：request_logs 字段足够（tokens/cost/模型/user/ttft/tpot/error）；无 modelCatalog 时 cost 为空、USD 预算不生效 → 价格需自建；预算计数重启清零。
8. 改写能力：header/body 的 request/response 改写在 policy 级与 model 级都可用；CEL 变量/函数充足；注意 body 改写会改变选路、response 改写会覆盖错误体。
9. 鉴权：keyHash 支持 sha256 hex（大小写不敏感）、可与明文共存；鉴权失败 401 纯文本。
10. 限流（E12）：localRateLimit 是单实例内存桶；per-user 用 key=apiKey.metadata.user_id；tokens 模式按 prompt+completion 总量扣；tokensPerFill=0 不补充；改 maxTokens 热加载把桶容量重置为新 max（充值可行，但不是增量语义）；重启清零；30k 桶未见淘汰、无桶指标。
11. retry（E13）：v1.7.0 的 LLM 配置面不接受 retry（llm.policies/llm.models 均 validate 拒绝），不能配置请求内重试；文档里的 retry 属于非 LLM 路由/后端层。
12. CEL 字符串函数（E9 追加）：regexReplace / regexReplaceAll / upperAscii / lowerAscii / replace / trim 均可用，改写能力不需要置灰。
13. 状态码与 retry（E14）：上游 4xx/429/499 透传不驱逐、5xx（含 505/520/599）透传后降级、连接拒绝 503+驱逐、无默认上游超时；请求内切换在任何码下都是 0 次。route 层 retry 真实产生请求内重试（同后端）但绝不作用于 LLM 监听器；request_logs 1 请求 1 行、trace_id 不填充、只记 LLM 流量。/v1/embeddings、/v1/images/generations 可透传（前者改写模型名、后者不改写、后者不记 tokens），/v1/systemone 是内置协议路径会被解析拦截（缺字段 400）。
14. 真实上游复验（E15）：NVIDIA/OpenRouter 真实 401/404 原样透传、0 次请求内切换；流式中途断连不切备 target（客户端拿截断 SSE，request_logs 记 200 + error）；weighted 3:1 实测 18:2 与 15:5（n=20 抽样噪声内）；route 层 retry 纯 HTTP 3 次/请求 vs LLM 5 请求 5 次命中——E14 结论在真实上游下成立。

## 与 Lead 第二轮决策的交叉

- 上游单密钥（upstreams.api_key_enc）：AG provider params.apiKey 支持字符串或 {file: path}；v1 建议渲染为 {file: ...} 或注入进程环境，本实验用字符串已验证可用。
- 多管理员 RBAC / users：与本 P0 无关；AG 侧 agentgateway_user 已能记录 apiKey metadata.name，可作账本维度。
- 头/体改写在 v1 必须支持：E9 证明 AG 侧完全可用，IR 增加 transforms 即可。
- 客户端密钥格式（sk- + 档位长度）：E11 证明可只落 sha256；长度/字符集是控制面生成规则，与 AG 无关。
- PublicModel 仅别名：E4/E5 共同证明 internal 模型不可直连、target 不能指向 virtualModel → 别名层与 target 打平不会暴露上游名。
- 表格分页：与本 P0 无关。
- 生产端口：本 lab 用 3692/3921–3923 + 8099；生产 3691/1900x 未触碰；新实例若上 3600 属独立端口，符合「新增独立实例」要求。

## 未完成 / 风险 / 建议下一步

- window epoch 对齐未实测（E10）：需要 1h 窗口 + 跨 UTC 整点观察；建议阶段 B 用短窗口验证。
- 健康分内部权重不可见：E7 只能看到分布偏置，无法读到「健康分+延迟」具体公式；若 ADR-003 需要解释，建议阶段 B 做延迟注入实验。
- AG 响应透传上游 Server 头（见 E4/E11 响应头 Server: BaseHTTP/0.6 Python/3.13.14）：v1 若不允许泄露上游实现，需用 response remove 头规则。
- 429 语义：AG budget exceeded 用 429 rate_limit_error，需与 v1 的错误码/前端提示对齐。
- config 被 AG 回写 session.key：apply 的「读回确认 config hash」需排除该字段或使用 AG 管理接口，否则每次 apply 都会 hash 不一致。
- E2 只验证了「文件 watch」路径；若 v1 用 admin API 写入配置，需另测。
- E12 只测了单 key 的 maxTokens 热加载：改规则是否把同一规则下所有 key 的桶一起重置、降低 maxTokens 时桶如何裁剪、fillInterval 到期后的实际补充节奏，均未测（建议用 1m/1s 短间隔补测）。
- localRateLimit 的桶上限/LRU 触发点不可观测：30k 个桶未见淘汰，/metrics 无 rate-limit 桶指标；若 v1 依赖淘汰行为需读源码或用极端基数压测。
- E13 只证明了 LLM 配置面不能配 retry；route/backend 级 retry 已由 E14 实测：route 层产生请求内重试（同后端）但不作用于 LLM 流量；backend 层无 retry 字段。仍未测：route 层多后端时 retry 是否换后端、precondition/condition 对流式的作用（不属于 v1 LLM 方案）。
- E14 遗留：上游挂起仅观察到 30s（客户端断开终止），AG 是否存在更长默认上游超时未测；llm.policies.timeout 配置行为未验证。images 端点不记 tokens，意味着 images 类流量的预算/账本（E10/E6 链路）在 AG 侧无用量数据。/v1/systemone 只测了「非法 body 被 400」；构造合法 SystemOne 请求会得到什么（代理到上游还是继续拦截）未测。E14a 中 code-200 的 502 由 mock 的 error 形状 body 触发，属于有意构造的兼容性用例，不是环境故障。
- E15 遗留：SenseNova 在实验期间触发账号级限流（429），未能作为健康对照；若需三上游交叉，建议错峰或换 key 重跑。weighted 3:1 两批 18:2 / 15:5，小样本方差大，若 v1 要严格比例需加大样本。S3 的「流中断」用本地代理模拟，未覆盖真实上游 TLS 层断连（语义应相同，但真实网络抖动形态更多）。E15 只测了 401/404 两类错误码，5xx 与连接拒绝的真实上游行为仍沿用 E14 的 mock 结论。

## 原始证据索引

- 实验脚本：slipstream/ops/experiments/ag-lab/lab.py（python lab.py e1…e11）、mock_upstream.py（--port/--log-file）
- 配置模板：slipstream/ops/experiments/ag-lab/config.yaml（基线）、run-config.yaml（每次实验生成/被 AG 回写）、evidence/cfg-*.yaml
- schema：slipstream/ops/experiments/ag-lab/schema-config.json（v1.7.0）
- 各实验 JSON 证据：evidence/E1-same-layer-failover.json.md … evidence/E11-keyhash.json.md
- AG 运行日志：evidence/ag-<exp>.log；mock 请求日志：evidence/mock.jsonl
- CEL：evidence/cel-variables.md、evidence/cel-functions.md、evidence/cel.json
- E12/E13/E9 追加脚本：slipstream/ops/experiments/ag-lab/e12_ratelimit_retry.py、e12_followups.py、probe_metrics.py；证据 evidence/E12-local-rate-limit-and-retry.json.md、evidence/E12-followups.json.md、evidence/cfg-e12-*.yaml、evidence/cfg-e13-*.yaml、evidence/ag-e12-*.log、evidence/ag-e9-cel-strings.log
- E14 脚本：slipstream/ops/experiments/ag-lab/e14_retry_status.py；证据 evidence/E14a-status-matrix.json.md、evidence/E14a-route-retry-layer.json.md、evidence/E14b-nonchat-passthrough.json.md、evidence/cfg-e14-retry-layer.yaml、evidence/ag-e14-a.log、evidence/ag-e14-b.log、evidence/ag-e14-nonchat.log；二进制 ops/experiments/ag-lab/bin-e14/agentgateway.exe（v1.7.0，sha256 与官方 release .sha256 一致）
- E15 脚本：slipstream/ops/experiments/ag-lab/e15_real_upstream.py（凭据读 .env.e15，key 写 .e15-tmp/*.key 并以 apiKey.file 引用；含 KillProxy 流中杀代理与计数代理）；证据 evidence/E15-S1-bad-key-primary.json.md、evidence/E15-S2-fabricated-model.json.md、evidence/E15-S3-stream-kill.json.md、evidence/E15-S4-weighted-3-1.json.md、evidence/E15-S5-retry-recheck.json.md、evidence/cfg-E15-*.yaml、evidence/ag-E15-*.log
- mock 上游新增 usage 变体：模型名含 usage-p100 时返回 prompt=100/completion=0，含 usage-c100 时返回 prompt=0/completion=100（mock_upstream.py 的 _usage_for）；响应头 x-ratelimit-* 与 429 证据见 E12 两组 JSON。
- mock 上游 E14 新增端点：模型名 code-<N> 返回状态码 N、code-timeout-<s> 挂起、POST /plain/<spec>（纯数字恒定码、seq-<N>-200 首败后 200、slow-<ms>）、任意前缀 /embeddings、/images/generations、/systemone 返回合法 JSON（mock_upstream.py do_POST）。
