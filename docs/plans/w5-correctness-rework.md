# W5 规划：界面纠偏、数据正确性与多密钥收尾（一次全做，先规划后确认）

状态：**W1–W4 全部已实施并合入 `w5/integration`**（ticket 01–16，2026-11-21）；ticket 17 完成文档/契约/术语/ADR 收口，ticket 18 负责全站浏览器验收。W1.7 于 2026-11-20 先行落地（ADR-028）。本文件保留为实现记录。
依据：十张红框截图（2026-11-20）、用户 Q1–Q9 与最终澄清（m03093 / m03174）、五份审计（m03154 / m03158 / m03163 / m03167 / m03171）、E17–E20 证据、DESIGN-AUDIT / GLOSSARY / api-contract。
术语：上游渠道、公开模型、上游模型、成员、模型拉取、模型探测；不再使用「渠道」单用、不再使用「浅/深探测」。

## 0. 完成定义（DoD）

1. 十张截图诉求与 Q1–Q9 全部落地，审计偏差表逐项关闭（改实现或改文档，二选一并记录理由）。
2. 后端契约、ADR、GLOSSARY、DESIGN-AUDIT、api-contract、plan、ACCEPTANCE 与实现同步；术语审计 0 error。
3. 门禁全绿：全量 pytest、ruff、tsc、eslint、vite build、check-bundle、check-ui-foundation、terminology、route/acceptance 脚本。
4. 浏览器穷举：所有改动页面 + 关键交互（冷却互斥、探测、分流隐藏、日志尝试、公开模型单保存、脏标记）逐项通过，截图留证；0 console error。
5. 密钥零泄漏、临时进程零残留、工作区只留应提交文件。

## 1. 设计决策（D1–D14）

