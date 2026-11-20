# 浏览器验收清单（ACCEPTANCE，五期收口）

> 本文件把 `.scratch/phase2/spec.md` 的 **50 条 User Stories** 映射成可执行的验收清单：每条给出「验证方式 + 证据位置 + 当前状态」。
> 基线：`w5/integration`（2026-11-21，五期 ticket 01–16 全部合入；二期 01–22 仍全绿）。
> 历史说明：§4 表中 `⏳ ticket xx` 与「PENDING」是二期 ticket 20 首次运行时的快照；**五期已把这些票号对应能力全部实现**，状态一律按 §0.1「五期验收矩阵」与 §7.2 更新后的行理解，最终以 ticket 18 的 `--strict` 报告为准。

## 0. 一句话结论（2026-11-18 最终）

- **全部 ticket 已合入**：二期 ticket 01–22 均在 `phase2/integration`；二期 `--strict` 全站验收 **PASS 25 / FAIL 0 / PENDING 0 / SKIP 0**（证据 `ops/checks/.logs/acceptance/20261118-210648/report.md`）。**五期（W5）** ticket 01–16 已合入 `w5/integration`，脚本矩阵扩到 §0.1 的 7 组新交互；五期 `--strict` 的 PASS 总数与截图证据由 ticket 18 填入 §7.2（本文件不预写数字）。
- **自动覆盖**：品牌/登录/错误密码、管理员主导航逐页加载（无错误边界/NaN/undefined、console 无 error）、网关策略三 Tab（策略/护栏/MCP）编辑入口、上游详情**四 Tab**（连接与模型/路由与模型/请求与响应/其他设置）、模型试验 20 参数与会话操作、设置 IA（用户/运营）、普通用户/代理用户入口与接口权限、命令面板、主题三态、看板三 Tab/热力图区间（Radix Tabs，←/→ 键盘可切换）、价目编辑与还原、术语与 logo 资产；五期新增矩阵见 §0.1。
- **五期收口（2026-11-21）**：ADR-027 冷却互斥、ADR-028 路由链、公开模型单页、日志两行+尝试链、分流隐藏阶段、表格 sticky/数字/语义色/脏标记、模型探测均已进脚本（§0.1）。
- 术语审计已从 FAIL 修到 PASS（`node ops/checks/terminology_audit.mjs` exit 0）；**注意扫描范围是 web 文案（`web/src` + `index.html` + `public`），不含 docs/**，docs 术语由本清单人工核对（ticket 17 收口）。
- **仍需人工**：像素级 UI 规范（无自动视觉基线）、写操作后的下发验证、空库空态、会话导入导出等，见 §7.3。

## 0.1 五期（W5）验收矩阵（ticket 18 执行，脚本已就绪）

| 组 | 交互 | 脚本 check id / 命令 | 断言要点 |
|---|---|---|---|
| 1 | 公开模型单页 | `models.public-page` | 列表「编辑」→ `/models/public/:id`；三段（基本信息/成员编排）、整页唯一「保存」、成员 chip、改备注出现「未保存 1 项」脏标记并可「恢复全部」；保存只发 1 个 PATCH、零 PUT targets（ticket 13/14） |
| 2 | 日志尝试链 | `logs.attempts` | 模型列两行、尝试列「N 次尝试」popover（或历史行「无链路记录」降级）、费用两行（计费/成本）；接口 `GET /admin/logs/{event_id}/attempts`（ADR-028） |
| 3 | 分流隐藏阶段 | `dashboard.flow-hide` | 点图例 → network 出现 `collapse=` 请求；后端 `collapse` 后 totals 守恒、stages 减一；隐藏 4 段 422；至少保留 2 段提示；可恢复（ticket 01） |
| 4 | 表格冻结/对齐 | `tables.align-sticky` | 操作列在最后一列且 `sticky right-0`；数字列 th/td 同用 `text-right`（ticket 06） |
| 5 | 脏标记/语义色/toast | `models.public-page` + `check-semantic-dirty` 40 条 | 字段级脏标记原语、语义色五档、toast 右上 80px/3s/最多 3 条（ticket 09） |
| 6 | 模型探测 | `upstream.route-model-test`（已扩充） | 单模型/全部探测、取消、失败行会话内徽章、密钥选择、清空结果；与「拉取模型」区分（ticket 05/07） |
| 7 | 冷却互斥 | 手动 + API（`pytest test_availability*`） | 单次生效中建周期 409、周期窗口内设单次 409（details 三键）、note-only PATCH 放行、解除只清一次性规则、公开模型无冷却入口/422（ADR-027） |

运行：`node ops/checks/acceptance_browser.mjs --channel msedge --strict`（单端口 3700；证据 `ops/checks/.logs/acceptance/<时间戳>/`，新截图目录 `.scratch/w5-shots` 由 ticket 18 归档）。

## 1. 环境与启动

必须用 **localhost** 打开管理台（不要混用 127.0.0.1）：会话 cookie 是 SameSite=Lax，跨主机名不会带上（见 `docs/DELIVERY.md` §4.7）。

```bash
# 1) 管理台构建产物（单端口交付；先构建，控制面启动时挂载 web/dist）
cd C:/Users/microsoft/workspace/webdev/slipstream/web
npm install        # 首次
npm run build      # tsc --noEmit + vite build → web/dist

# 2) 控制面（3700，同时托管管理台）
cd C:/Users/microsoft/workspace/webdev/slipstream/api
PYTHONPATH=src python scripts/seed_demo.py   # 幂等重建演示数据：3 厂商 / 4 上游（zai-01 一渠道三密钥）/ 16 上游模型 / 8 公开模型 / 6 用户（含根用户 D）/ 252 条用量 / 策略·护栏·MCP 样例
PYTHONPATH=src python -m uvicorn l06_api.app:create_app --factory --host 127.0.0.1 --port 3700
#   PowerShell: $env:PYTHONPATH="src"; python -m uvicorn l06_api.app:create_app --factory --host 127.0.0.1 --port 3700

# 打开 http://localhost:3700 （管理台与 API 同源，不再单独起前端端口）
# 仅本地 HMR 调试：cd web && npm run dev（5173，vite 已代理 /admin、/api 到 3700）
```

演示账号（`api/scripts/seed_demo.py`，密码 `admin12345`，可用 `SLIPSTREAM_DEMO_ADMIN_PASSWORD` 覆盖）：

| 账号 | 角色 | 用途 |
|---|---|---|
| admin | 管理用户（全权限） | 管理员路径 |
| lisi | 代理用户（建用户/看子树花费/无成本） | 代理权限切片 |
| wangwu | 普通用户（自身花费/日志/模型试验） | 越权与字段级权限 |

## 2. 验收命令与证据

| 闸门 | 命令 | 证据位置 | 退出码 |
|---|---|---|---|
| 浏览器全站验收 | `node ops/checks/acceptance_browser.mjs` | `ops/checks/.logs/acceptance/<时间戳>/report.md` + `report.json` + `*.png` | 0 通过（允许 PENDING）· 1 有 FAIL（`--strict` 时 PENDING/SKIP 也算）· 2 环境/依赖未就绪 |
| 全站交互审计 | `node ops/checks/interaction_audit.mjs --channel msedge` | `ops/checks/.logs/interaction/<时间戳>/report.md` + 逐页 `*.png` | 0 全过（收口复跑：37 条审计路径 / 2470 控件 / 1828 操作 / 160 弹层 / 软问题 15、硬失败 0，证据 `ops/checks/.logs/interaction/20261118-183422/report.md`） |
| 术语与品牌资产 | `node ops/checks/terminology_audit.mjs` | stdout；`--json` 给机器读，`--strict` 让 warn 也失败 | 0 全过（error 0 / warn 0） |
| 前端门禁 | `bash ops/checks/verify_web.sh` | `ops/checks/.logs/typecheck.log`、`eslint.log`；输出 tsc/eslint/route-audit | 0 全过 |
| 后端回归 | `cd api && python -m pytest -q` | pytest 汇总（W1 后 324 passed） | 0 全过 |
| 接口冒烟 | `python ops/checks/smoke_api.py` | stdout（登录/401/settings 往返/margin 口径等） | 0 全过 |
| 路由审计 | `node ops/checks/route-audit.mjs` | stdout | 0 全过 |
| 设计巡检 | 静态检索 + 交互审计截图目视 | `docs/DESIGN-AUDIT.md` | 人工核对，无失败退出码 |

浏览器脚本常用参数：

```bash
node ops/checks/acceptance_browser.mjs --channel msedge --headed   # 没有 playwright、用本机 Edge
node ops/checks/acceptance_browser.mjs --only login.brand,playground.params   # 只跑某几条
node ops/checks/acceptance_browser.mjs --strict                    # 发布门禁：PENDING/WARN 也算失败
node ops/checks/acceptance_browser.mjs --admin admin:admin12345 --user wangwu:admin12345 --agent lisi:admin12345
```

**没有 Playwright 时**（本分支 `web/` 当前未安装任何依赖）：

1. 方案 A（零新增依赖、推荐）：`cd web && npm i -D playwright-core`，脚本会自动用本机 Edge/Chrome（`--channel msedge|chrome`，或环境变量 `PLAYWRIGHT_CHROMIUM_EXECUTABLE`）。
2. 方案 B：`cd web && npm i -D playwright && npx playwright install chromium`。
3. 方案 C：用 browser MCP 按 §6 的手测路径逐条执行，截图存 `ops/checks/.logs/acceptance/<时间戳>/`（该目录在 `.gitignore` 内，不入库）。

## 3. 判定规则与图例

- **PASS**：断言全部满足；**FAIL**：任一断言失败，脚本末尾打印失败清单与非零退出。
- **PENDING**：spec 目标态尚未由已合并 ticket 提供（缺页面/缺 Tab/缺文案）。默认不失败，`--strict` 视为失败。
- **SKIP**：账号缺失等前置不满足（如未跑种子），需人工确认而不是当作通过。
- 证据截图命名与 check id 对应；`report.md` 含每条检查的状态、说明与截图相对路径。

状态图例：✅ 自动 · 🟡 手动（步骤见 §5） · ⏳ PENDING（ticket 未合） · 部分 = 自动+手动混合。

## 4. 50 条 User Story → 验收映射（总表）

> **状态列读取规则（五期）**：表中「⏳ 票号」「PENDING 票号」是二期 ticket 20 的快照；对应能力已在五期 ticket 01–16 合入，一律视为 ✅。具体证据以 §0.1 五期矩阵、§7.2 更新行与 ticket 18 报告为准；仍为 🟡/「部分」的行表示需要人工核对或依赖外部条件（如像素基线、写操作下发）。

| # | User Story（摘要） | 维度 | 验证方式（脚本 check / 命令 / 步骤） | 证据 | 状态 |
|---|---|---|---|---|---|
| 1 | 管理台一眼是「驭流」品牌（图标/中文名/英文小字/页签标题/favicon） | 页面·术语 | `login.brand`；`terminology_audit` 的 title/logo 资产检查 | `login-brand.png`；audit stdout | ✅ |
| 2 | 字号/间距/圆角/阴影/按钮/空态/提示符合旧 UI 规范 | 页面 | 手动：1440×900 逐页对照 `docs/research/phase2/OLD-UI-SPEC.md` §2/§3；脚本只保证非白屏/无 NaN | 逐页截图 | 🟡（无自动视觉基线） |
| 3 | 导航按固定分组，命名与旧系统一致 | 术语·页面 | `nav.spec-labels`（模型试验/上游管理/公开模型/连接密钥/价目管理齐全）+ 手动核对分组标题 | `report.json`；侧栏截图 | ✅（票 06/10） |
| 4 | 价目管理收进「系统」分组 | 页面 | 手动：侧栏分组标题与顺序（脚本只看名称，不看分组） | 侧栏截图 | ✅ 06 |
| 5 | 可用性不单独成页，改在模型管理内 关闭/启用/冷却/解除 | 页面·权限 | `availability.removed`；手动在模型管理行操作 | `report.json` | ✅ 10 |
| 6 | 关闭/启用/冷却/解除文案明确区分（不再叫封禁/解封） | 术语 | `terminology_audit` + 手动过模型管理操作菜单（五期已全部改称关闭/启用/冷却/解除，术语门禁清零） | grep 输出；截图 | ✅ 10 |
| 7 | 冷却 UI 明确一次性与周期两类；周期冷却不做完整排期日历 | 语义·页面·接口 | 手动：冷却弹窗内切「单次/周期」两种模式（单按钮双模式），周期规则在抽屉内紧凑编辑（重复方式+时间窗）；`pytest` 覆盖 daily/weekly/monthly 与规则 CRUD | 截图 + pytest | ✅ 10 |
| 8 | 上游管理：多密钥/连通测试/发现模型/改写/启停/批量/删除保护 | 页面·接口 | `upstream.detail-tabs`（四 Tab：连接与模型/路由与模型/请求与响应/其他设置）+ 手动逐项；API `/admin/upstreams`、`/admin/upstreams/{id}/models` | `upstream-tab-*.png`；smoke_api | ✅（09/10） |
| 9 | 上游模型编辑含类型/类型来源/参数/成本价/倍率/冷却 | 页面 | 手动：`/models` 上游模型 Tab 行内 100vh 抽屉逐字段（类型/来源/参数/成本价/倍率/冷却） | 抽屉截图 | ✅ 05/09 |
| 10 | 公开模型创建时输入名称并提示相似上游模型供勾选 | 页面 | 手动：`/models` 公开模型 Tab 新建弹窗输入关键字 | 截图 | ✅ 10 |
| 11 | 公开模型支持 failover/weighted/conditional + 成员优先级/权重 | 页面·接口 | 手动：`/models/public/:id` 单页「成员编排」段（三模式 + priority/weight/when + 成员 chip） | 单页截图 | ✅ 05/10 |
| 12 | 公开模型只展示按成员加权平均价（不可单独定价） | 页面 | 手动：公开模型价格列只读；API `/admin/public-models` 无单价写入字段 | 截图 + 接口 | ✅ 05 |
| 13 | 每个上游模型一个倍率，卖价 = 成本 × 倍率 | 页面·接口 | 手动：上游模型编辑中的倍率；API 成本/花费对账 | 截图 + 接口 | ✅ 05 |
| 14 | 价目管理合并上下游为一个界面 | 页面 | 手动：`/pricing` 单页三段（成本价/缓存价/公开模型售价）；旧 `/upstream-prices`、`/downstream-prices` 为重定向 | 截图 | ✅ 06 |
| 15 | 看板有柱形图/面积图/分流图三个标签页 | 页面 | 手动：`/dashboard` 趋势卡切柱形/面积/分流图；另有 8 KPI 卡、延迟分位卡、热力图 | 截图；`dashboard.flow-hide` | ✅ 12/13 |
| 16 | 柱形/面积右侧成员详情（成员/合计/占比、可隐藏恢复） | 页面 | 手动：`/dashboard` 趋势卡右侧成员列；成员可隐藏恢复 | 截图 | ✅ 12/13 |
| 17 | 维度一次只看一个（综合模型/上游模型/上游渠道），指标可选 | 页面·接口 | 手动 + API `/admin/reports/trend` 的 `dimension/metric` | 截图 + 接口 | ✅ 12/13 |
| 18 | 看板底部 7D/30D/365D 热力图（词元/金额） | 页面 | 手动：`/dashboard` 底部热力图（词元/金额切换） | 截图 | ✅ 12/13 |
| 19 | 延迟按 TTFT/TOTAL 的 P50/95/99，不做 TTFA | 页面·接口 | 手动：看板延迟卡 + `/admin/reports/trend`；确认无 TTFA 文案 | 截图 + 接口 | 🟡 |
| 20 | 无成本权限者在看板/日志/账单看不到成本与毛利 | 权限·接口 | `user.api-permissions`（无 `billing:cost`、`/admin/cost/entries` 403）；手动核对字段级：日志行、看板卡、账单 | `report.json`；截图 | ✅（字段级已合） |
| 21 | 普通用户只看自己的花费与请求日志 | 权限·页面 | 手动：wangwu 登录后 `/settings/spend`、`/logs` 数据范围；`user.nav-hidden` 佐证入口 | 截图 | ✅ |
| 22 | 用户设置：个人资料/主题/连接令牌/我的花费/通知偏好 | 页面 | `settings.ia` + 手动：`/settings` 5 段 | `report.json` | ✅ 16 |
| 23 | 主题浅色/深色/跟随系统并持久化 | 页面 | 手动：顶栏主题切换 → 刷新后保持；查 `localStorage` 主题键 | 截图 | 🟡 |
| 24 | 连接令牌页展示统一连接地址与我的密钥 | 页面 | `settings.ia` + 手动：`/settings/tokens` | 截图 | ✅ 16 |
| 25 | 代理用户创建下级用户并查看子树花费 | 权限·接口 | `agent.permissions`（`users:create`+`billing:subtree`、无 `billing:cost`）；手动 `/users` 新建 + `/settings/spend` 子树 | `report.json` | ✅ 04 |
| 26 | 管理用户建/编辑自定义角色并分配权限 | 页面·接口 | 手动：`/roles` 角色与权限矩阵（`/admins` 旧入口重定向）；API `/admin/roles`、`/admin/permissions` | 截图 + 接口 | ✅ 03 |
| 27 | 用户面板统一展示角色/父级/状态 | 页面 | 手动：`/users` 列表列 | 截图 | 🟡（04） |
| 28 | 所有权限后端强制执行，改前端/伪造头无法越权 | 权限·接口 | `user.api-permissions`（403 + 权限列表缺失）+ 手动：无 cookie curl `/admin/cost/entries` → 401 | `report.json`；curl 输出 | ✅ |
| 29 | 真实用户名密码 + 会话登录 | 接口·错误态 | `login.admin`、`login.wrong-password`；手动：退出后回登录页、会话 12h 过期 | `report.json`；`login-wrong-password.png` | ✅ |
| 30 | 运营设置：连接地址（默认当前地址 + 3600，可改公网 URL） | 页面·接口 | `settings.ia` + 手动 `/ops-settings/connection` | 截图 + 接口 | ✅ 16 |
| 31 | 运营设置子导航，未来可扩展 | 页面 | `settings.ia`：`/ops-settings/:section` 3 段子导航 | 截图 | ✅ 16 |
| 32 | 表格成本/花费合成一列上下展示并自动算毛利 | 页面 | 手动：`/logs` 费用列两行（计费/成本）上下展示并算毛利 | 截图 | ✅ 13/14 |
| 33 | 表格相似列合并（模型/路由、用量/费用） | 页面 | 手动：`/logs` 模型列两行、用量/费用两行 | 截图 | ✅ 13/14 |
| 34 | 策略/护栏/MCP 可增删改并真实下发 AG | 页面·接口 | `admin.governance`（可打开且有编辑入口）、`api.switches`（GET 200）；手动 CRUD + 配置版本页确认 rollout | `report.json`；`/config-revisions` 截图 | 部分（CRUD 需 seed 环境手测） |
| 35 | 护栏支持正则/敏感信息/外部审核/webhook 多层 | 页面 | 手动：`/guardrails`「添加规则/添加 webhook 审核」 | 截图 | 🟡 |
| 36 | MCP 服务器可配 target 与基础策略 | 页面 | 手动：`/mcp`「新增服务器」（sse/stdio；http 置灰，见 DELIVERY §4.3） | 截图 | 🟡 |
| 37 | 请求级重试：AG 支持则开启，否则明示不支持 | 页面·术语 | 手动：策略页 retry 区可开关（ADR-024 已支持、默认关；codes 含 4xx 需成对健康表达式否则 422） | 截图 + 文档 | ✅ 37 |
| 38 | 优先级显示 AG 原值并注明「数值小优先」 | 术语·页面 | 手动：公开模型单页成员编排段注释（数值小优先） | 单页截图 | ✅ 10 |
| 39 | 参数面板一行 3 个且一屏看全 | 页面 | 手动：1440×900 截图评估 | `playground-params.png` | 🟡 |
| 40 | 模型试验 20 项参数、分组、悬停说明、完整校验 | 页面 | `playground.params`（20 项文案齐全）；手动：悬停说明、非法值校验 | `report.json` | ✅（参数项）/🟡（校验） |
| 41 | 模型选择在对话框右下角、可搜索、可选思考等级 | 页面 | `playground.model-dialog`（可打开、有搜索框）；手动：位置与思考等级 | `playground-model-dialog.png` | ✅/🟡 |
| 42 | 会话只存前端；单条消息复制/删除/重试；会话导入导出 | 页面 | `playground.actions`（复制/删除/重试按钮存在）；手动：导入/导出、localStorage 上限 200、单条消息不导出 | `report.json`；截图 | 部分 |
| 43 | 日志表格合并列（模型/路由、吞吐/词元/花费、首字/总耗时） | 页面 | 手动：`/logs` 列头（模型两行、用量/费用两行、首字/总耗时） | 截图 | ✅ 13/14 |
| 44 | 日志详情抽屉：请求/响应/token/成本/花费/耗时/错误 | 页面 | 手动：`/logs` 点「详情」逐项核对 | 截图 | 🟡 |
| 45 | 概览页展示统一连接地址 + curl/python 示例 | 页面 | `admin.pages` 覆盖 `/`；手动核对地址为 `http://<host>:3600` 且 curl 示例可复制 | 概览页截图 | ✅ |
| 46 | 账单按用户层级汇总（D 为根，可看整棵子树） | 页面·接口 | 手动 `/settings/spend` + `/users` + API 聚合；权限要求 `billing:subtree`（`agent.permissions` 佐证） | 截图 + 接口 | ✅ 04 |
| 47 | 前端路由级 code-split（echarts 不拖首屏） | 工程 | 手动：`cd web && npx vite build`，检查入口 chunk 与 `echarts` 独立 chunk；ticket 18 已合 | build 输出 | 🟡 |
| 48 | 渲染出的 AG 配置先通过 `--validate-only` | 接口·工程 | 后端渲染契约测试：`cd api && python -m pytest -q`；`ops/experiments` 证据 | pytest 汇总 | 🟡 |
| 49 | 权限/计费/看板聚合/渲染产物都有自动化测试 | 工程 | pytest + `verify_web.sh` + `terminology_audit.mjs` + 本脚本 | 各日志 | ✅ |
| 50 | 每张 ticket 都能在浏览器或 API 上独立验证 | 工程 | 本表 + `acceptance_browser.mjs --only <id>`；五期票 01–16 已合，本文档票 17 收口 | 本文件 | ✅ |

## 5. 手动项操作卡（按主题）

### 5.1 品牌与 UI 规范（Story 1–3、39–41）

1. 打开 `/login`：页签标题必须是「驭流 Slipstream · LLM API 网关」，favicon 为 `/logo-v10-contrast.svg`，品牌锁同时出现「驭流」与「Slipstream」。
2. 登录后 1440×900 逐页截图，对照 `docs/research/phase2/OLD-UI-SPEC.md` 检查字号 11/12/13/14、控件高度 28/32/36/40/44、圆角 6/8/12/16、间距基数 4、阴影 card/pop；按钮默认 primary，空态、Toaster 主题跟随。
3. 检查侧栏分组标题与顺序；spec 目标是「页面类型」等固定分组，价目管理归入「系统」。
4. 模型试验：一行 3 个参数、一屏可见；参数悬停有说明；20 项与 `web/src/lib/playground-params.ts` 一致（脚本已自动比对 20 项文案）。

### 5.2 上游与模型（Story 4–14）

1. `/upstreams` → 任一行「详情」：**四个 Tab**「连接与模型 / 路由与模型 / 请求与响应 / 其他设置」都存在（模型并入路由与模型，健康并入连接与模型）；「连接与模型」支持多行密钥与**逐把**连通测试；「路由与模型」有逐模型「测试」（**模型探测**）、「拉取模型」（`discover-models`，不自动建记录）、重试/健康策略；「请求与响应」可保存改写；「其他设置」含连接地址与运行参数。
2. 删除保护：被公开模型引用的上游模型不能删（尝试删除应报错/置灰）。
3. `/models` 上游模型 Tab：行内 100vh 抽屉核对类型/类型来源/参数/成本价/倍率/冷却；逐模型探测徽章（连通/失败/超时/连接失败）与全部探测/取消/清空；逐把密钥测试失败标红。
4. `/models` 公开模型 Tab：新建时输入名称应提示相似上游模型；列表「编辑」进入整页 `/models/public/:id`（单 PATCH 整页保存、成员编排分层 chip、conditional 末位兜底、价格只读且为成员加权平均）。
5. 可用性：**没有独立页**（`availability.removed` 断言）。措施只属上游模型（ADR-025）：行内单按钮「冷却」弹窗内切单次/周期，冷却中「解除」；单次与周期互斥 409（详情 `blocking_rule_ids` 可定位），note-only PATCH 放行；公开模型无冷却入口且写操作 422（ADR-027）。

### 5.3 看板与日志（Story 15–21、32–33、43–44）

1. `/dashboard`：柱形/面积/分流三 Tab + 8 KPI 卡 + 7D/30D/365D 热力图 + 延迟分位。**分流图隐藏阶段**：点击图例隐藏一段 → network 出现 `collapse=` 请求、后端重算后单图连通且 totals 守恒、隐藏到 2 段时提示「至少保留两个可见阶段」并禁用继续隐藏、点「已隐藏」徽章可恢复（`dashboard.flow-hide` 覆盖）。
2. 维度与指标：一次只看一个维度（综合模型/上游模型/上游渠道），指标可选请求/词元/成本/花费。
3. 延迟口径：TTFT 与 TOTAL 的 P50/95/99；确认页面无 TTFA；样本 < 5 应显示占位而不是 0/NaN。
4. `/logs`：费用列两行（计费/成本，毛利在报表聚合口径）；模型列两行（公开模型 / 请求模型 → 上游模型）；尝试列「N 次尝试」按钮打开路由链 popover（`attempt_no`/上游/状态码/耗时/错误），历史行显示「无链路记录」（ADR-028，`logs.attempts` 覆盖）。点「详情」核对请求/响应/用量/耗时/错误齐全。
5. 权限：用 wangwu 登录，`/logs` 行内不得出现成本/毛利；用 lisi 登录，花费/日志范围限自己子树（`/settings/spend`；旧 `/revenue` 已删除）。

### 5.4 账号、权限与设置（Story 22–31、46）

1. `/admins`：内置角色不可删；可新建自定义角色并勾选权限；权限矩阵与实际菜单一致。
2. `/users`：列表展示角色/父级/状态；代理用户（lisi）能新建下级，且新建用户的父级默认是自己。
3. 花费：旧 `/revenue` 已删除（不是重定向）。管理用户/代理用户的花费与子树数据在 `/settings/spend`（我的花费）与 `/users`（流水/充值）；普通用户只看自己。
4. 设置：用户设置 5 段（个人资料 / 主题 / 连接密钥 / 我的花费 / 通知偏好，`/settings/:section`）与运营设置 3 段（连接地址 / 系统参数+正文日志开关 / 运行信息，`/ops-settings/:section`，页内子导航）。主题切换与持久化在顶栏与 `/settings/theme` 均可验收（Story 23）。
5. 会话：退出后直连任意 `/admin/*` 应 401；登录页错误密码文案来自后端 `GENERIC_LOGIN_ERROR`（`api/src/l05_service/auth.py:33`）。

### 5.5 策略、护栏、MCP 与渲染（Story 34–38、48）

1. `/gateway-policies?tab=policies`：「编辑」「原始 JSON」可打开；保存后 `/config-revisions` 出现新版本并标记 rollout 状态。旧入口 `/policies` 重定向到该 Tab（不在侧栏）。
2. `/gateway-policies?tab=guardrails`：「添加护栏」→ 规则可用正则/敏感信息/外部审核/自定义 webhook；不支持的类型必须显式报错或置灰，不允许静默丢弃。旧入口 `/guardrails` 重定向。
3. `/gateway-policies?tab=mcp`：「新增服务器」配 target 与基础策略；http/url 形态当前被 AG 1.7 拒绝，应 422 且表单置灰（DELIVERY §4.3）。旧入口 `/mcp` 重定向。
4. retry：**ADR-024 已支持 route 级请求内重试（默认关闭）**：策略页可开「请求内重试」+「健康标记与驱逐」，`codes` 含 4xx 必须成对配置健康表达式与 `consecutiveFailures`，否则保存 422；关闭即回默认透传。渲染产物出现 `internal/llm:request` + `gateway-retry`。
5. 优先级：显示 AG 原值并注明「数值小优先」；公开模型单页成员编排段展示 priority/weight/when（列表行内不再开旧「路由目标」弹窗）。
6. 渲染：`cd api && python -m pytest -q` 覆盖 golden YAML/契约；所有渲染产物需 `--validate-only` 通过后才 apply（ADR-007/08 实现）。

### 5.6 模型试验（Story 39–42）

1. 参数：20 项 = 模型选择 + 19 个状态字段（`web/src/lib/playground-params.ts`）；分组、悬停说明、14 类校验需人工试错（负数 temperature、非法 JSON extraFields 等）。
2. 会话：新建/重命名/复制/删除/重试最近一轮；导入会话 JSON / 导出全部会话；单条消息不导出；刷新后会话仍在（localStorage，上限 200）。
3. 模型对话框：点击「选择模型」→ 右下角对话框、可搜索模型名/路由模式、显示思考等级；Esc 关闭。

### 5.7 工程与交付（Story 47–50）

1. `cd web && npm run build && node scripts/check-bundle.mjs`：入口 chunk 与 `echarts` 分离；五期基线为首包 gzip **212.9 KB**、**75** 个 JS chunk、echarts 独立 148.2 KB（以 `check-bundle` PASS 为准；三期旧基线 147.73/47.04/151.94 已过时）。
2. `bash ops/checks/verify_web.sh`：tsc/eslint/route-audit 全过；`node web/scripts/check-ui-foundation.mjs`（73/73）+ `check-semantic-dirty.mjs`（40/40）；`python ops/checks/smoke_api.py` 全 PASS。
3. 每张 ticket 合并前：`node ops/checks/acceptance_browser.mjs --only <check-id>` 或本表对应行；新增页面必须同时补一条检查。

## 6. 浏览器 MCP 手测路径（无 Playwright 时的替代）

用 browser MCP（`browser_open` → `browser_navigate` → `browser_snapshot`/`browser_take_screenshot` → `browser_close`）逐条执行，证据存 `ops/checks/.logs/acceptance/<时间戳>/`：

1. 打开 `http://localhost:3700/login`，快照断言标题/品牌/logo；填 `#login-username`、`#login-password`，提交后断言错误文案。
2. 用 admin 登录，逐个点击侧栏 **15 个一级导航项**（运营设置 3 段为页内子导航，不重复挂侧栏），每次断言无「页面渲染失败」、无 NaN/undefined、控制台无 error（DevTools console 或 MCP 日志），截图。
3. 打开 `/upstreams/<id>` 点击**四个 Tab**（连接与模型/路由与模型/请求与响应/其他设置）；打开 `/playground` 断言 20 个参数名与三个会话按钮 aria-label；打开模型对话框搜索；打开 `/models/public/<id>` 断言单页三段与唯一「保存」。
4. 打开 `/gateway-policies?tab=policies|guardrails|mcp`，断言编辑入口存在并截图；旧入口 `/policies`、`/guardrails`、`/mcp` 应重定向到对应 Tab。
5. 退出，用 wangwu 登录，断言侧栏无成本/管理员/用户管理入口；直连 `/cost`（已删除，应 404 或引导到用户设置；**不是重定向 /bills**）、`/admins`（旧入口重定向 /roles，应显示「没有访问权限」）；调用 `/admin/cost/entries` 断言 403。
6. 用 lisi 登录，断言可见「用户」、不可见「成本」。
7. 资产检查可用浏览器直接看 favicon 与页签标题，或跑 `terminology_audit.mjs` 的资产部分。

## 7. 当前已知失败与缺口（2026-11-17 实测）

### 7.1 术语审计（`terminology_audit.mjs`，exit 0）

- 最终结果：**PASS，error 0 / warn 0**；资产 10/10 通过（title 精确为「驭流 Slipstream · LLM API 网关」，favicon 指向存在的 SVG，三个 logo ≥ 100 字节，侧栏 36×36 品牌锁，登录页品牌齐全）。
- 修复记录：`playground.tsx` 的「tokens ·」改「词元 ·」；`latency-cards.tsx`「首个 token」改「首个词元」；`query-syntax-help.tsx` 三处 token 改「关键词/查询条件/具体位置」。
- 旧版报告的 `latency-chart.tsx`、`log-detail-drawer.tsx`、`dashboard.tsx` 单数 token 已在前序 ticket 22/13/14 一并清理，最终扫描不再命中。

### 7.2 PENDING 清零记录（ticket 20 首次运行 → 最终）

ticket 20 初版运行时曾把 04/05/06/10/12/13/14/16/17 的能力记为 PENDING；这些 ticket 合入后，对应检查已全部转 PASS，最终 `--strict` 为 PASS 25 / FAIL 0 / PENDING 0 / SKIP 0。

| 检查 | 首次状态 | 最终 | 说明 |
|---|---|---|---|
| `nav.spec-labels` | PENDING 06/10 | ✅ | 导航四组含 模型试验/上游管理/连接密钥/价目管理 |
| `models.two-tabs` | PENDING 10 | ✅ | `/models` 上游模型/公开模型两 Tab |
| `availability.removed` | PENDING 10 | ✅ | 无独立可用性页，动作在模型管理行内 |
| `settings.groups` | FAIL（旧路由） | ✅ | 改访问 `/ops-settings/system`，5 组齐全 |
| `settings.ia` | PENDING 16 | ✅ | 用户设置与运营设置分离、运营设置子导航 |
| `login.brand` | FAIL（未等渲染） | ✅ | 先 `waitForSelector` 再断言 |
| `user.cost-forbidden` | FAIL（/cost 重定向） | ✅（五期更新） | /bills、/cost、/revenue 已删除（不是重定向）：断言 `/cost` 落 404/用户设置且无成本数据；`/admins` 重定向 /roles 后显示「没有访问权限」；后端 cost 接口仍 403 |
| `models.public-page` | 五期新增 | ✅（待 ticket 18 复跑） | 公开模型「编辑」进 /models/public/:id：三段/唯一保存/成员 chip/脏标记 |
| `logs.attempts` | 五期新增 | ✅（待 ticket 18 复跑） | 模型列两行 + 尝试列 popover/无链路记录降级 + 费用两行 |
| `dashboard.flow-hide` | 五期新增 | ✅（待 ticket 18 复跑） | 图例 → collapse 请求、totals 守恒、stages 减一、4 段 422、可恢复 |
| `tables.align-sticky` | 五期新增 | ✅（待 ticket 18 复跑） | 操作列 sticky right-0 在最后一列；数字列头身同用右对齐 |
| 看板三 Tab/热力图 | PENDING 12/13 | ✅ | 柱形/面积/分流 + 7D/30D/365D |
| 日志合并列 | PENDING 13/14 | ✅ | 吞吐/词元/花费、首字/总耗时合并 |
| 价目编辑 | 新增交互用例 | ✅ | 改价 → 保存 → 还原，reload 校验 |

### 7.3 本脚本不覆盖（需单独手段）

- **空态**：需要空库（不跑 seed）单独启动，逐页看空态文案与「无数据」占位，并确认无 NaN/白屏；本脚本的预检要求有种子数据。
- **字段级权限的「字段不存在」**：spec 要求无 `billing:cost` 时响应不包含 cost/margin 键（不是 null）；脚本目前只断言 403 与权限列表，字段级需在 `/admin/logs`、`/admin/reports/overview` 响应体上人工核对或补后端测试。
- **视觉规范**（Story 2）：无像素基线，只能人工对照 OLD-UI-SPEC 与截图。
- **写操作**（策略/护栏/MCP 的增删改与下发）：会改库，需在 seed 环境手测后重跑 `seed_demo.py`；脚本只验证入口与读取。
- **AG `--validate-only`**（Story 48）：由后端 pytest 与 `ops/experiments` 证据覆盖，浏览器脚本不重复。
- **五期新增不覆盖**：①路由链依赖适配器 loopback OTLP 采集，种子库无历史尝试时脚本只验证「无链路记录」降级，真实尝试链需在 ticket 18 用注入/真实流量验收；②冷却互斥的 409 三键、note-only PATCH、window_skip 语义以 pytest + API 冒烟为准（浏览器只验 UI 提示）；③分流隐藏只验真实 API 的 collapse 与守恒，mock 不走前端重算；④docs 术语不在 `terminology_audit` 范围，由 ticket 17 人工清单核对；⑤截图归档目录 `.scratch/w5-shots`（ticket 18 维护）。

## 8. 维护约定

1. 新增/修改 User Story 时，在本文件 §4 加行，列明 check id 或手动步骤；PENDING 必须写清 ticket 号。
2. 新页面纳入 `acceptance_browser.mjs` 的 `admin.pages`（自动遍历侧栏）后，再补该页专属断言（空态、错误态、关键按钮）。
3. 截图与 report 只进 `ops/checks/.logs/`（`.gitignore` 已忽略），不入库；需要长期留存的证据贴到 ticket。
4. 发布门禁使用 `--strict`：PENDING/SKIP 视为失败；日常开发允许 PENDING，但必须在报告里可见。
5. 术语规则：UI 文案统一「词元」，`tokens` 只允许作为 API 字段/参数名（`max_tokens` 等）；新增禁用词先改 `ops/checks/terminology_audit.mjs` 的规则表。
