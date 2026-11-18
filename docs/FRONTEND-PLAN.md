# 三期重构计划（2026-11-19 夜）：病根修复 + 全站页面重构 + 清理验收

- 制定：2026-11-19（三轮访谈定案：R1 十四题 / R2 十三题+七批注 / R3 五题+一批注）
- 决策依据：docs/DECISIONS.md ADR-019~023、docs/GLOSSARY.md（三期词表）、docs/DESIGN-AUDIT.md §三期前端设计规范
- 旧二期计划已完成归档（git 历史），本文件为唯一现行计划
- 执行模型：Lead（主会话）+ 最多 3 个并行 agent，写作用域互斥

## W0 访谈与落档（已完成）

三轮访谈全落定；GLOSSARY 更新 16 处；ADR-019~023 落档；E14 实验（AG 1.7 请求内重试矩阵 200-599 + 非 chat 透传）后台进行中——结果只影响「路由链渲染方式」与「接口类型原生支持清单」两个已备好分支的落点，不阻塞任何波次。

## W1 病根修复（进行中）

| 工位 | 写作用域 | 内容 |
|---|---|---|
| 后端 A（已完成 ✓ 2026-11-19） | — | usage_ingest 补齐延迟三字段 + api_keys.last_used_at 批量前推（PRAGMA 探测兼容 W1b 时序）；报表六接口 SQL 化（分位 COUNT+OFFSET 取位；时区 UTC 偏移分段 CASE；fx round-half-up 等价 CASE，缺汇率进 fx_missing）；timeseries 多指标 metrics=cost_micro,charge_micro（单数 metric 兼容）；overview 增 error_count（口径 http_status≠200，billing.md §6）/active_minutes；latency p50/p75/p95/p99；日志 sort+total_tokens、user: 匹配 id+名称、status:4xx；api-contract 重对齐（错误信封/分页档位/12 个行字段/缺失接口补收）。验证：pytest 516 passed + 对拍 110 用例 + import-lint + ruff。遗留：prices.py margin_report 未 SQL 化（W6 清单）；并行 pytest .tmp 目录竞态→conftest 进程隔离（W6）；api-contract 的 auto 探测新字段补录（后端 D 顺带） |
| 后端 F（报表任意区间，已完成 ✓ 2026-11-19） | — | latency/timeseries/heatmap/flow 加可选 from_ms/to_ms（成对生效、只给一个/from≥to/负值/跨度>366d 全部 422 信封；生效时 payload range="custom"）；auto 桶 ≤48h→hour 否则 day；heatmap custom ≤7d 星期×小时否则日期×小时（行数=覆盖日历日数）；枚举行为逐字节兼容。验证：全量 544 passed + 新契约 28 用例单进程绿。前端约定：自定义区间回显以 payload range=="custom" + from_ms/to_ms 为准 |
| 后端 H（缓存词元合计，已完成 ✓ 2026-11-19） | — | overview 顶层与 timeseries totals 新增 cache_read_tokens/cache_write_tokens（SQL SUM，同窗口同过滤；字段名与 F1 契约一致）；input 折算口径不动，docstring 写明派生公式；parity 套件按惯例摘新键。验证：551 passed + import-lint + ruff；示例手算（净输入 30）一致。遗留：api-contract.md 两字段文档补录→W6 文档终审（D 正占用该文件）；ESTIMATE_NOTE 文案未改（测试钉死，W6 评估）；members/points 级缓存拆分未做（无需求不做的） |
| Agent F5（密钥/用户/角色，进行中） | `pages/client_keys.tsx`、`pages/users.tsx`、`pages/roles.tsx`、`components/{keys,users,roles}/**`、`web/types.ts`（仅 admin 旧引用清理） | 密钥页：掩码+复制小图标（点击→reveal 审计接口→复制明文→toast「密钥已复制」）取代查看明文列；「最后使用」列（last_used_at_ms）；操作列=启停/重命名/重置（rotate 新明文一次性弹窗）/删除（红确认）；充值入口移除；50 上限提示。用户管理：两 Tab（API 用户=余额/层级树/密钥；控制台账号=username+角色+状态+改密/重置）；创建用户=12 位随机密码一次性弹窗+复制；充值/余额/流水；层级树。角色管理：角色列表（builtin 标识/成员数/权限数）+ 权限编辑按 7 组分节渲染 41 键 checkbox（内置角色只读）+ 成员数点击跳用户管理·控制台账号 Tab 预筛选角色（不做第二处成员 CRUD）；有成员删除 409 展示原因。web/types.ts 清 admin_user_id 与 /admin/admins 旧引用（B 遗留） |
| Agent F4a（模型管理页，已完成 ✓ 2026-11-19） | — | models.tsx 重写 1550→1376 行 + 新建 availability.ts/cooldown-dialogs.tsx/table.tsx（行尾批量区、列显隐 `slipstream.cols.models`、紧凑行、双空态）；批量改价核实 PATCH 接受 cost_input/cost_output/markup（留空不动，逐条 PATCH+allSettled 汇总）；删除 >10 条输「删除」确认；image 行「AG 不记词元」提示；未合入语义文案诚实标注；术语 warn 34→31；五门禁+SSR 冒烟绿。遗留：缓存价按模型名匹配 page_size=200 上限（vendor 维度精确匹配待服务端，W6 备选）；mock 无 batch/DELETE 桩（lib 禁碰未修，W6 清单）；列排序未做（本页未要求） |
| 后端 G（周期冷却跳过窗口，排 D 之后） | `api/src/l05_service/availability.py`、规则存储（l04_repo，D 完成后解锁）、相关测试 | 用户裁定语义（GLOSSARY §3）：周期冷却窗口期内人工「启用」= 仅跳过当前窗口——评估器支持单次例外（实现方向：一次性 skip 例外记录，或规则行加 occurrence 例外，由实现者按 ADR-004 深模块边界选最简方案）；到期/窗口切换自动恢复原规则；删除规则仍手动；模型管理行内启用动作接通该语义；UI 文案「本次启用仅跳过当前窗口，后续窗口照常」 |
| 后端 B（已完成 ✓ 2026-11-19） | — | 统一用户表全链路通（登录/权限/CRUD/树/充值/密钥 smoke 过，41 权限键不变）；密码策略完整（12 位四类随机、initial_password 仅创建回一次、管理员全域/代理子树重置、自助改密验旧）；密钥 name/last_used_at_ms/删除/50 上限（第 51 把 409）；正文日志三件套（settings 键 ag_access_log_llm 默认 metadata、render 产出 frontendPolicies+logging.url 过真二进制 validate、新 routers_log_payload.py 查询 404/sanitize）；迁移脚本幂等（seed 库 3 admin 就地并入）。验证：544 passed。遗留→D：routers_ops.py:641-769 的 /admin/admins 系列仍读写已退役表，必须清除；web/types.ts 的 admin_user_id 与 /admin/admins 引用归 F5；部署注意：生产必须覆盖 SLIPSTREAM_ADMIN_PASSWORD（默认 admin/admin12345 仅 demo）→W6 交付清单；ir.py/rendering.py 边界扩展（AccessLogSpec 走 PoliciesSpec 通道）已记录合理 |
| Lead（已收工） | — | **用户 2026-11-19 指示：主会话此后只做管理类工作（文档/规划/编排/进度跟踪/验收），代码实施全部派子智能体。** 已自做并落盘的 6 处保持：①`lib/api.ts` AbortController+30s 超时（`ApiOpts` signal 透传、timeoutMs=0 豁免流式，SSE 在 lib/playground.ts 自管 fetch 不受影响）；②权限单例 Provider（main.tsx 已挂载，27 处消费方改走 context）；③flow-chart echarts 实例复用不 dispose；④日志详情 rawPretty useMemo 懒序列化；⑤app-shell h-screen→h-full（修 100vh≠100% 差值）；⑥热力图去逐格 aria-label |
| Agent F0（已完成 ✓ 2026-11-19） | — | 五门禁全绿（tsc/eslint/build/check-bundle 197.4KB/check-ui-foundation 37/37）；动画落 `tw-animate-css@1.4.0`（v4 官方兼容，dist 实测类与 keyframes 就位）；三处布局修复落位；术语门禁双档：已废词=error（当前 0）、待迁移存量=warn 48 处（封禁 2 / 对外模型·客户端密钥 46，归各页重做工单清零后提 error）；**并修复主会话遗留 bug：permissions.ts（.ts）内写 JSX 的语法错误 → createElement 等价改写** |
| Agent FS（骨架，已完成 ✓ 2026-11-19） | — | 路由 29→26 条（删账单系 5 + 页面版三策略路由；加 /roles、/gateway-policies 与 4 条过渡重定向）；导航 16→15 项与 ADR-023 一致；overview→quick-start、admins→roles 改名；bills 两文件删除；gateway-policies 临时壳（?tab= 三 Tab 机械包裹）；settings.tsx 残留 /bills 链接改道 /users；routes.json/route-audit/check-ui-foundation 同步；五门禁+verify_web+术语审计全绿。遗留：acceptance_browser.mjs 旧断言归 W6 验收重写；/gateway-policies 守卫取 policies:read（三页共同权限，行为微变已确认）；billing 面板留给 W4 复用 |
| 后端 C（协议自动探测，已完成 ✓ 2026-11-19） | — | ApiStyle 输入侧放行 auto（永不落库），create/update 落库前解析为具体风格；探测顺序 openai_chat(/v1/models) → openai_responses(/v1/responses 最小探测) → anthropic_messages → gemini（x-goog-api-key 头、密钥不进 URL）；discover/test 响应新增 protocol/protocol_source/probe_steps 向后兼容；pytest 516 passed 全绿 + ruff + gen_ts --check。遗留：responses 判别靠最小 POST（个别网关全 2xx 会误判，step detail 有降级说明）；探测行 message 含 JSON 元数据前端原样显示→F3 美化；base 带 /vN 的 gemini 原生上游探测不到需手标；routers_ops.py:612 死路由 discover-models 归后端 D |
| 后端 E（价目导入导出，排 B 完成后） | 新建 `api/src/l06_api/routers_pricing_io.py` + `schemas_pricing.py`（避开 A 的 schemas.py）、`api/src/l05_service/pricing.py`、测试；app.py 注册等 B 释放 | ADR-020：`GET /admin/prices/export` 导出当前生效全量价（upstream_models 的 cost_input/cost_output/markup + model_type + parameters，含导出时间与版本戳）；`POST /admin/prices/import` 同构导入——任一行校验失败（未知模型名/负数/markup 越界）整体 422 不落库（dry-run 原则），通过则批量更新模型行，返回 {changed, missing, skipped}；权限复用 upstream-models 写权限（不新增权限键，41 键不动）；未配价筛选不新建后端（现成 /admin/unpriced 够用） |
| 后端 D（清障+厂商可选，已完成 ✓ 2026-11-19） | — | 删 /admin/admins 4 路由+2 辅助函数+discover-models 死路由（共 5 条，routers_ops 773→606 行）；AdminUserORM 删除、repository 死绑定清理、迁移脚本改自持 legacy MetaData（init_db 不再建旧表）、seed 直写统一 users；vendor_id 可空，命名优先级=显式 name（重名 422）→带 vendor {slug}-NN→无 vendor host:port 生成（默认端口省略/非法字符转 -/重名 -N）；契约补录 15 处（auto 探测/B 工单新面/admins 移除/connection endpoints）。验证：551 passed + gen_ts --check。遗留：PATCH /admin/upstreams 不接受 name（改名路径）→并入后端 G 顺带；F3 需消费新 contract.ts（vendor 可 null/endpoints/admins 移除） |
| Agent F1（W2，范围见下） | `components/dashboard/use-reports.ts` 归 F1 | signal 透传全部报表 hooks；`useAvailability` 两次串行 await 改并行（原 2×RTT） |
| 探子 E14 | `ops/experiments/ag-lab/**`（独占） | 运行中 |