D1 表格操作列统一：所有带有行操作的表格，操作列固定为最后一列并 sticky 冻结在尾部（桌面与窄屏一致，Excel 冻结窗格语义）；表头与单元格垂直居中、字号与行高分层；列定义新增 align / sticky 元数据，由 DataTable 与 ModelsTable 共用。理由：截图 2、用户 Q2 明确要求不被收进横向滚动。
D2 数字口径：计数（请求数、词元、TPM、输入/输出 tokens、尝试次数）一律千分位整数，不用小数、不用 565.92K 这类带小数紧凑格式；RPM 保留 2 位小数；百分比 1 位小数；金额表格 2 位小数，单请求均值 4 位小数，取消 6 位；格式化函数收敛到 lib/format.ts 单一来源，组件内 format 模块删除或改为 re-export。理由：截图 1、Q1、DESIGN-AUDIT §5 单一来源。
D3 分流图：以完整五元组路径为最小聚合单位，隐藏阶段改为后端路径投影（query 参数 collapse），前端不再做 splice/金额复制/笛卡尔积；节点与边严格守恒；可见阶段少于 2 时显示空态并禁止继续隐藏；阶段色按 stage id 固定，不随隐藏偏移；不引入缩放（用户明确不需要）。理由：截图 5/6、Q5、recon-flow 的膨胀复现（2000→6000→20253）。
D4 日志模型列：第一行=客户端请求的模型，第二行=实际响应的上游模型；两行间用轻分割，不混入流式/priority/接口类型；「N 次尝试」以行内小按钮呈现，点击打开路由链 popover（每行：上游渠道 · 实际模型 · 错误摘要；展开显示每次尝试的状态码/耗时/上游地址），复用详情抽屉的 TraceChainSection 抽成公共组件。token 记账列形状不变（E17-T2c 已证完整形态照常填充）。请求模型不需要新增埋点：M2 混合形态的 AG 请求日志 attributes_json 里已有 agw.ai.original_model（客户端请求的公开模型名；探针库 .scratch/e17m2probe2/llm1/data.db 实证 original_model=pub-a、gen_ai_request_model=up-a），解析它即可；旧行/无该字段显示 —。attempts 来自适配器归一化的请求尝试记录（D14/W1.7），不直接依赖 OTel/trace_spans。
D5 上游模型编辑：改为右侧满高抽屉（100vh，宽 760–860px，窄屏全屏），不再是 2xl 小弹窗；抽屉内分组承载基本信息、能力、价格/参数、状态与冷却；底部固定 取消 / 保存（单主按钮）；启用/关闭与冷却都进入抽屉，行内只保留快捷入口。理由：截图 7、Q6、Q8。
D6 冷却互斥与解除：单次冷却生效期间禁止创建/改期周期规则；周期窗口生效期间禁止设单次（窗口外、已 skip 后可设）；后端 409 CONFLICT 返回阻塞规则与窗口结束时间；行内按钮冷却中显示「解除」而非双按钮；「解除」语义=清除当前生效冷却（单次规则删除 + 若命中周期窗口则跳过本窗口），不做全局清规则；周期规则的管理在抽屉内。新增 ADR-027 取代 ADR-004 的叠加口径。理由：截图 6、Q6、冷却审计的假文案与空操作。
D7 上游渠道测试：列表页删除全局串行 test-connection mutation，行内「测试」只做快速跳转到详情页路由与模型 Tab（带 query 参数定位）；路由与模型 Tab 改名并承载模型级「测试」与「全部测试」；模型拉取（GET /models）保留为独立按钮，不与探测混用。探测=对单个模型发最小 chat（max_tokens=16），不持久化状态，结果仅会话内展示；密钥逐把测试仍留在连接与模型 Tab。理由：截图 7、Q7、recon-model-editor。
D8 编辑/保存的颜色语义：凡有「保存」的表单（上游编辑、模型抽屉、公开模型编辑器、网关策略卡）统一 dirty 标记：变更字段左侧 2px 警示色条 + 浅色底 + 行内「已修改」点；区块标题显示未保存数量；底部出现「未保存 N 项」与恢复该项；保存成功后清除标记，按钮回中性禁用；保存中显示进度。语义色：启用=成功绿，关闭=警示琥珀，冷却=警示琥珀，解除=成功绿，测试=信息蓝，删除=危险红，编辑=中性；全部图标+文字双编码，不允许只靠颜色。理由：Q6 最后一句、截图 6/7 的语义色缺失。
D9 公开模型编辑器：合并为单页（无 Tab），页头 h1 + 状态 + 脏标记 + 单一「保存」；页面三段：基本信息（名称/策略/备注/启用）、成员编排（chip 流）、只读摘要（当前渲染语义提示）；保存按依赖顺序在服务端一次事务完成（新增合并保存端点，避免 PATCH+PUT 半成功），见 W1.5。成员 chip 名称统一为「上游渠道/模型」，如 zai-01/glm-5.3；按优先级分层分组展示（第 1 层…），同层 P2C 平权；conditional 模式必须显示顺序与末位兜底标签；点击 chip 编辑 priority/weight/when；候选区按上游渠道分组可折叠、搜索命中渠道或模型；保留「至少一个成员/去重/兜底末位」校验。理由：截图 8/9/10、Q8/Q9、旧系统参考。
D10 多密钥收尾：seed 演示改「一个 zai 渠道 + 3 把密钥」；跑迁移并校验；用量归因前剥去 provider 名的 # 序号后缀；has_api_key 改由 key_count 派生或删除；apply 后按白名单清理旧 key 文件；补充 # 在 provider 名与文件名上的跨平台回归（保留 # 形态，E18 已证 validate/运行可接受）；conditional 多密钥只展开首把的限制写入文档与 UI 提示（E20 裁决，不是实现遗漏）。理由：Q9、multikey 审计八项偏差。
D11 流式/重试与 attempt 展示边界：首字节后不切换（E14/E17）继续在冷却/重试卡片与路由链中如实提示；每次客户端请求仍只记一条 request_logs；attempts 来自适配器归一化的 request_attempts（D14），适配器无该能力时显示「无链路记录」而不伪造。理由：既有 ADR-024 边界与 E19 裁决。
D12 观测数据链路：为支撑 D4，/admin/logs 批量补 attempts 与 trace 可用标记；请求模型直接取 request_logs.attributes_json 的 agw.ai.original_model（缺失显示 —，见自检第 3 条）；请求尝试链由适配器负责采集/归一化（D14/W1.7）；系统只保留领域 attempts 与留存策略，不暴露 tracing 传输参数。
D13 安全：模型探测端点必须鉴权 model_write、只接受本系统已存上游与模型、不允许任意 base_url、超时与响应截断、错误信息脱敏；key 文件清理只允许删除受管目录内、当前配置集合之外的旧文件；任何测试 key 只在 gitignored 临时目录出现。

D14 适配器遥测边界（重构，取代系统级 OTel 方案）：系统不定义 OTLP 接收器、不存 trace_spans、上层不出现 trace/span/attributes 等 OTel 概念。系统只定义领域对象「请求尝试链」：一次客户端请求的逐次上游尝试（序号、上游渠道、模型、状态码、错误、耗时、是否触发切换），存系统自有表 request_attempts，字段按展示/留存/审计需求设计。适配器负责产生这些事实：AG 适配器在自身模块内实现 OTLP 接收/解码/映射（loopback 仅本机监听、无会话鉴权、8MB 体积限制、生命周期全归适配器），通过 AttemptSink 端口写入归一化记录；未来 LiteLLM/自研适配器用 callback/DB/事件实现同一端口。系统不暴露 /admin/traces，不保存 span 树；UI 只读 /admin/logs/{id}/attempts，适配器无该能力时灰显/隐藏。tracing 的 host/port/randomSampling 是适配器内部渲染细节，不再由系统设置页暴露；产品层只保留「记录请求尝试」能力开关。理由：用户指出追踪属于适配层，换 AG/自研/LiteLLM 时上层与 DB 不变；OTel 只是 AG 适配器的实现选择。

