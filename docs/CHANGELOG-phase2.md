# 二期变更记录（CHANGELOG）

- 基线：`phase2/integration`（2026-11-18，本地提交未 push）
- 范围：二期 ticket **01–22 全部合入**；本文逐项记录合并提交与合并时验证，最终门禁数字见 §3。
- 复跑口径：`cd api && python -m pytest -q` → 315 passed；`python ops/checks/smoke_api.py` → 40/40 PASS；`cd web && npm run check:bundle` → PASS（首包 gzip 193.8 KB / 66 chunk）；`node ops/checks/acceptance_browser.mjs --channel msedge --strict` → PASS 25/FAIL 0/PENDING 0。

## 1. 已合并 ticket 总表

| ticket | 主题 | 合并提交 | 合并时验证 |
|---|---|---|---|
| 01 | 驭流品牌与 UI 基础层复刻 | `05716d2` | UI 门禁 30/30 + tsc/eslint/pytest 全绿 |
| 02 | 真实登录、会话与密码安全 | `2c15cf3` | pytest、smoke 全绿；基线复跑 smoke 40/40 |
| 03 | RBAC、字段级权限与权限矩阵 | `c245736` | pytest（含字段缺失断言）、浏览器权限矩阵 |
| 07 | AG 1.7 渲染器 v2 | `f8ed76c` | pytest 133 passed + AG `--validate-only` 实测 |
| 08 | 下发/校验/回滚与配置版本 v2 | `b0cff87` | pytest 162 passed（含真实 AG 门禁）+ 迁移/回滚演示 |
| 09 | 上游管理 v2：多密钥/探测/发现/批量 | `03c6c4b` | pytest（`test_upstream_actions.py`）+ 浏览器主流程 |
| 11 | 策略/护栏/MCP 可编辑 | `456ead4` | pytest（`test_policies_api.py`）+ 保存后 revision 变化 |
| 15 | 模型试验 v2：参数、会话与附件 | `1c43cbc` | pytest/tsc/eslint/build + 浏览器对照 |
| 18 | 前端包体拆分与门禁 | `07a488f` | check:bundle PASS；首包 gzip 557.6→188.7 KB |
| 22 | 指标卡图标与术语统一 | `22abba2` | tsc/eslint/check:bundle 全绿；首包 <220 KB |
| 04 | 用户层级、代理与子树汇总 | `1d31c2b` | pytest（含可空列增量迁移 4c13a46）+ 用户树/子树浏览器验收 |
| 05 | 计费定价引擎（成本 × 倍率 = 花费） | `ebcfbe1` | pytest 计费契约 + 账单/价目页面 |
| 06 | 价目管理单页（合并上下游价目） | `7362d03` + `1016b3e` + `d348a5e` | 盈亏/加价率列、成本+倍率可编辑；PATCH 上游模型补 billing:cost 依赖 |
| 10 | 模型管理 v2（两 Tab + 可用性并入） | `334c95d` | 上游模型/公开模型两 Tab、行内关闭/启用/冷却/解除；routers_models.py 合并 |
| 12 | 看板 API v2（趋势/流向/热力/成员/延迟） | `5c3eae9` | pytest reports + 前端联调 |
| 13 | 看板 UI v2（三 Tab + 成员详情 + 热力图） | `e0c27e7` / `bf131d9` | 柱形/面积/分流 Tab；7D/30D/365D 热力图；浏览器验收 |
| 14 | 日志 v2（合并列/详情/查询） | `a4125d7` | 表格少分列、词元/花费合并列；字段级权限 |
| 16 | 设置 IA（用户设置 / 运营设置子导航） | `8765c79` | 运营设置三个二级分区；settings-schema 分组 |
| 17 | 概览与账单合并（成本/营收/待补价/我的花费） | `23a0cbf` / `e0e255c` | 旧入口 /cost /revenue /unpriced 重定向；账单页 Tab |
| 19 | 演示数据与 priority 迁移 | `964e954` | seed 幂等（6 用户/19 模型带成本倍率/策略样例/2 条可用性）+ 迁移脚本 no-op |
| 20 | 浏览器验收基建与交互用例 | `ece3b31` + `e83ea3a` | acceptance_browser 25 项 strict 全绿；MCP 缺字段兜底修复 |
| 21 | 文档同步（本 ticket） | 本提交 | PLAN/CHANGELOG/GLOSSARY/FEATURE-PARITY/ACCEPTANCE/api-contract/DELIVERY 对齐最终 IA |

## 2. 逐项说明

### 01 品牌与 UI 基础层（05716d2）
- 恢复“驭流 Slipstream · LLM API 网关”品牌：logos、favicon、页签标题、侧栏两行品牌锁定。
- 语义 token、shadcn 别名层、阴影/圆角/间距/字号/控件高度与旧系统 ui-standards 对齐；Button 默认 primary、Empty/Toaster/Card/Popover 阴影统一。
- 壳层：侧栏 + 顶栏 + 内容区；折叠态有 title 兜底。

### 02 真实认证与会话（2c15cf3）
- 密码改为 scrypt（N=2^14、r=8、p=1、dklen=32、16 字节盐），格式 `scrypt$N$r$p$salt$digest`；兼容旧 pbkdf2（120000 次）。
- 会话落 `admin_sessions`，只存 `sha256(token)`；httpOnly + SameSite=Lax cookie，12h 绝对过期，无滑动续期；`SLIPSTREAM_COOKIE_SECURE=1` 时加 Secure。
- `POST /admin/auth/login`、`POST /admin/auth/logout`、`GET /admin/auth/me`；除 health/login/logout 外所有 `/admin/*` 要求会话。
- 登录失败统一 401“用户名或密码错误”；同 username+IP 60 秒内失败 5 次 → 429；未知用户也走 dummy hash，避免时序枚举。
- `X-Admin-Role` 不再授予身份；smoke 有“伪造头”断言。
- smoke 全绿；基线复跑为 40/40（30 个 check 调用点，两个循环展开后合计 40）。