验收：`cd api && pytest` 全绿 + `cd web && npx tsc --noEmit && npx eslint src && npm run build` 全绿 + check-bundle/check-ui-foundation 通过。

## W2 页面重构批次一：快速上手 + 数据看板 + 使用日志

前置：W1 全绿（前端已绿；骨架 Agent FS 与后端 A/B 并行先行，F1/F2 开工时骨架必须已合入）。批次 agent 只写页面内容，routes/nav 归 FS 与 Lead。

| 工位 | 写作用域 | 要点 |
|---|---|---|
| Agent F1 | `pages/dashboard.tsx`、`components/dashboard/**`（含 `use-reports.ts`：signal 透传全 hooks + useAvailability 并行化，W1 遗留） | 6 卡新口径（请求量+错误次数比例、词元 入/出/缓、费用+均价、成本+毛利率合并卡无权限不显、P50 主+P95 副、速度 RPM/TPM/活跃分钟）；区间 7 预设（近24小时/近7天/近30天/今天/本周/本月）+自定义（日历选起止日+时间输入，对齐按钮「此刻」「零点」= 从开始日 00:00 到此刻 / 整自然日）；趋势指标 请求/词元/费用（成本+花费双系列）；成员列只显占比+指标数；分流图按轴开关+顶部恢复芯片+轴名显示在轴底部；延迟分位 2 行（首字/总耗时）×P50/P75/P95/P99 横条；热力图容器定宽高、切换档位格自适应不跳变（365d=365×24 格的 DOM 减量在此一并做：行虚拟化或 canvas 二选一） |
| Agent G0（试验页微调，已完成 ✓ 2026-11-19） | — | params-panel 删「当前模型」块；参数四组去边线改 muted 小标题+缩进（组间 16px/组内 8px）；「对外模型」→「公开模型」8 处；tsc/eslint/build 绿，术语 warn 48→40（试验页清零） |
| Agent F2a（快速上手，进行中） | `pages/quick-start.tsx`（含旧 overview 内容重写） | ADR-023 #1：删今日概况 4 卡与独立最近变更块；重做为三步上手（①签发连接密钥→/client-keys ②配上游渠道与公开模型→/upstreams、/models ③拿 sk- 调 /v1，每步带跳转+完成判据）+ 网关连接信息卡（/admin/connection + settings 的 gateway_base_url，端点清单 + curl/python 示例复制按钮 toast「已复制」）+ 顶部系统健康带（useControlPlaneHealth + useRecentRevisions 现成 hooks：AG 连接、最近下发版本与状态）；卡片边界/间距按 DESIGN-AUDIT §1 统一 token；页面内旧术语 warn 清零 |
| Agent F1（看板，已完成 ✓ 2026-11-19） | — | 六卡（数据源=趋势 totals+延迟接口，派生全在 metric-cards：入=input−cache、总=入+缓+出、均价、毛利率、RPM/TPM；权限显隐）；TimeRangePicker 定案三件（window.ts+picker+index，形状 {kind:range|custom}，timeWindowKey() 进 queryKey；本周/本月=周一·1日 00:00→now；自定义弹层含「此刻」「零点」）；趋势指标请求/词元/费用双系列；成员列 名称+占比+指标数；分流轴点击隐藏+顶部恢复芯片+底部五段轴名常驻；tooltip K/M/B 2dp；延迟 2 行×P50/P75/P95/P99 横条（<5 样本「样本不足」）；热力图行虚拟化（8784→约 750 DOM，外框定高 352px）；use-reports 9 hooks 全 signal 透传+useAvailability 并行（W1 遗留清零）；lib/format 增 fmtCount/fmtSeconds/fmtFixed；六门禁+10 项 SSR 冒烟绿，术语 warn 31（看板清零）。H 字段 undefined→0 降级已内置。遗留：dashboard-kpis.tsx 并入 metric-cards（门禁文件名钉住）；useUpstreamSummary/useAvailability 无消费方保留待 W6 处置 |
| Lead | 骨架 + 验收浏览器截图 | routes/nav 重排；删 bills+bills_redirect+pricing_redirect 中 /cost 系 |