## 2. 工作包（W1 后端 → W2 原语 → W3 页面 → W4 文档与门禁）

### W1 后端正确性（前端依赖，先做）

W1.1 分流路径投影
- api/src/l05_service/aggregates.py：build_flow 增加可选 hidden_stages（或 collapse）与 top_n；按五元组路径投影后累加节点/边，金额锚定可见首边/末边；默认参数保持现有输出逐字节不变（test_reports_sql_parity.py:1112-1125 不得改）。
- api/src/l06_api/routers_reports.py:398：接 collapse/top_n，参数校验（阶段 id 白名单、去重、至少保留 2 段）；错误 422。
- docs/api-contract.md:500 补语义；api/tests 增加：32 种隐藏组合守恒、与 legacy 默认一致、TopN 其他节点守恒、非法阶段。
- 验收：任何隐藏组合下，首可见段入边合计=total metric，末可见段出边合计=total，无凭空边；H=空时输出不变。

W1.2 冷却互斥与解除
- api/src/l05_service/availability.py：新增 active_single_cooldown / active_periodic_window helper（复用 _matching_window/_window_end_ms）；create_rule/update_rule/set_model_cooldown 加冲突校验；update 仅在 kind/recurrence/expires/schedule 变化时校验，note-only 放行；解除语义按 D6 拆分/归一；写 skip 与删除单次后立即触发 apply，修复 rules_changed_since 对新建/删除不敏感（或所有可用性变更后主动重渲染）。
- api/src/l06_api/routers_availability.py、routers_models.py、schemas.py：409 CONFLICT + details{blocking_rule_ids, cooldown_until_ms, window_end_ms}；批量冷却返回 failed 明细；公开模型 scope 写冷却拒绝并说明。
- api/tests：改写 test_availability.py:365-373/:458-483、test_model_management_api.py:396-450；新增窗口内/窗口外/skip 后/跨午夜/时区/批量/note-only/409 details/apply 触发用例。
- 验收：UI 不再出现双按钮与空操作 toast；任何新写入都不可能产生单次+周期同时生效。

W1.3 日志 attempts 与请求模型
- api/src/l06_api/routers_ops.py:583-716：/admin/logs 返回 attempts_count/has_attempts（批量查 request_attempts group by correlation_key，一页一次查询）；行级 error 能用 attempt 状态/error_type 补齐 4xx/5xx 摘要。
- 请求模型：解析 request_logs.attributes_json 的 agw.ai.original_model（M2 混合形态实证存在；full-form 直连行可能没有），在 _row_to_event / logs API 暴露 requested_model；不要打开 payload 正文日志，不做 accessLog CEL、也不做成员反推。
- 数据边界：attributes_json 可能非 JSON/缺字段，解析失败按空处理；历史行显示 —；不改变 usage_ledger 的 public_model/归因语义（账本仍用最终上游模型）。
- api/tests：attributes_json 正常/缺字段/坏 JSON、无 span 降级、批量查询性能断言（一页 1 次额外查询）。
- 验收：适配器提供 attempts 的行能列出 N 次尝试；无能力显示无链路；模型两行不伪造。

W1.4 模型探测
- 新增 POST /admin/upstreams/{id}/models/probe，body {model_ids[] | model_id, key_id?}，鉴权 model_write；逐模型用选定/第一把启用密钥发最小 chat（max_tokens=16，超时 20s），串行执行，返回 {model, ok, status, latency_ms, error_type, message(截断脱敏)}。
- 复用 upstream_ops 的 URL/鉴权/API style 解析；不持久化；结果只返回本次。
- api/tests：成功、上游 401、超时、非法模型、非本上游模型、权限 403、密钥选择、错误脱敏；mock 上游。
- 验收：全部测试最多 22 个模型时进度可控、可取消（前端中止请求）；不破坏现有 test-connection。

W1.5 公开模型合并保存
- 公开模型更新只保留一个端点：扩展现有 PATCH /admin/public-models/{id} 接受可选 targets（其余字段保持），服务端在同一事务内完成基本字段 + routing_mode + enabled + targets 整批替换；按最终状态校验（conditional 进出、兜底末位、去重）。
- 删除 PUT /admin/public-models/{id}/targets 及 PublicModelTargets schema，不留兼容层、不留别名；所有调用方（web api、编辑器、测试、文档、acceptance）同步改到 PATCH；批量端点保持独立。
- 权限：PATCH 基础权限 public_models:write；请求体含 targets 时额外要求 model_targets:write，缺权限 403。
- api/tests：更新/删除原 PUT targets 相关用例；组合变更成功、conditional 顺序、部分失败回滚（单事务）、权限组合、重复成员、兜底位置；全仓 grep 确认旧路径零引用。
- 验收：UI 单次保存不会出现「基本信息已改、成员未改」的半成功；旧端点不存在（404）。