### 03 RBAC 与字段级权限（c245736）
- 三个内置角色：`admin` 管理用户（全部权限）、`agent` 代理用户、`user` 普通用户；角色存 `admin_roles`，内置角色不可改权限、不可删。
- 管理员可自建角色：`GET/POST/PATCH/DELETE /admin/roles`、`GET /admin/permissions`；自定义 key 正则 `^[a-z][a-z0-9_]{2,31}$`，权限必须是注册表键，仍有成员的角色不可删。
- 权限键 **41 个**（主数据 10 / 流量治理 4 / 治理 7 / 计费 6 / 用量 3 / 账号 10 / 模型试验 1），注册表在 `l05_service/rbac.py`；后端按权限键校验，不认角色名。
- 旧角色名只用于迁移：owner→admin、operator→agent、viewer→user。
- 字段级过滤：无 `billing:cost` 时 `cost/cost_micro/margin/margin_micro`（含后缀）键直接缺失；无 `billing:spend` 时 `charge/charge_micro/spend/spend_micro/delta_micro/balance_micro/balance_after_micro` 缺失；`amount_micro` 按 cost/spend 上下文处理。测试断言“缺键”，不是 null。

### 07 AG 1.7 渲染器 v2（f8ed76c）
- 渲染结构改为 `llm.models[]`（上游模型，默认 internal）、`llm.virtualModels[]`（对外模型，weighted/failover/conditional）、`llm.policies`、顶层 `mcp`。
- priority 采用 AG 语义“数值小优先”，控制面强制 ≥0；旧 priority 迁移方向在 ticket 08 落地。
- `llm.policies` 覆盖 cors/apiKey/限流/timeout/transformations/guardrails；retry 被 AG 1.7 拒绝，能力矩阵标 `policies.retry=false`。
- 顶层 `mcp.targets` 支持 sse/stdio；http 与 `url` 字段被二进制拒绝（`mcp.transport.http=false`）。
- 不支持的字段显式报错，不静默丢弃；golden fixture + `--validate-only` 实测。

### 08 下发/校验/回滚 v2（b0cff87）
- apply 顺序：拼 IR → IR 自校验 → `adapter.validate(ir)`（AG `--validate-only`）→ 写密钥文件 → render → 原子替换 → 读回确认。
- 配置版本记录真实文件 sha256、状态、失败原因；失败不写文件，归档 `status=failed`。
- 回滚可重放归档 artifact；双失败有明确状态，旧 active 继续服务。
- 旧 priority 数据迁移方向翻转有脚本/测试；`GET /admin/config/status` 返回数据面当前 hash/listening/detail + active_revision。

### 09 上游管理 v2（03c6c4b）
- 多密钥：`upstream_keys` 为密钥组，每上游最多 **20** 把；`is_primary` 主密钥镜像到 `upstreams.api_key_enc`；重复密钥 409；删除最后一把 409。
- 密钥接口只回 masked/key_suffix，明文只在创建/轮换时返回一次。
- 连通测试（8s 超时）与发现模型：写 `upstream_probes`（kind/status/http_status/latency_ms/model_count/tested_at_ms）；发现结果不自动建记录，导入用 `POST /import-models`。
- 批量启停/删除：`PATCH /admin/upstreams/batch`（声明在 `/{id}` 之前）；被目标引用的删除单独失败，不中断整批。
- 删除保护：被 `model_targets` 引用的上游 409，不级联。
- 详情 Tab：基本信息/密钥/模型/改写/健康；改写规则 GET/PUT/preview 保留 4 段结构。

### 11 策略、护栏、MCP 可编辑（456ead4）
- 策略/护栏/MCP 文档落 `app_settings`（`policy_config` / `guardrail_config` / `mcp_config`），有 GET/PUT/DELETE 与 validate。
- 每次写先 dry-run：文档 → IR → `validate_gateway_ir` → `adapter.validate` → `adapter.render`；失败 422 且不落库。
- **保存不等于下发**：保存成功后前端再调 `POST /admin/config/apply`，配置修订才变化。
- 策略字段：cors、api_key、local_rate_limit、timeout、transformations；`retry` 必须为 null，非 null 被 422 拒绝。
- 护栏：regex/webhook 子集，request/response；webhook 只 reject/audit、target 只能是 host（带路径被拒）、scope/rules 为空；渲染到 `llm.models[].guardrails` 与 `llm.policies.guardrails`。
- MCP：顶层 `mcp.targets`，sse 用 host/可选 port+path，stdio 用 cmd/args/env；http 保存 422；不在 `llm:` 内伪造 servers。

### 15 模型试验 v2（1c43cbc）
- 20 项参数四组：系统 4、采样 6、输出 5、高级 5；一行 3 参数，标签悬停显示说明/取值范围，发送前统一校验。
- 模型对话框可搜索、分组、选思考等级；无模型时提示先选择。
- 会话仅存 localStorage（上限 200）：新建/重命名/删除/复制/重试/导入导出；单条消息可复制/删除/重试。
- 恢复附件（仅文本，256 KB / 最多 5 个）、API 密钥、流式/非流式、请求编号、自动滚动、停止生成。
- 用量回显词元、TTFT、耗时、吞吐、成本/花费；按 `billing:cost` / `billing:spend` 决定可见字段。