## W3 页面重构批次二：上游渠道 + 模型管理 + 价目管理

| 工位 | 写作用域 | 要点 |
|---|---|---|
| Agent F3 | `pages/upstreams.tsx`、`pages/upstream_detail.tsx`、`components/upstreams/**` | 列表=搜索（名称/地址）+状态筛选+探测试+行内快捷操作（启停/测试/编辑/删除）+批量行尾；编辑器=整页四 Tab（连接与模型/路由与映射/请求与响应/其他设置）+顶部名称+启用开关+获取上游模型+测试连接+保存+右侧连接状态卡；厂商可选（等后端 D 合入）；名称默认 host:port 生成可改；协议下拉加「自动探测（推荐）」消费后端 C 的 auto 探测（展示 protocol_source/probe_steps，探测行 message 的 JSON 元数据要美化成人话）；密钥批量（≤20）；改写规则四段+JSON 模式+试运行（transforms/preview）；优先级在路由与映射成员行；模型映射表带默认探测/类型/参数/进价/探状态 |
| Agent F2a（快速上手，已完成 ✓ 2026-11-19） | — | 健康带（控制面/AG 数据面/最近下发版本）+三步上手三卡（判据+权限显隐 CTA）+连接信息卡（/admin/connection 实际字段 base_url/configured/default_port，端点清单只列 E14 实测三条，不硬编）；示例 your-public-model + 复制 toast；四门禁绿；术语 warn 40→34。建议已记录：/admin/connection 服务端下发 endpoints 字段后前端再替换清单（归后端 D 顺带，可选） |
| Agent F4a（模型管理页，进行中） | `pages/models.tsx`、`components/models/**`（模型侧） | 两 Tab（上游模型/公开模型）；筛选行=搜索（名称/上游/类型）+类型筛选，**批量操作在筛选行尾**（多选启用/关闭/删除三档确认/改价弹窗=前端循环 PATCH 现有端点）；价格列「入xx/出xx/倍率」（缓存价无模型行列——ADR-020，有则显示 /admin/prices/upstream 的 cache_read 当前值，编辑归价目 F4b）；操作=复制公开名/启停（可逆不确认）/编辑/删除（红色确认）；可用性行内=关闭/启用/一次性冷却/解除/周期紧凑编辑（**窗口期启用仅跳过当前窗口的语义待后端 G 合入，UI 先按现行为+提示**）；image 类型行加「AG 不记词元、无法计费」提示；行高紧凑按规范 §2 |
| Agent F4b（价目页，待 E） | `pages/pricing.tsx`、`components/models/**`（价目侧） | 进价+倍率编辑+只读派生售价三段；紧凑行高；导出/导入 JSON（后端 E 端点，导入失败逐行错误展示）；「未配价」筛选用 /admin/unpriced；缓存价编辑在此页（upstream_prices 的 cache_read/cache_write 行） |