W1.6 多密钥收尾
- seed_demo.py:105-112/:293-299 改一渠道三密钥 + failover 演示；api-contract.md:649-650 计数同步；验收脚本/文档同步。
- 迁移：确认 migrate_multikey_v2 在新库/旧库的触发路径，执行并校验本机 8 旧库；迁移文档写清。
- usage_ingest.py:403 归因前剥 #序号；has_api_key 派生或移除（routers_upstreams.py:73、api-contract.md:341、web shared.ts:7-11）。
- rendering 后 key 文件 prune（rollout.py:75-90 增白名单清理），清掉本机 90 个旧文件；补测试；# 文件名/ provider 名跨平台回归；清 is_primary 死列与 primary_key_plaintext 命名（可放最后低风险提交）。
- 验收：演示数据一个 zai 渠道 3 把 key；账本 provider 不再退化；keys/ 无陈旧文件。

W1.7 适配器遥测边界与请求尝试链（取代系统级 trace receiver）
- 领域：l02 新增 RequestAttempt 值对象（attempt_no、upstream_ref、model、status_code、error_type、error_message、started_at_ms、duration_ms、outcome）与 AttemptSink 端口；控制面表 request_attempts（correlation_key、attempt_no、upstream_ref、model、status_code、error_type、error_message、started_at_ms、duration_ms、adapter_id、recorded_at_ms；索引 correlation_key/started_at），删除 trace_spans 表、trace_receiver 模块与 /admin/traces/{trace_id}。
- 适配器 SPI：新增能力 observe.request_attempts 与遥测生命周期（start/stop/sink，等价于第九个端口方法）；上层只依赖归一化 Attempt 记录，不知道 OTLP/trace/span。AG 适配器把现有接收器移入 l03_adapters/agentgateway/telemetry.py（loopback+8MB+白名单解码保留为适配器内部实现），解码后映射 RequestAttempt 经 sink 入库；l06/server 不再 import trace_receiver，只启动适配器遥测端。
- 映射：trace_id → correlation_key；client span 按 (start_ms, span_id) 排序 → attempt_no（1 起），upstream_ref 由适配器渲染时登记的上游 base_url 路径最长前缀还原（歧义/取不到时保留 path）；model 取根 span gen_ai.response.model 或 gen_ai.request.model；http.status/error.type/duration → 领域字段；span 树、span_id、parent、attributes_json 一律不入库。
- 系统 API/UI：/admin/logs 批量附 attempts_count/has_attempts；/admin/logs/{id}/attempts 返回归一化 attempts；删除 /admin/traces 与前端 TraceSpan 类型；路由链 popover 改用 RequestAttempt。
- 配置：删除系统设置页/网关策略页的 tracing host/port/randomSampling；AG 适配器内部默认生成 loopback+token tracing 配置；IR 只保留适配器能力开关（observe.request_attempts），不把传输细节带进上层。
- tests：AG 映射单测（root/client、顺序、错误、截断/无 span）、sink 幂等/主键、能力灰显、旧 trace_spans 删除迁移、API/DB 无 OTel 字段、AG --validate-only 验 tracing path。
- 验收：mock adapter 实现 attempts 端口后上层 API/UI 不变（可换性演练）；AG 路由链可用；LAN 4318 不可达；仓库 grep 无 trace_spans/OTLP 出现在 l05/l06 以上层。
- **实施状态（2026-11-20）**：后端（RequestAttempt/AttemptSink/request_attempts/telemetry.py/能力 observe.request_attempts/API）+ 前端（路由链改读 attempts、策略页 tracing 卡删除、mock/contract 重生成）+ 文档（ADR-028、adapter-spi §2.2、api-contract、DELIVERY、CHANGELOG、m5-a/b 取代标记）已完成；ruff/tsc/eslint 绿，全量 pytest 待重跑确认。**未做**：mock adapter 可换性演练、LAN 4318 不可达实测、历史 trace_spans 迁移（设计为不迁移，直接删除旧表）。安全口径修正：接收器只监听 loopback，无 path token（token 未实施，D14 原文已改）。

### W2 前端设计原语

W2.1 DataTable / ModelsTable
- web/src/components/data-table.tsx：ColumnMeta 增 align/sticky；最后一列自动 sticky right，单元格 bg-surface、hover 同步、左侧 inset 阴影；TH/TD 统一 items-center 与 py 对齐；header 与 body 字号分层；横向滚动容器、行选择、展开行兼容。
- web/src/components/ui/table.tsx、web/src/components/models/table.tsx：同步对齐规则。
- 全站应用：upstreams、client_keys、models 两表、models-panel、config_revisions、audits、roles、users、gateway-policies、logs（如有操作列）。
- check-ui-foundation 增加断言：操作列 sticky、表头单元格垂直对齐类、ACTION_ICONS 单一来源。