### 18 前端拆包（07a488f）
- 路由级 `React.lazy` + Suspense；echarts/recharts manualChunks，按需加载。
- 合并时首包 gzip 557.6→188.7 KB；`check:bundle` 门禁 maxFirstLoad 220 KB、minChunks 20、maxChunk 400 KB。
- 后续 15/22 合入后当前基线首包 gzip 191.2 KB，仍 PASS。

### 22 指标卡与术语（22abba2）
- MetricCard 统一：36×36 图标方块、19px 数值、12/11px 标签/副文案；tone/icon 语义映射到 `web/src/lib/metric-icons.ts`，监控类页面统一接入。
- 术语：Tokens→词元、收费→花费；API 字段名不变。
- 首包仍 <220 KB gzip；`check-ui-foundation.mjs` 增加 MetricCard tone/icon 断言。

### 04 用户层级与代理（1d31c2b）
- `users.parent_id` 自引用树；根用户 D 由 seed 创建；代理用户只能管理子树；`/admin/users/tree` 与子树汇总（`billing:subtree`）。
- 用户页列表/树切换；base.py 增量迁移允许新增可空列（4c13a46）。

### 05 计费定价引擎（ebcfbe1）
- 上游模型存 `cost_input_per_1m` / `cost_output_per_1m` / `markup`；花费 = 成本 × 倍率，写 `ledger_entries` 时带 `price_version`。
- 公开模型价 = 成员有效单价按 weight 加权平均（weighted 用 weight，failover/conditional 等权），只读展示；不允许给公开模型单独定价。
- 缺价目记 `unpriced` 且金额 NULL，不写 0。

### 06 价目管理单页（7362d03 + 1016b3e + d348a5e）
- `/pricing` 合并旧上下游价目两页：成本+倍率可编辑、公开模型加权平均价只读、待补价；旧路径重定向页。
- 公开模型 PATCH 与上游模型成本/倍率编辑加 `billing:cost` 依赖。

### 10 模型管理 v2（334c95d）
- `/models` 两 Tab：上游模型（类型/来源/参数/成本/倍率/冷却）与公开模型（名称/模式/成员 priority/weight）。
- 可用性并入行内：关闭/启用/一次性冷却/解除；UI 提供紧凑的周期冷却编辑（重复方式+时间窗），不做完整排期日历；后端周期冷却保留；无独立 `/availability` 页。
- `routers_models.py` 以 ticket10 版为准合并批量动作与字段级成本过滤。

### 12 看板 API v2（5c3eae9）
- `/admin/reports/trend`（dimension/metric/range）、flow、heatmap（7d/30d/365d）、members 详情、latency（TTFT/TOTAL P50/95/99，无 TTFA）。

### 13 看板 UI v2（e0c27e7 + bf131d9）
- 三 Tab（柱形/面积/分流），右侧成员详情可隐藏恢复，底部热力图按区间切换，延迟卡。
- 维度一次一个、指标可选；列少分、词元/金额口径统一。

### 14 日志 v2（a4125d7）
- 表格合并列（模型/路由、吞吐/词元/花费、首字/总耗时）；详情抽屉；查询语法帮助；字段级权限控制成本列。

### 16 设置 IA（8765c79）
- 用户设置 `/settings`（个人资料/主题/连接令牌/我的花费/通知偏好）与运营设置 `/ops-settings` 分离；运营设置子导航 连接地址/系统参数/运行信息。

### 17 概览与账单（23a0cbf + e0e255c）
- 概览保留连接地址与接入示例；成本/营收/待补价合并到 `/bills` Tab，普通用户看我的花费；旧入口重定向。
- 导航「账单」按 `billing:spend` 显隐。

### 19 演示数据与 priority 迁移（964e954）
- seed：3 厂商/6 上游/20 上游模型（19 带成本+1.2 倍率）/8 公开模型/16 目标/6 用户（根 D + 两层树）/5 sk-/252 用量/245 计费/2 配置版本/68 审计/12 app_settings/2 可用性（ban+cooldown）；策略、护栏、MCP 各一份样例；幂等，`--keep` 拒覆盖；演示数据使用中性厂商名。
- `scripts/migrate_priority_v2.py`：默认 dry-run，`--apply` 翻转并写 `priority_semantics=v2`，已迁移 no-op；seed 直接写 v2 标记。

### 20 浏览器验收基建（ece3b31 + e83ea3a）
- `ops/checks/acceptance_browser.mjs`（Playwright，25 项）+ `terminology_audit.mjs` + `route-audit.mjs`；`docs/ACCEPTANCE.md` 50 条 User Story 映射。
- 交互用例：命令面板、主题三态、看板三 Tab 与热力区间、价目编辑还原、模型试验、设置 IA、三角色权限。
- MCP 页缺字段兜底（env/args 为空也能渲染），避免命中错误边界。