## W4 页面重构批次三：连接密钥 + 用户管理 + 角色管理 + 模型试验

| 工位 | 写作用域 | 要点 |
|---|---|---|
| Agent F5 | `pages/client_keys.tsx`、`pages/users.tsx`、`pages/roles.tsx`（原 admins.tsx 改造）、`pages/playground.tsx`、`components/{keys,users,roles,playground}/**` | 密钥页=名称列+复制图标（toast「已复制」）+最后使用列+操作列（启停/重命名/重置/删除三档确认）；去掉明文列与充值入口；用户管理=两 Tab（API 用户/控制台账号）+充值/余额/流水+创建（随机 12 位密码一次性展示）+重置密码（层级 RBAC）+余额树；角色管理=角色列表+权限矩阵（7 组 41 键，按组分节渲染防「100 列」）+成员数；模型试验=去掉参数面板「当前模型」、参数块去边线 |

## W5 页面重构批次四：网关策略 + 审计 + 配置版本 + 设置两页 + 登录/404

| 工位 | 写作用域 | 要点 |
|---|---|---|
| Agent F6 | `pages/policies.tsx`、`pages/guardrails.tsx`、`pages/mcp.tsx`、`pages/gateway-policies.tsx`（新壳）、`pages/audits.tsx`、`pages/config_revisions.tsx`、`pages/settings.tsx`、`pages/ops_settings.tsx`、`pages/login.tsx`、`pages/not-found.tsx` | 网关策略单页三 Tab（流量策略/护栏/MCP）共用 validate→保存→apply→版本留档；审计/配置版本套统一列表规范（筛选+列显隐+详情抽屉）；用户设置（自助改密入口+偏好+花费 scope=self）；运营设置（连接地址/系统参数+ag_access_log_llm 正文开关带存储提示/运行信息）；登录页接 .env 引导语义 |