W2.2 格式化单一来源
- web/src/lib/format.ts 定义 fmtInt / fmtCount（仅图表轴，无小数）/ fmtRpm / fmtMoney / fmtMoneyAvg / fmtPct / fmtDuration；删除或 re-export web/src/components/governance/format.ts、web/src/components/logs/format.ts、web/src/components/dashboard/chart-format.ts、web/src/lib/duration.ts 的重复实现。
- KPI 词元/TPM 用 fmtInt；RPM fmtRpm；settings tile 用 fmtInt；logs 费用两行；缓存命中率 1 位小数；金额按 D2。
- check-ui-foundation 增加「不得新增本地 format 模块」扫描。

W2.3 语义色 / KPI
- web/src/index.css：--info 收敛为可辨识的信息蓝灰（与状态 badge 同步评估）；新增/复用语义 tone 映射（primary/success/warning/info/danger/neutral）。
- metric-icons.ts：8 卡重新分配（请求 Activity/primary、RPM primary、词元 Layers/info、TPM info、缓存 Zap/success、费用 Receipt/warning、成本毛利 Wallet/success、P50 Timer/info）；图标统一 16px，tint 12%。
- check-ui-foundation 锁 8 键与 tone 集合；浏览器截图对比轻盈度。

W2.4 脏标记与保存语义
- 新增 web/src/components/forms/dirty-field.tsx 或 useDirtyFields hook + CSS token（warning 边条/浅底/点）；区块级未保存计数；恢复单项；保存成功清标记。
- 接入：upstream detail 各表单、模型抽屉、公开模型编辑器、网关策略卡（retry/health）。
- 统一语义按钮 tone：启用/解除 success、关闭/冷却 warning、测试 info、删除 danger、编辑 neutral；更新 DESIGN-AUDIT §语义色与 check 脚本。

W2.5 抽屉原语
- 新增 web/src/components/ui/drawer.tsx（右侧、100vh、宽度档位、焦点陷阱、Esc、滚动锁定、sticky header/footer、窄屏全屏）；模型抽屉与公开模型成员编辑复用；替换现有 Dialog 用法。
- 验收：键盘可达、aria-modal、关闭拦截 dirty。

W2.6 通知位置
- toast 改为右上、避开表格底部与操作列；3s 自动消失保留；错误可停留；不遮挡行内按钮。

### W3 页面

W3.1 上游渠道列表（web/src/pages/upstreams.tsx）
- 操作列 sticky + 对齐；删除行内 test-connection mutation，测试按钮改为跳转 /upstreams/:id?tab=routing；启停/测试/删除 tone 与 pending 逐行隔离；toast 不遮行；列表列宽与头身对齐。
- 验收：点任一行测试不再全灰；跳转后 Tab 正确；窄屏操作列常驻。

W3.2 路由与模型 Tab（web/src/pages/upstream_detail.tsx、components/upstreams/models-panel.tsx）
- Tab 改名「路由与模型」；URL 支持 ?tab=routing；页头保留密钥测试；面板页头：添加模型、拉取模型、全部测试；行内：测试（模型探测，显示结果 chip + 延迟）、编辑（抽屉）、启用/关闭、删除；探测结果会话内保留并支持清空。
- 提示 conditional 多密钥只第一把生效（若该公开模型下拉涉及）。
- 验收：单模型测试/全部测试/失败态/超时/取消；旧 test-connection 仍在连接与模型 Tab。

W3.3 上游模型抽屉（components/models/upstream-model-dialog.tsx 重写为 drawer + 冷却面板）
- 满高抽屉；分组：基本信息 / 能力 / 价格 / 状态与冷却；启用开关在页脚上方或状态组；冷却面板内嵌单次/周期 Tab，互斥逻辑按 D6，显示当前生效规则、来源、截止、窗口、解除入口；保存单主按钮 + dirty 标记。
- 列表行内：冷却/解除单按钮随状态切换；点击打开抽屉并定位到冷却组；删除/启停语义色。
- 验收：截图 6/7/8 诉求逐条；互斥错误 409 文案可读；保存后列表即时刷新。

W3.4 公开模型编辑器（components/models/public-model-editor.tsx、member-editor.tsx、member-drafts.ts）
- 单页三段 + 单保存；页头 h1 + 状态 + 未保存；基本信息策略卡片保留说明；成员 chip 流按层分组、conditional 兜底末位、候选分组可折叠与搜索、chip 编辑 popover、删除与恢复；权重/优先级/条件按模式显隐；提交走 W1.5 合并端点；双权限提示；脏标记按区块与成员。
- 验收：截图 8/9/10；保存一次生效；失败回滚提示；切换 conditional 顺序正确；窄屏可用。