### 21 全站交互审计与收口修复（0829c22）
- 重写 `ops/checks/interaction_audit.mjs`：37 条审计路径（含登录页）逐控件操作；控件身份 = 结构 + 可读名 + 首行文本 + 第 n 次出现，不再按同名折叠；每次操作前重定位、操作后关闭弹层并截图；`evalGuarded` 8s 兜底防页面卡死；支持 `--max-controls`、`--only`（逗号多选）；退出码 0/1/2（`--strict` 下软问题也算失败）；422 记 validation 软问题；DELETE 变更单独统计（本轮 0 次）；CLI 与登录复用 `ops/checks/lib/cli.mjs`。
- 实测（2026-11-18 复跑）：37 页 / 发现控件 2383 / 已操作 1829 / 禁用 389 / 重渲染后未操作 39 / 因跳转或上限未操作 126（playground 单页超 400 截断）/ 弹层 157 / 软问题 23 / 硬失败 0（证据 `ops/checks/.logs/interaction/20261118-152753/report.md`）。
- 23 条软问题归因：12 条 toast + 5 条 422 来自审计主动提交不完整表单（上游详情规则编辑器、上游管理删除前的连通性测试），页面已 toast/422 提示；5 条 safety 是护栏页「删除护栏/移除」草稿删除误报（只改本地草稿，需「保存并下发」才落库，已加草稿例外）；1 条 a11y 是护栏流式 Switch 缺可读名称（已补 aria-label；复跑该页 0 问题，证据 `ops/checks/.logs/interaction/20261118-161246/report.md`）。
- 本轮新发现并修复的真实缺陷：价目管理成本输入框每敲一个字符丢焦点（DataTable 把行内函数型 cell 当组件类型渲染，函数身份每次渲染都变 → React 卸载重建单元格）；/bills 等表格页切时间范围或筛选时主线程卡死（data 引用每次渲染都变 → TanStack Table 行模型 memo 反复重算 → `_autoResetPageIndex` 同步死循环）；`POST /admin/config/apply` 502（`settings.ag_config_dir` 相对路径被 agentgateway 按配置文件目录二次解析成双层路径，validate-only 拒绝）；另修 playground 用量 page_size 常量、MCP/策略/运营设置数字输入 NaN、护栏 Switch 与新建会话/规则编辑器可读名称。
- 上轮已修的 5 个缺陷保留：上游详情「健康」Tab 对 `last_probe.models` 缺失兜底、模型试验补用量请求 `page_size=25`、设置页显示名/通知开关/个人简介可读名称、用户「停用」二次确认（根用户禁止）、全局 Toaster 改为 bottom-right。
- 修复后重 seed 演示数据，浏览器验收 `--strict` 25/25 复跑通过，全量门禁全绿。

### 22 前端组件原语化（4826e50）
- 审计结论：`web/src/components/ui/` 已有 42 个原语，但 `pagination`、`dropdown-menu`、`progress`、`input-group`、`field`、`form`、`combobox` 七件零引用（本轮启用 `pagination`，其余 6 件仍零引用）；13 个页面/组件仍直接写原生 `button/select/checkbox/textarea/text input/table`，看板 Tab 与顶栏主题分段是手写按钮（无键盘导航）。
- 改动（17 文件，+224/−231）：`ui/tabs` 改 `@radix-ui/react-tabs`（`Tabs/TabBar` API 不变，补 ←/→、Home/End、roving tabindex），看板三图型 Tab 接入；`DataTable` 底部分页换 `ui/pagination`（首页/上一页/页码/跳页/下一页/末页，`aria-current="page"`）；顶栏与设置页主题选择改 `ToggleGroup type="single"`（`radiogroup`/`radio`）；`transforms-editor` 两个 `select`、`checkbox`、`textarea` 与 `keys-panel`/`upstreams` 的 `checkbox`、`client_keys` 的充值 `input` 与流水表分别换 `Select/Checkbox/Textarea/Input/Table`；9 个原生 `<button>`（重试/全部显示/成员行/会话行/移除附件）换 `Button`；延迟分位表、日志查询语法表换 `Table` 原子；登录卡片壳换 `Card`。保留两类原生元素：隐藏 `<input type="file">`（无对应原语）与表格 `<tbody>`（无 table 语义原语）。
- 验证：tsc 0 / eslint 0 / build 成功；`web/scripts/check-ui-foundation.mjs` 37/37；针对性交互审计 14 条受影响路径（`ops/checks/.logs/interaction/20261118-180043/report.md`）：控件 1363 / 已操作 999 / 弹层 152 / 软问题 15（上游列表与详情表单 422/toast，审计主动提交不完整表单）/ 硬失败 0 / exit 0；随后全站 37 条路径复跑：2470 控件 / 1828 操作 / 弹层 160 / 软问题 15 / 硬失败 0（`ops/checks/.logs/interaction/20261118-183422/report.md`）；Playwright 探针验证 Tab 键盘切换、主题 ToggleGroup 落库、日志帮助弹层与模型试验渲染，console error 0（截图 `ops/checks/.logs/ui-refactor/20261118-175718/`）。

### 23 单端口部署（本提交）
- 目标：管理台不再单独占端口；`web` 构建产物由控制面在 **3700** 同源托管，网关仍 **3600**。
- 后端：新增 `api/src/l06_api/spa.py`，`create_app` 末尾调用 `mount_web_console`：解析顺序 `dist_dir` 参数 → `SLIPSTREAM_WEB_DIST`（`Settings.web_dist_dir`）→ `<repo>/web/dist`；dist 不存在时静默跳过（pytest/纯 API 模式）；`/assets/*` 用 StaticFiles，其余 GET 走 SPA 回退；`/admin`、`/api`、`/openapi.json`、`/docs`、`/redoc` 不回落（保持 JSON/文档响应）；深链返回 `index.html` 且 `Cache-Control: no-store`。4 个新单测覆盖挂载、深链、JSON 404、无 dist 跳过。
- 前端：`API_BASE` 默认由 `http://localhost:3700` 改为 `""`（同源相对路径），`auth.ts` 同步；新增 `API_BASE_LABEL` 供顶栏/概览显示当前 origin；`vite.config.ts` dev server 增加 `/admin`、`/api` → 3700 代理，HMR 模式也不跨源。
- 工具：`ops/checks/acceptance_browser.mjs`、`interaction_audit.mjs` 默认 base 改 `http://localhost:3700`（5173 仅在显式 `--base-url` 时用于 HMR），验收提示改为「先 build 再启 3700」。
- 验证：web `npm run build` 成功；`curl` 的 `/`、`/login`、`/models`（深链）均 200 HTML，`/assets/*.js` 200 JS，`/admin/health` 200，未知 `/admin/*` 保持 JSON 401/404，`/openapi.json`、`/docs` 200；pytest **315 passed**、ruff 全绿；浏览器验收 `--strict` 结果见 §3。