## W6 清理与验收

- 删：bills 路由与页面、/cost /revenue /unpriced 重定向、TimezoneProvider 死代码、routers 里 discover-models 重复实现、其余死代码
- 门禁：tsc / eslint / build / check-bundle / check-ui-foundation / terminology_audit 全绿；api pytest 全绿
- 补充清单：prices.py `margin_report` SQL 化（A 遗留）；conftest 临时目录进程隔离（A 遗留）；acceptance_browser.mjs 按新路由与新页面重写（FS 遗留）；术语 warn 48 处清零后把 deprecated-term 提为 error（F0 约定）；api-contract 补录 auto 探测字段与 prices export/import（随 D/E）
- 浏览器逐页截图验收（四查矩阵：首屏/空态/错误/交互）+ 六条关键流程端到端：
  1. 建上游渠道（自动探测协议）→ 获取上游模型 → 建公开模型绑目标 → 下发版本记录
  2. 用户管理建用户（随机密码）→ 签发密钥（复制 toast）→ 调 /v1 产生日志
  3. 日志：筛选→排序→列显隐→详情（含正文开关开启时的 prompt/completion）
  4. 看板：区间/维度/指标切换无 3-5 秒卡顿（AbortController 生效，连点不排队）
  5. 价目：导出 JSON → 改 → 导入生效为新口径
  6. 危险操作三档确认 + 周期冷却窗口期启用仅跳过当前窗口