W3.5 日志（web/src/pages/logs.tsx、components/logs/*）
- 模型列两行（请求/实际）；attempts 小按钮 + popover 路由链；费用列两行；行级错误摘要；抽屉复用同一路由链组件；无 attempts 能力时降级文案。
- 验收：构造多尝试 mock/真实数据：badge 显示 N、popover 每行上游/模型/错误、展开详情；无 attempts 行不显示错误信息。

W3.6 看板（dashboard、flow-chart.tsx、trend-panel.tsx、use-reports.ts）
- 删除前端 splice/merge；hiddenStages 进入请求参数与查询键；隐藏芯片/恢复、最少 2 段守卫、空态；高度 400px；阶段色按 id；TopN 其他节点展示；点击节点只切隐藏状态；tooltip 保留。
- 验收：隐藏连接密钥/公开模型后 A→C 正确连接、数字守恒；全隐边界空态；刷新/回退保持一致。

W3.7 看板 KPI（metric-cards.tsx、stat-card.tsx）
- 词元/TPM 整数、RPM 2 位；图标映射与轻盈配色；最高峰文案整数；卡片布局与链路图并列层次（不新增大改，仅按截图修正）。

W3.8 其余表格与设置
- client_keys、models 列表、audits、roles、users、config_revisions、gateway-policies、settings 数字与 sticky/对齐；settings tile 改 fmtInt；文案与术语清理。

### W4 文档、契约、门禁、验收

W4.1 ADR
- 新增 ADR-027（冷却互斥与解除语义，修订/取代 ADR-004 叠加口径）；新增 ADR-028（适配器遥测边界：系统只存归一化 request_attempts，OTel/接收器/span 表归 AG 适配器）。
- docs/contracts/adapter-spi.md 增 observe.request_attempts 能力与遥测生命周期；删除 trace_spans/OTLP 在系统层文档中的表述。
- 修订 ADR-025（冷却入口与抽屉；行内单按钮/解除）、ADR-026（归因/迁移/key 清理/conditional 首把说明）、ADR-020（日志 attempts/请求模型可得性）、ADR-024（边界文案复核）。
- docs/DECISIONS.md 索引更新。

W4.2 DESIGN-AUDIT / GLOSSARY
- 表格 sticky/对齐/操作列规范；数字口径；语义色改为语义色规则（解决 :164 与产品诉求冲突）；看板 KPI 调色与图标映射；日志模型列/费用两行；分流路径投影；抽屉与脏标记；公开模型单页；模型探测/模型拉取术语；路由计数/页面清单；删除 26 条路由旧数字。

W4.3 api-contract
- flow collapse/top_n；logs attempts_count/has_attempts/requested_model（attributes_json.agw.ai.original_model）与 /admin/logs/{id}/attempts；删除 /admin/traces/{trace_id}；probe 端点；冷却 409 与解除/skip；公开模型更新收敛为 PATCH（含 targets）并删除 PUT /targets；has_api_key 废弃；多密钥 # 形态与文件名约束。

W4.4 计划/验收/变更记录
- w4-b:17 改守恒语义；w4-c:11-14 改为单页设计并补成员 chip 设计；w4-d 注记已完成项与条件；新增本计划 docs/plans/w5-correctness-rework.md。
- ACCEPTANCE.md 四 Tab、单页编辑器、探测、冷却互斥、sticky、数字口径；CHANGELOG-phase4 修正 M5 矛盾并记录删除 PUT /admin/public-models/{id}/targets 与 /admin/traces/{trace_id} 的破坏性变更；FEATURE-PARITY 更新（路由链改为适配器能力）。

W4.5 门禁脚本
- web/scripts/check-ui-foundation.mjs：表格 sticky/对齐、语义色映射、数字格式、dirty 组件、drawer、flow 无前端 splice、KPI 映射、术语；更新 acceptance_browser.mjs:462-479 旧五 Tab → 四 Tab + 新交互断言；interaction_audit 增加 /models/public/:id。

W4.6 测试与证据
- 全量 pytest、ruff；tsc/eslint/build/bundle/ui-foundation/terminology；浏览器矩阵（见 §5）；截图 .scratch/w5-shots；最终报告与提交。

## 3. 执行顺序与提交切分

M1 后端数据正确性：W1.1–W1.7 + 测试（独立可回滚，前端暂不切）。
M2 前端原语：W2.1–W2.6 + 门禁脚本草稿。
M3 渠道/模型页：W3.1–W3.3 + W3.8 相关表格。
M4 公开模型：W3.4。
M5 日志/看板/KPI：W3.5–W3.7。
M6 文档/门禁/验收：W4.1–W4.6 + 收尾。
每个 M 单独通过对应门禁后提交；M1 可与 M2 并行（不共享文件），M3 依赖 M1/M2，M4/M5 依赖 M1/M2，M6 最后。

## 4. 接口/契约变更表

| 变更 | 位置 | 兼容性 |
| --- | --- | --- |
| GET flow 增 collapse/top_n | routers_reports.py、api-contract | 默认参数输出不变 |
| /admin/logs 增 attempts_count/has_attempts/requested_model；新增 /admin/logs/{id}/attempts | routers_ops.py | 新增字段/端点；删除 /admin/traces/{trace_id} 属破坏性变更 |
| POST /admin/upstreams/{id}/models/probe | 新路由 | 新增 |
| 冷却冲突 409 CONFLICT + details | availability 路由 | 语义变化需前端映射 |
| 公开模型更新改单一 PATCH（含 targets） | routers_models.py | 删除 PUT /{id}/targets，属破坏性变更，所有调用方同改 |
| has_api_key 废弃/派生 | routers_upstreams、web api | 前端同步 |
| provider 归因剥 # 序号 | usage_ingest.py | 账本形状不变 |
| key 文件 prune | rollout.py | 只删白名单外受管文件 |

## 5. 测试与验收矩阵

- 后端单测/集成：W1.1–W1.7 各新增用例；全量 pytest 0 失败；ruff 全绿。
- 契约：golden fixture 不因默认参数变化；gen_ts --check 通过。
- 前端门禁：tsc / eslint / build / bundle 阈值 / ui-foundation / terminology / route audit。
- 浏览器：登录 → 看板（隐藏阶段×4、恢复、KPI 数字）→ 上游渠道（跳转测试、启停、语义色）→ 上游详情（路由与模型、模型探测、全部测试、抽屉编辑、冷却互斥/解除）→ 公开模型（单页保存、chip 排序、conditional、脏标记、权限）→ 日志（两行模型、attempts popover、无链路降级）→ 网关策略（默认关透传、retry+health）→ 其余表格 sticky。每个操作断言 console 0 error。
- 证据：截图、测试输出、最终中文报告（改动/数字/hash/遗留）。

## 6. 风险与回退

| 风险 | 缓解 | 回退 |
| --- | --- | --- |
| flow 投影改动影响旧报表 | 默认参数逐字节一致 + 双跑对比 | 保留旧路径函数开关 |
| 冷却 409 破坏既有叠加数据 | 只拦新写入，旧数据只读展示告警 | 关闭新校验配置开关（不推荐） |
| 适配器遥测能力差异 | 能力矩阵灰显；无 attempts 的适配器不显示路由链（W1.7） | 只保留两行模型，不做尝试链 |
| 请求模型数据不可得 | 推断+「未知」标注；不伪造 | 只显示实际模型 |
| 公开模型端点改单一 PATCH 属破坏性变更 | 全仓 grep 旧路径、更新全部调用方与测试、CHANGELOG 标注 | 回退到上一条 commit（无兼容层） |
| sticky 列样式冲突 | 统一原语 + 逐表截图 | 单表移除 sticky |
| 多密钥迁移/清文件误删 | 白名单 + dry-run + 备份 | 恢复 key 文件备份 |
| 探测真实计费/限流 | 串行、超时、可选单模型；全部测试需确认 | 取消请求 |
| 大范围 UI 改动回归 | 分 M 提交、每步门禁、浏览器穷举 | 按 M 回滚 |

## 7. 自检（规划后第二轮检查，发现的问题与处理）

1. chip 流与顺序语义冲突：chip 按长度换行会隐藏 priority 与 conditional 顺序；必须分层分组 + 兜底固定末位 + 顺序徽标/拖拽，否则编排语义不可见。已并入 D9/W3.4；不引入 DnD 库，用上移/下移 + priority popover。
2. 存量叠加冷却数据：新校验只拦新写入，旧库可能仍有单次+周期叠加；需定义展示与解除策略（推荐：旧数据只读告警，解除时清单次并跳过当前周期窗口），否则「解除」仍可能冲突。已并入 W3.3，待确认 Q-C。
3. 日志「请求模型」数据现实（已解决）：request_logs.gen_ai_request_model 记最终上游模型，但 M2 混合形态的 AG 请求日志 attributes_json 里已有 agw.ai.original_model（客户端请求的公开模型；探针库 .scratch/e17m2probe2/llm1/data.db 实证 original_model=pub-a、gen_ai_request_model=up-a）。W1.3 直接解析即可，不需要 accessLog CEL spike、不需要成员反推；full-form 旧行缺字段显示 —。
4. attempts 数据来源（已重构）：不再由系统管 tracing；AG 适配器默认采集并归一化为 request_attempts（loopback+token），其他适配器无能力时灰显，见 #17。
5. ECharts 跨层连线：路径投影后可能出现跨 2–3 层的长边，ECharts sankey 的布局/层级可能需要实测（节点重叠、长边交叉）；W1.1/W3.6 需在真实数据上验证，必要时降级为「只允许隐藏相邻段」或改用自定义 SVG（不推荐，工作量大）。已加入风险。
6. sticky 操作列与行悬浮/选中/展开行冲突：sticky 单元格需同步行背景，否则 hover 时出现色块断层；表格若带行选择/展开需固定单元格高度。W2.1 验收补窄屏截图与 hover 检查。
7. 列表测试按钮跳转参数：upstream_detail 的 Tab 目前是本地状态，需 URL 同步（?tab=routing），否则刷新/外链失效；acceptance/interaction 脚本要覆盖。
8. 全部测试的密钥选择与成本：一个渠道 N 把密钥时，探测用哪把会改变结果；全部测试 22 模型 × N 把会产生大量真实调用。建议默认第一把启用密钥 + 探测对话框可选密钥；全部测试串行并显示进度/可取消；结果不持久化。待确认 Q-D。
9. 公开模型单保存的事务性：现有 PATCH + PUT targets 是两个端点，客户端顺序保存存在半成功；已改为扩展 PATCH 单事务并删除 PUT targets（W1.5），无兼容层，调用方与测试全量同步。
10. 颜色语义与脏标记的噪音：全字段高亮会变成视觉噪音；只标变更项、区块只显示计数、保存后清除；且必须图标+文字，不做仅颜色编码。已写入 D8。
11. 多密钥 seed 变化影响验收数字与截图：api-contract 计数、acceptance_browser 断言、文档里的「6 上游 6 密钥」需同步；W1.6/W4 已列。
12. 冷却改 409 与现有 422 错误映射：前端 useMutation 错误处理可能把 409 当通用错误；需统一错误映射并补 UI 文案（阻塞窗口/截止时间）；批量冷却 failed 明细需要展示。
13. rules_changed_since 不感知新建/删除规则会导致加/删冷却后路由不刷新（不只是 UI）；W1.2 已改为变更后主动 apply，需补集成测试（apply 版本变化）。
14. 公开模型后端仍接受冷却写入（ADR-025 说 UI 只有启停）：要么后端拒绝，要么文档承认；建议拒绝并补测试，避免下次又出现「文档说没有、实际有」。
15. ECharts 阶段色按索引映射，隐藏后颜色会串；W3.6 改按 stage id 固定。
16. 表格对齐根因是表头字号 12px 与按钮 14px + padding，不是单纯 align；W2.1 必须同时改 TH 行高/字号/垂直居中与操作按钮尺寸，否则 sticky 了仍不对齐。
17. 追踪归属（架构纠偏）：OTel/接收器/span 表都是 AG 适配器实现细节，不能留在 l06/trace_spans；系统只定义归一化 request_attempts 与 /admin/logs/{id}/attempts，适配器通过端口写入；换适配器时上层与 DB 不变。AG 1.7 除 OTel 外没有可靠的逐次尝试上游身份来源（E19：access log/metrics/stdout 均不足），所以 OTel 保留但收进适配器；若要求零额外监听端口，只能砍掉逐次尝试链。
18. 适配器可换性验收：用 mock adapter 实现 attempts 端口跑同一 API/UI 用例，证明系统层没有 AG/OTel 类型泄漏；grep 检查 l05/l06 不出现 trace_spans/OTLP/tracing host/port 参数。

## 8. 待你拍板（只列真正需要决策的）

Q-A tracing 采样（已定，按 D14 重构）：采样/传输归适配器内部（默认 loopback + token + 100%），系统不再暴露 host/port/randomSampling 参数；库增长过快由适配器内部调采样或系统留存策略处理。
Q-B 日志第一行「请求的模型」：已解决，无需决策——attributes_json.agw.ai.original_model 就是客户端请求的公开模型，W1.3 解析即可（见 §7-3）。
Q-C 旧库叠加冷却（已定，按推荐）：存量只读告警 + 新写入禁止；不做数据迁移删除，避免误删运营配置。
Q-H 适配器遥测重构：推荐 D14/W1.7（系统只存归一化尝试，OTel 收进 AG 适配器；仍有一个 loopback 监听端口，但不再属于系统）；若坚持零额外监听端口，则本波删除「N 次尝试/路由链」，只保留两行模型（需改截图 4 需求）。
Q-D 模型探测密钥（已定，按推荐）：默认第一把启用密钥，探测/全部测试对话框允许选密钥；全部测试串行可取消，不持久化结果。
Q-E 公开模型更新端点：已定，删除 PUT /{id}/targets，扩展现有 PATCH 单事务承载 targets，不留兼容层（用户已明确不要旧端点）。
Q-F 批量冷却 UI（已定，按推荐）：本次补上（多选后批量冷却/解除，冲突进 failed 汇总）。
Q-G # 形态（已定，按推荐）：保留（E18 已验证），补跨平台 validate/golden 回归与文档；不改 -k{seq}，避免契约与证据体系重建。

## 9. 本轮不做

不缩放分流图；不做浅/深探测两种模式；不新增独立连通性测试页；不换整体视觉主题/不重做布局体系；不引入拖拽库（用上下移/priority 弹层）；不默认开启请求正文日志；不改 AG 二进制/版本。