### 24 W1 配置下发生命周期：Rollout 深模块（架构评审候选 #1，本提交）
- 新增 `api/src/l05_service/rollout.py`：`Rollout(session, adapter)` 唯一实现 `apply / rollback / status / history`；`RevisionStatus` StrEnum（`active | superseded | failed`）作为唯一词表，`ConfigRevisionOut.status` 随 OpenAPI 下发 `RevisionStatus` 枚举。
- 6 处手抄下发仪式（routers_config apply/rollback、routers_apikeys topup/issue/status/rotate、reconcile、cooldown_rerender）改为一行的 `Rollout(...).apply(...)` / `.rollback(...)`；`operator` 从登录 principal 透传（配置版本页不再显示「api」）。
- 失败策略显式化：`on_failure="raise"`（默认，归档 failed 后抛出）或 `"keep-booked"`（充值已入账时归档失败版本但不回滚余额，去除各调用点各自吞异常的 bare except）。
- l06 适配器组装收敛为唯一 `get_adapter()` FastAPI 依赖（`adapter_factory.get_adapter`，构造参数仍只在 l06 注入；ADR-006 方向不变）；l07 任务复用同一工厂函数。
- `rendering.py` 保留 `build_render_plan` / `write_key_files` 与 deprecated 兼容 wrapper（旧调用方仍可用），逻辑不再重复。
- 测试：新增 `api/tests/integration/test_rollout.py`（状态词表、keep-booked 归档、principal operator、OpenAPI 枚举、status/history）；`test_config_rollback / test_apply_failure_details / test_apply_validation` 升级为 Rollout 接口测试；layering guard 同步到 rollout.py。
- 前端状态词表同源：新增 `web/src/lib/revision-status.ts`（`RevisionStatus` const + 穷尽 label/tone map），`types.ts` re-export 该类型，配置版本页与总览共用；删掉 `applied | rolled_back | pending` 第三套词表与「active 显示已回滚」映射；mock 数据同步为真实状态。
- 架构评审候选 #2 骨架：`ops/contract/gen_ts.py` 从 `create_app().openapi()` 生成 `web/src/generated/contract.ts`（61 个组件 schema、424 行，确定性排序、无时间戳），`--check` 重新生成必须 no-op；`api/tests/unit/test_contract_gen.py` 覆盖确定性、新鲜度检查与手改检测。本提交只铺生成器，`types.ts` 迁移留到下一波。
- `/admin/config/revisions/latest` 补 `response_model=ConfigRevisionOut`，修复 W1 初版把 Pydantic model 当 dict 返回导致的 500；smoke_api 40/40。
- 门禁：pytest 全量 324 passed、ruff 全绿；web tsc / eslint / build / check:bundle 全绿（首包 gzip 193.8KB / 67 chunk）；smoke_api 40/40；acceptance `--strict` PASS 25 / FAIL 0（证据 `ops/checks/.logs/acceptance/20261118-210648/report.md`）；OpenAPI `components.schemas.RevisionStatus.enum = ["active","superseded","failed"]`。

### 25 W2 Money 引擎（架构评审 #3，本提交）
- 新增 `api/src/l05_service/money.py` 作为唯一金额引擎：`round_micro`（half-up、可负）、`convert`（缺汇率/空币种返回 `None`，绝不静默 0）、`cost_numerator` / `charge_from_cost_numerator`、`price_books`（一次算成本与花费两本账；markup 按精确成本分子一次舍入，fixed 与 markup 混用报 `VALIDATION_ERROR`）。
- 删除 `api/src/l05_service/prices.py` 与 `aggregates.py` 各自的 `_round_div` 副本；prices 两个计价函数与 `margin_report` 全部委托 money，`bills._convert` 统一走 `money.convert`。
- `aggregates.ReportData.money` 改为 `int | None`：跨币种缺汇率时返 `None` 并把币种加入 `fx_missing`，不再按 0 计入；timeseries/heatmap/flow 跳过未知金额、保留请求/词元计数。
- `usage_ingest` 一次算成本分子并在成本/计费两账复用：`_build_cost_entry` 返回 `(entry, numerator)`，`_build_charge_entry` 通过 `numerator` 参数复用，markup 不再重算成本；失败/未定价语义保留（失败金额 0、status=ok；未定价 status=unpriced、金额 `None`）。
- 测试：新增 `unit/test_money.py`（舍入、缺失汇率、markup/fixed/free、混用拒绝）与 `integration/test_billing_golden.py`（事件→成本/计费→流水/日报同数；monkeypatch `money.cost_numerator` 断言只算一次；重算幂等）。
- 门禁：pytest 全量 331 passed、ruff 全绿；`ops/contract/gen_ts.py --check` no-op；本候选无前端与 OpenAPI 变更。