- seed 更新（覆盖 7 天用量、多上游、含缓存/错误样本，延迟字段非 0）、最终提交

## 风险与对策（沿用二期规则）

| 风险 | 对策 |
|---|---|
| 前端批次与后端 W1 接口错位 | 本计划即接口契约来源（新聚合字段/端点已列明）；F1/F2 开工前先核对 api-contract.md 已更新 |
| 共享文件冲突 | routes.ts/nav/lib/format/ui/** 归 Lead；批次工位只写各自 pages+components 子树 |
| ~~E14 结果晚于 F2~~ 已关闭 | E14 实测（2026-11-19）：AG 1.7 LLM 面请求内零重试（48 请求 0 切换、1 请求严格 1 行日志、trace_id 全空；route 层 retry 仅纯 HTTP 路由生效、LLM 监听器不受影响）→ **路由链定案静态最终链路，无增量分支**。附带：systemone 为 AG 内置协议非透传（GLOSSARY §4 已更正）；image 类调用 AG 不记词元（账本盲区，模型行加提示）；上游 200+非法 body 会被 502+驱逐（上游兼容性测试须含该用例） |
| 一晚完不成 | 按 W1→W2→W3→W4→W5→W6 顺序保底推进；W5 可降级为「套规范改壳不重排版」 |