### 26 W3 Settings 配置 schema 单源（架构评审候选 #6，本提交）
- 新增 `api/src/l05_service/settings_schema.py`：5 组 7 键的唯一 schema 与唯一校验器 `coerce_setting`（int 范围、币种枚举、http(s) URL 且无凭据/查询/锚点、文本非空）；`wire_groups()` 直接产出前端所需字段元数据（label/kind/default/unit/min/max/options），未知键抛 `VALIDATION_ERROR`。
- 新增 `GET /admin/settings/schema`（`settings:read`，`SettingsSchemaOut`）：前端不再手抄分组、标签与校验规则；`PUT /admin/settings` 的未知键 details 与取值校验同时切到同一份 `SETTING_FIELDS`。
- 前端 `web/src/components/governance/settings-schema.ts` 改为只消费该接口（删除 `SETTINGS_GROUPS`/fieldDefOf/groupOfField 静态副本），运营设置页的分组、字段类型、范围、默认值与未知键兜底全部来自服务端；mock 与 `generated/contract.ts` 同步。
- 修复 settings 的 7 个可编辑键在运营设置页不可见/默认值丢失问题：`gateway_base_url` 归入 connection 组，系统分区仍只显示运行信息与连接地址。
- 测试：新增 `api/tests/integration/test_settings_schema.py`（schema keys == served keys == `SETTING_FIELDS`、每个默认值可 PUT、越界/空文本/非法币种/非法 URL 422 且不覆盖、未知键 details、匿名 401）。
- 门禁：pytest 全量 **341 passed**（exit 0）、`ruff check src tests` 全绿；web `npm run typecheck` / `npm run lint` 全绿；`ops/contract/gen_ts.py --check` no-op。

### 27 W3 金额可见性：中央响应过滤（架构评审候选 #5，本提交）
- 新增 `api/src/l06_api/money_filter.py`（纯 ASGI `MoneyVisibilityMiddleware`）：认证中间件解析 principal 后，对每个 `/admin` JSON 响应统一执行字段级金额过滤；"忘记调用 sanitize" 不再可能泄漏成本/花费键。
- 上下文相关字段由路由声明：`@router.get(..., openapi_extra={"x-money-amount-class": "spend"|"cost"})`，中间件据此决定裸 `amount_micro` 归哪本账；有名称的 `cost_micro`/`charge_micro`/`balance_after_micro` 等仍由 `field_filter` 的共享词表识别。
- 删除 20 余处路由内手写 `field_filter.sanitize(...)`（bills/billing/reports/api-keys/usage/ops 列表）；`routers_models._um_body` 改为始终输出价格字段，是否可见交给中央过滤（仍有单测断言无 `billing:cost` 时键缺失）。
- 保留唯一逃逸口：NDJSON/CSV/text 流与字符串化 JSON 字段不经此中间件，必须在投影处自行 sanitize（写进模块 docstring 与 `docs/api-contract.md` §0.5）；`routers_ops` 详情与 `routers_usage` 事件详情的 `raw_json` 均 parse→sanitize→dumps。
- 测试：新增 `api/tests/unit/test_money_filter.py`（无权限全删、单权限只留对应类、`openapi_extra` 决定裸 amount 归属、非 JSON 与非 /admin 原样放行）；既有 RBAC/账单/价目/报表/日志测试全部保持通过。
- 门禁：pytest 全量 **341 passed**（exit 0）、`ruff check src tests` 全绿；web `npm run typecheck` / `npm run lint` 全绿；`ops/contract/gen_ts.py --check` no-op。

### 28 W4 DataTable 吸收服务端分页（架构评审候选 #7，本提交）
- `web/src/components/data-table.tsx` 的分页接口改为判别联合 `DataTablePaging`：`{mode:"client"}`（默认，现有页面零改动）或 `{mode:"server", offset, pageSize, total, onOffsetChange, onPageSizeChange}`；两种模式复用同一个 `Pagination` footer。
- 日志页 `web/src/pages/logs.tsx` 删除 `[&>div>div:last-child]:hidden` CSS 藏 footer、假 `pageSize={200}` 与约 60 行手写分页器，改传 server paging；审计日志页 `web/src/pages/audits.tsx` 同样改由服务端 `limit/offset` 切页（不再只下载首 50 条）。
- 服务端模式下关闭表头本地排序/筛选（否则只排当前页，结果误导），并隐藏本地筛选输入框；排序仍走页面已有的查询参数；审计页补末页越界夹取与切页保留旧数据。
- 每页档位单一来源：`api/src/l06_api/deps.py:ALLOWED_PAGE_SIZES` 经 `ops/contract/gen_ts.py` 生成到 `web/src/generated/contract.ts` 的 `PAGE_SIZE_TIERS`；`pagination.tsx` 只从这里导出 `PAGE_SIZE_OPTIONS`，DataTable/日志/审计不再各自复制 25/50/100/200。
- 测试/门禁：`test_contract_gen.py` 新增档位断言并通过；web `npm run typecheck` / `npm run lint` 全绿、`npm run build` 成功、`check:bundle` PASS（首包 gzip 195KB / 67 chunk）；生成器 `--check` no-op。API/OpenAPI 行为未变。

### 29 W4 浏览器验收共用会话与单一页面清单（架构评审候选 #4，本提交）
- 新增 `ops/checks/lib/session.mjs`：`openSession(browser, {role, base, apiBase, outDir, evidence})` 统一登录、console/pageerror 采集、截图与 API 请求；返回 `visit / assertSane / shot / errorsSince / assertNoNewErrors / apiGet / navLinks / settle / mainText / login / ensureAuthed`。acceptance 与 interaction audit 共用同一套登录与加载态判定，不再各抄一份。
- 新增 `web/src/routes.ts` 作为唯一页面清单（29 条：`path/layout/page/component/permission/title/nav/variants/auditLabel/audit`），`web/src/app.tsx` 改为 ROUTES 驱动渲染；`web/src/components/layout/nav-items.ts` 的导航分区/叶子/页面标题由 `ROUTES.nav` 派生（21 项，顺序与标签逐项核对旧文件）；`web/scripts/routes-json.mjs` 用 `ts.transpileModule` 生成 `ops/checks/routes.json`（无时间戳，重复生成字节一致），新增 `npm run routes:json`。
- 新增 `ops/checks/lib/routes.mjs`（routes.json 加载、`auditPages/variantsOf/matchRoute/labelForPath/navEntries`）；`route-audit.mjs` 不再正则抠 JSX，直接读生成清单（29 路由 / 23 页面模块 / 21 导航），退出码 2；`interaction_audit.mjs` 删除手抄 35 项 PAGES，改 `auditPages(路由表)+ONLY`，运行期补 `/upstreams/:id`；`acceptance_browser.mjs` 保留 25 条业务断言，会话/截图/断言走 session.mjs（约 829→690 行）。
- 导航权限与路由守卫权限**刻意保持两份**（例如 /guardrails、/mcp 导航要 policies:read 但无路由守卫），避免本次重构改变行为；重定向入口保留 auditLabel/variants；/ops-settings 导航挂 /ops-settings/:section 并用 nav.order 排序。
- 门禁：6 个 mjs `node --check` 通过；web tsc / eslint / build 通过；routes:json 两次字节一致；route-audit 通过；interaction audit `--only=/dashboard` pages=2/issues=0/hard=0；acceptance 首轮 PASS 23 / FAIL 2，两条均为运行中 3700 进程早于 `GET /admin/settings/schema` 提交导致的 404，重启进程后复跑（见 §3）。

### 30 W5 可用性单一评估器与周期冷却（架构评审候选 #8，本提交）
- `api/src/l05_service/availability.py` 重写为唯一评估器：`AvailabilityState`（normal/cooling/closed，closed 优先）、`AvailabilityView(state, cooldown_until_ms)`、`AvailabilitySnapshot`；`evaluate(session, now_ms)` 一次算出规则、目标与模型排除集，upstream 作用域继承到全部模型/目标，未知 scope 422。API 与渲染都只读 snapshot。
- `availability_rules` 成为唯一写入权威：模型行 `cooldown_until_ms` 降级为规则投影/缓存（`sync_cooldown_projection` / `sync_all_cooldown_projections`，过期缓存不得反向延长冷却）；PATCH `cooldown_until_ms` 写确定性托管规则 `rule_row_<sha256>`，enable/release 清托管规则；启动时 `migrate_legacy_cooldowns` 幂等采纳旧库未来 deadline（加法式，不删列/规则）。
- 周期冷却保留并修边界：窗口半开 `[start,end)`，跨零点窗口按开始日归属 weekly/monthly，`rule_deadline_ms` 返回当前窗口结束（修正跨零点结束后错误延到次日）；`create/update/delete_rule` 完整 CRUD，`/admin/availability-rules` 薄路由委托；`rules_changed_since` 覆盖一次性到期与周期窗口开关，冷却重渲染任务改用它。
- `routers_models` 的 `_um_body/_pm_body` 统一输出 `availability{state,cooldown_until_ms}`；批量 enable/release/cooldown 同走 availability；渲染层 `rendering.py` 只 import evaluate，不再读 `is_cooling` 或投影列。
- 前端模型页补周期冷却 UI（原 ticket 10 只有单次冷却）：`web/src/pages/models.tsx` 新增「周期」按钮与 `PeriodicCooldownDialog`（重复方式 daily/weekly/monthly + 起止时间 + 星期/每月日期 + 备注；POST `/admin/availability-rules`，列出该行已有周期规则可逐条解除）；状态列在 Badge 下显示「周期：每天 02:00–04:00」摘要；启用/解除（单行与批量）先删除该对象的周期规则再写行状态，语义与「启用会清掉冷却」一致。`web/src/types.ts` 的 `AvailabilityRule` 改为服务端真实字段（scope_id/expires_at_ms/schedule_json/created_at_ms），mock 同步并补规则 CRUD 处理器。
- 文档：ADR-004 状态改「已定（2026-11-18 架构评审 #8）」，明确两措施/一次+周期均一等/唯一写入权威/投影只读/统一状态/启动迁移/无破坏性迁移/投影滞后；ADR-018 修订为「UI 提供紧凑周期冷却编辑（重复方式+时间窗），不做完整排期日历；后端周期冷却完整保留」；GLOSSARY §3、README、DELIVERY、ACCEPTANCE、FEATURE-PARITY、api-contract §3.5 同步。
- 测试：新增 `unit/test_availability.py`（15：半开 daily、weekly ISO、跨零点开始日、monthly、跨零点结束、托管规则+投影、周期投影、状态词表/优先级/upstream 继承、legacy 采纳/清理、stale 投影、rules_changed_since）、`integration/test_availability_projection_api.py`（3：PATCH 单托管规则+投影同步/解除删除、周期规则驱动 API cooling 与 render 排除、ban 使 state=closed 而 enabled 仍 true）；改 `test_model_management_api.py` 到期测试走托管规则。

### 31 独立审查缺陷修复（P1 / P2，本提交）
- P1 `GET /admin/usage/events/{event_id}` 的 `raw_json` 是字符串，中央过滤只递归 dict/list，普通 `logs:read` 账号原可读到字符串内 cost/charge：`routers_usage._sanitized_raw_json` 改为 parse→`field_filter.sanitize`→dumps，事件详情投影处强制清洗；`test_rbac_field_filter.py` 增加 raw_json 含 cost/charge 的用例（无金额账号顶层与字符串内均无金额键，普通账号仅保留 charge）。
- P2 设置校验：`settings_schema._validate_base_url` 捕获 `urlsplit/port` 的 `ValueError`（`http://[::1` 不再 500），拒绝空白、越界端口；`coerce_setting` 拒绝非 int/str 输入，`kind=select`（timezone）必须命中 options（`Not/AZone`、dict 不再入库）；`test_settings_schema.py` 新增边界用例并断言不覆盖旧值。
- P2 前端：`audits.tsx` 补末页越界夹取与 `keepPreviousData`；`mock.ts` 匹配前剥 query 并补 audit-logs 的 limit/offset 切片；`data-table.tsx` 服务端模式隐藏无效的本地筛选输入框（原只关了排序）。
- P2-6 遗留（既有，不在本轮修复）：运营设置页「运行信息」区始终为空——`GET /admin/settings` 只返回 7 个 schema 键，而 `RuntimeSection` 过滤 `RUN_INFO_KEYS`（gateway_artifact_path/usage_poll_interval_s/client_key_length/price_version），且 `test_settings_schema.py` 断言 schema keys == served keys，不能直接把只读运行信息塞进该接口。需后续单独设计只读运行信息端点。

### 32 本地数据目录统一为 .data_store（本提交）
- 默认 SQLite 与数据面配置从 `api/slipstream.db` + `api/data/ag-config` 迁入 `api/.data_store/`：`settings.database_url` 默认 `sqlite:///./.data_store/slipstream.db`，`ag_config_dir` 默认 `./.data_store/ag-config`（仍按进程 CWD 解析为绝对路径）。
- `l04_repo.base.make_engine` 对 SQLite 文件 URL 预创建父目录（跳过 `:memory:` / `file:` URI），新克隆首次启动不再因缺目录失败；`api/scripts/seed_demo.py`、`docs/DELIVERY.md`、相关测试与 `.gitignore`（`api/data/` → `.data_store/`）同步更新。
- 现有演示库与配置已迁移到 `api/.data_store/`，空的 `api/data/` 删除；`api/.data_store/` 不入库。
- 验证：重新 seed 后 smoke **40/40**；全量 pytest **362 passed**；`ruff check src tests` 全绿；`gen_ts.py --check` no-op；web typecheck/lint/build/check:bundle PASS（首包 gzip **196.3KB / 68 chunk**）；浏览器验收 `--strict` **PASS 25 / FAIL 0**（证据 `ops/checks/.logs/acceptance/20261119-000107/report.md`）。迁移后执行一次 `POST /admin/config/apply` 重新下发：`config.yaml` 的 6 个 key 路径全部指向 `api/.data_store/ag-config/keys`，`/admin/config/status` 与 active revision hash 一致。

## 3. 收口结论（2026-11-18）

- 二期 ticket 01–22 全部合入 `phase2/integration`；架构评审候选 #1–#8 全部完成并本地提交（§24–§31），未 push。旧入口 `/cost`、`/revenue`、`/unpriced`、`/upstream-prices`、`/downstream-prices` 保留重定向，不是独立页面。
- 单端口部署：`web/dist` 由控制面 3700 同源托管（`api/src/l06_api/spa.py`），管理台不再单独占端口；`/`、`/login`、`/models` 深链均 200 HTML，`/assets/*.js` 200，`/admin/health` 200，未知 `/admin/*` 保持 JSON 401/404，`/openapi.json`、`/docs` 200。
- 最终门禁（2026-11-18 23:01 复跑）：
  - 后端：pytest 全量 **360 passed / 0 failed**（123.29s）；`ruff check src tests` → All checks passed；`python ops/contract/gen_ts.py --check` → 生成物与 OpenAPI 一致。
  - 前端：`npm run typecheck` / `npm run lint` / `npm run build` 全绿；`check:bundle` PASS（首包 gzip **196.3KB / 68 chunk**，echarts 独立按需 148.2KB）。
  - 接口 smoke：**40/40**。
  - 浏览器验收：`acceptance_browser.mjs --channel msedge --strict` → **PASS 25 / FAIL 0 / PENDING 0 / SKIP 0**（证据 `ops/checks/.logs/acceptance/20261118-223558/report.md`）；W4 重构时因 3700 进程早于 `GET /admin/settings/schema` 提交出现的 2 条 404 失败，在重启进程后消失。
  - 路由/设计审计：`route-audit.mjs` → 29 路由 / 23 页面模块 / 21 导航，exit 0；`check-ui-foundation.mjs` → 37/37；`terminology_audit.mjs` → PASS（error 0 / warn 3，均为 `web/src/lib/mock.ts` 文案里单数 `Token` 的既有告警）。
  - 全站交互审计：`interaction_audit.mjs --channel msedge --max-controls 400` → 37 页 / 2643 控件 / 1992 操作 / 455 禁用 / 89 重渲染后未操作 / 187 弹层 / 软问题 **17** / 硬失败 **0**（证据 `ops/checks/.logs/interaction/20261118-223722/report.md`）。17 条全部是既有软问题：上游列表「删除」前的连通性测试 toast（3 条）与上游详情 Transforms 编辑器主动提交不完整表单的 422/toast（14 条），页面均已提示；模型页新增周期冷却弹层（78 次弹层）无问题。
- P2-6 遗留：运营设置「运行信息」区仍为空（`GET /admin/settings` 只返回 7 个可编辑 schema 键，前端 `RUN_INFO_KEYS` 尚无只读端点），已在 §31 记录，需后续单独补只读运行信息端点。
- 设计巡检：`docs/DESIGN-AUDIT.md`（静态检索设计 tells + 交互审计逐页截图目视核对，无失败退出码）。

## 4. 复跑命令

```bash
# 后端
cd api && python -m pytest -q
python ops/checks/smoke_api.py

# 前端
cd web && npm run check:bundle
npx tsc --noEmit
npx eslint src
npm run build
# 页面/路由清单变更后：cd web && npm run routes:json
# OpenAPI 变更后：python ops/contract/gen_ts.py（提交生成物，--check 供 CI）

# 验收
node ops/checks/route-audit.mjs
node web/scripts/check-ui-foundation.mjs
node ops/checks/terminology_audit.mjs
node ops/checks/interaction_audit.mjs --channel msedge
node ops/checks/acceptance_browser.mjs --channel msedge --strict
```
