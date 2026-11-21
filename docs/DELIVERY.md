# 交付说明（截至五期，2026-11-21）

本仓为 Slipstream：**agentgateway 当数据面黑盒 + 自建控制面/管理台**（B+ 架构，见 docs/PLAN.md 与 docs/DECISIONS.md）。

状态：二期 ticket 01–22 **全部合入** `phase2/integration`；三期（W1–W7）、四期（多密钥平权/路由链/看板八卡等，M1–M4）与五期（W5 ticket 01–16）均已合入本地 `w5/integration`（未 push），五期门禁与验收基线见 §7。历史逐项变更见 `docs/CHANGELOG-phase2.md`、`docs/CHANGELOG-phase4.md`；五期变更见 §7 与 `docs/CHANGELOG-phase4.md`「五期（W5）变更记录」。

> 阅读提示：§1 已按五期现状更新（OpenAPI/pytest/路由/包体等基线数字）；§3 是二期验收证据原样保留，五期复跑证据见 §7；§6 为三期历史交付段。

## 1. 交付范围

| 层 | 位置 | 内容 | 验证 |
|---|---|---|---|
| 控制面 API | `api/`（l01~l07 分层） | OpenAPI 实测 **99 条路径 / 133 个操作**：上游（多密钥平权）、上游模型、公开模型（单事务整页保存）、模型目标、模型探测、连接密钥（后端 `/admin/api-keys`）、用户与层级/代理、管理员、角色与权限矩阵、价目（成本+倍率）、账单（成本/营收/待补价/我的花费）、日志（含请求尝试链）、审计、配置版本、策略/护栏/MCP、用户设置/运营设置、概览、看板（趋势/流向/热力/成员/延迟，分流支持隐藏阶段投影）、模型试验、真实会话登录 | `pytest` **836 passed**；`ruff check` 全过；`python ops/checks/smoke_api.py` **40/40 PASS**；`gen_ts --check` 最新 |
| 认证与权限 | `api/src/l05_service/auth.py`、`rbac.py`、`l06_api/field_filter.py` | scrypt 密码、DB 会话、httpOnly cookie、5 次/分钟限流；三角色 + 自建角色、**41 个权限键**、字段级金额过滤（缺键非 null）；`X-Admin-Role` 不再信任 | `test_auth_api.py`、`test_rbac.py`、`test_rbac_field_filter.py` |
| 数据面适配 | `api/src/l03_adapters/` | `DataPlaneAdapter` 八方法 SPI + `mock` + `agentgateway` 渲染/下发/回滚/用量拉取；IR 在 `l02_domain/ir.py`；AG 1.7 `--validate-only` 门禁；priority 旧→新语义迁移脚本 | 契约测试 + 渲染快照 + 真实二进制校验 + 迁移集成测试 |
| 管理台 | `web/`（Vite+React+TS+Tailwind v4） | **27 条路由 = 17 个功能页 + 登录 + 404 + 8 个旧入口重定向页**，共 **19 个页面模块**。功能页：快速上手、数据看板（柱形/面积/分流三 Tab + 分流隐藏阶段 + 热力图 7D/30D/365D + 8 KPI 卡）、使用日志（模型列两行 +「N 次尝试」路由链 + 费用两行 + 详情抽屉）、上游管理 + 上游详情（四 Tab：连接与模型/路由与模型/请求与响应/其他设置；逐模型探测/拉取模型/逐把密钥测试）、模型管理（上游模型/公开模型两 Tab；公开模型「编辑」进整页 `/models/public/:id` 单事务保存 + 成员 chip）、价目管理（成本+倍率可编辑、公开模型加权平均价只读）、模型试验、连接密钥、用户（树/代理）、角色管理（权限矩阵）、网关策略（流量策略/护栏/MCP 三 Tab）、审计、配置版本、用户设置、运营设置（连接地址/系统参数/运行信息） | `tsc --noEmit` exit 0；`eslint` 0 error；`vite build` 成功 |
| 导航 IA | `web/src/components/layout/nav-items.ts`（清单唯一来源 `web/src/routes.ts` → `ops/checks/routes.json`） | 侧栏四组、**15 个一级导航项**（运营设置 3 个二级分区在页内子导航，不重复挂侧栏）：常规（快速上手/数据看板/使用日志）、配置（上游管理/模型管理/价目管理）、工具（模型试验）、系统（连接密钥/用户管理/角色管理/网关策略/审计/配置版本/用户设置/运营设置） | route-audit（27 路由 / 19 页面 / 15 导航）+ 浏览器验收 |
| 前端包体 | `web/scripts/check-bundle.mjs` | 路由级 code-split；首包 gzip **213.1 KB**，共 **75 个 JS chunk**，echarts 惰性 chunk 148.2 KB | `check:bundle` PASS（maxFirstLoad 220 / minChunks 20 / maxChunk 400） |
| 验收自动化 | `ops/checks/` | `acceptance_browser.mjs`（Playwright 端到端，五期矩阵见 §7）、`interaction_audit.mjs`（全站逐控件交互审计）、`terminology_audit.mjs`（web 文案术语门禁，不扫 docs）、`route-audit.mjs`、`smoke_api.py`；`docs/ACCEPTANCE.md` 为人工核对清单 | 五期 `--strict` 全绿（证据见 §7） |
| 实验结论 | `docs/experiments/P0-RESULTS.md` | E1~E20：重试、热加载、健康、internal/404、failover 打平、sqlite 日志表、P2C 同层选路、transformations 头体改写、预算语义、keyHash、额度桶、retry 支持面、OTel 逐次尝试、多密钥展开/conditional 首条独占（E14–E20 详见 P0-RESULTS 与 CHANGELOG-phase4） | 隔离实例实测，全程未碰生产 AG |
| 文档 | `docs/` | PLAN、CHANGELOG-phase2、CHANGELOG-phase4、GLOSSARY、FEATURE-PARITY、api-contract、DELIVERY、DECISIONS（ADR-001…028）、contracts/*、ACCEPTANCE、DESIGN-AUDIT、plans/w5-correctness-rework | — |

## 2. 怎么跑（Windows 单机）

```powershell
# 1) 演示数据（幂等；已有数据时加 --keep 会主动拒绝覆盖）
cd C:\Users\microsoft\workspace\webdev\slipstream\api
$env:PYTHONPATH="src"; python scripts/seed_demo.py
# 旧库 priority 语义迁移：默认 dry-run，--apply 写入并记录 priority_semantics=v2；已迁移则 no-op
python scripts/migrate_priority_v2.py --database-url sqlite:///./.data_store/slipstream.db
# 旧库多密钥迁移：把退役的 upstreams.api_key_enc 镜像转成首把密钥行并清空镜像，写 multikey_semantics=v2
#（新库无需执行：init_db 建库即带 upstream_keys，seed/CRUD 只写密钥行；旧库执行一次后 no-op）
# 读取路径只认 upstream_keys：未迁移的旧库 has_api_key=false / key_count=0 / keys 空列表，前端提示运行本脚本。
python scripts/migrate_multikey_v2.py --database-url sqlite:///./.data_store/slipstream.db

# 2) 控制面（管理台后端）
$env:PYTHONPATH="src"; python -m uvicorn l06_api.app:create_app --factory --host 127.0.0.1 --port 3700

# 3) 管理台（单端口：构建产物由控制面 3700 同源托管）
cd C:\Users\microsoft\workspace\webdev\slipstream\web
npm run build          # 产物 web/dist；控制面启动时自动挂载（先构建再启动）
# 打开 http://localhost:3700
```

- **演示数据规模**：3 厂商 / 4 上游（zai-01 一个上游 **3 把等权密钥**，nebula-01、local-01/02 各 1 把，共 **6 条上游密钥**）/ 16 上游模型（其中 **15 个带成本 + 1.2 倍率**，1 个故意未定价）/ 8 公开模型（6 failover + 2 weighted）/ 16 目标 / **6 用户**（根用户 D + 两层代理树）/ 5 把 `sk-` 连接密钥 / 252 条用量 / 245 条计费流水 / 2 条配置版本 / 64 条审计 / 13 条 app_settings / 2 条可用性规则（ban + cooldown，无排期窗口）；策略、护栏、MCP 各有一份样例配置。全程不使用 qax/qianxin 厂商名。
- **登录**：真实会话（ticket 02）。默认演示账号 `admin / admin12345`（管理用户），另有 `lisi`（代理用户）、`wangwu`（普通用户），首次登录后请修改。除登录/健康检查外的 `/admin/*` 全部要求会话。
- **端口**：管理台与控制面同为 **3700**（单端口：`web/dist` 由控制面同源托管，不再单独起前端端口）；仅本地 HMR 可选 `cd web && npm run dev`（5173，vite 代理 `/admin`、`/api` 到 3700）；数据面 **3600**；旧的 agentgateway（3691 / 19004-19006）**未做任何改动**。
- **主机名**：管理台与 API 必须同主机名（都用 `localhost`）；混用 `localhost` 与 `127.0.0.1` 会因 SameSite=Lax 不带 cookie。

## 3. 验收证据（二期当时；五期基线见 §7）

- 后端：`cd api && PYTHONPATH=src python -m pytest tests -q` → **315 passed**（二期当时；五期为 836 passed）（含单端口 SPA 托管 4 个新用例）；`ruff check src tests` → All checks passed；`python ops/checks/smoke_api.py` → **40/40 PASS**（overview 与 margin 同窗口口径、has_api_key、登录/退出/限流/未认证 401、设置往返、审计筛选、账单/看板/模型管理等）。
- 前端门禁：`npx tsc --noEmit` exit 0；`npx eslint src --max-warnings 0` exit 0；`npm run build` exit 0；`npm run check:bundle` PASS（二期当时首包 gzip **193.8 KB**、**66** 个 JS chunk；五期为 213.1 KB / 75 chunk）。
- 路由审计：`node ops/checks/route-audit.mjs` exit 0（二期当时 29 条路由；五期为 27 条路由 / 19 页面模块 / 15 导航项，含旧入口重定向与动态路由的显式放行）。
- UI 基础层：`node web/scripts/check-ui-foundation.mjs` → **37/37**（指标卡图标/间距/页面接线/术语「词元」「花费」）。
- 组件原语化：`4826e50` 把 17 个文件里的原生 `button/select/checkbox/textarea/input/table` 与手写 tabs/分页/主题卡统一到 `components/ui`（Radix Tabs、Pagination、ToggleGroup、Table、Card 等）；tsc/eslint/build 全绿，check-ui-foundation 37/37；规范与逐项清单见 `docs/DESIGN-AUDIT.md`「组件原语化整改」。
- 全站交互审计：`node ops/checks/interaction_audit.mjs --channel msedge --max-controls 400` → **37 条审计路径**（含登录页），发现控件 **2470**、已操作 **1828**、禁用 **457**、重渲染后未操作 **69**、因跳转/上限未操作 **116**（playground 单页超 400 上限）、弹层 **160**、软问题 **15**、**硬失败 0**；证据 `ops/checks/.logs/interaction/20261118-183422/report.md`。15 条软问题均为审计自身操作引起：3 条 toast 来自上游管理「删除」前的连通性测试（演示上游端口未启动，页面已提示），11 条 toast/422 + 1 条页级 422 汇总来自上游详情规则编辑器主动提交不完整表单（页面已提示）；上一轮的护栏草稿删除与 Switch 可读名称误报已不再出现。本轮发现并修掉 3 个真实缺陷：价目管理成本输入框每敲一个字符丢焦点（DataTable 把行内函数型 cell 当组件类型渲染 → React 卸载重建单元格）、/bills 等表格页切时间范围/筛选时主线程卡死（data 引用不稳定触发 TanStack Table 行模型同步死循环）、`POST /admin/config/apply` 502（`ag_config_dir` 相对路径被 agentgateway 二次解析）；另修 playground 用量 `page_size` 常量、MCP/策略/运营设置数字输入 NaN、护栏 Switch 可读名称与上一轮 5 个缺陷（健康 Tab 兜底、设置页可读名称、用户停用二次确认、Toaster 位置、page_size=25）。
- 设计巡检：`docs/DESIGN-AUDIT.md`（静态检索设计 tells + 逐页截图目视核对，无失败退出码）。
- 单端口部署（本提交）：`web/dist` 由控制面 3700 同源托管（`api/src/l06_api/spa.py`），管理台不再单独占端口；`npm run build` 后 `/`、`/login`、`/models` 深链均 200 HTML，`/assets/*.js` 200，`/admin/health` 200，未知 `/admin/*` 保持 JSON，`/openapi.json`、`/docs` 200；浏览器验收 `--strict` PASS 25/FAIL 0（证据 `ops/checks/.logs/acceptance/20261118-202505/report.md`）。
- 浏览器端到端：`node ops/checks/acceptance_browser.mjs --channel msedge --strict` → **PASS 25 / FAIL 0 / PENDING 0 / SKIP 0**；证据在 `ops/checks/.logs/acceptance/20261118-192227/report.md`，覆盖登录品牌与错误密码、控制面健康、管理员主导航逐页无 console error、策略/护栏/MCP 编辑入口、上游详情五 Tab、模型试验 20 参数与会话操作、设置 IA、普通用户看不到成本且直连 `/cost` 被重定向/拦截、后端无 `billing:cost` 返回 403、代理用户可管用户但无成本、命令面板（Ctrl+K）、主题三态（ToggleGroup radio）、看板三 Tab 与热力图区间、价目编辑与还原。
- 截图：浏览器验收时逐页截图保存在 `ops/checks/.logs/acceptance/<时间戳>/`（不入库）；历史批次汇总截图已清理（不入库，可用验收脚本重新生成）。
- seed / 迁移：连续两次 `seed_demo.py` 计数一致；`migrate_priority_v2.py` 的 dry-run、apply、二次 no-op 由 `tests/integration/test_priority_migration_demo.py` 覆盖（seed 产生的 v2 数据先还原为 legacy 形状再验证翻转）。ticket 20 的验收脚本、ticket 19 的 seed/迁移、ticket 21 的本文档互相引用同一组数字。多密钥迁移的旧库路径由 `tests/integration/test_multikey_migration.py` 覆盖，新库路径（建库即带 `upstream_keys`、seed/CRUD 只写密钥行、跑脚本只补 `multikey_semantics=v2` 标记）由 `tests/integration/test_seed_demo_multikey.py` 覆盖；本机 8 上游旧库已实测迁移（镜像转首把密钥行 + 清空镜像 + 打标记）。

## 4. 已知限制（如实记录）

1. **请求级重试默认关闭、可按策略开启（ADR-024/M3 取代早期「AG 1.7 零重试」结论）**：网关策略页可开「请求内重试」+「健康标记与驱逐」，`retry.codes` 含 4xx 时必须成对配置 `health.unhealthyExpression` 与 `eviction.consecutiveFailures≥1`（保存前校验 + 渲染层兜底），关闭即回默认透传。边界：流式首字节后中断不切换目标；`request_logs` 仍 1 请求 1 行（尝试链另存 `request_attempts`）。
2. **同层路由**由 AG 的 P2C 决定（健康 + 延迟 EWMA），控制面只配 failover 的 priority 分层与 weighted 权重；不支持“轮询/最小连接”的假实现（ADR-012/014）。
3. **MCP 支持 sse/stdio**：顶层 `mcp.targets` 已实测通过 pinned AG 1.7 `--validate-only`；http 变体与 `url` 字段被二进制拒绝，后端 422、前端置灰。
4. **`/admin/reports/trend` 是遗留日桶端点**（`metric + range` 7d/30d/90d，未知值回退 30d）；v2 看板与报表走 `/admin/reports/timeseries` 等端点，支持任意区间（today/24h/7d/30d/365d）与 `from_ms/to_ms` 自定义窗口、`bucket=auto` 小时/日桶；桑基 flow 与 overview 金额已跟随时间窗。
5. **前端包体**：已做路由级 code-split，五期基线首包 gzip **213.1 KB**、**75** 个 JS chunk；最大 chunk 为 echarts（gzip 148.2 KB），后续可继续按页面细化拆包（playground/params-panel.tsx 常量外移）。二期当时的 193.8 KB/66 chunk 已过时。
6. **上游密钥不回显**：`GET /admin/upstreams/{id}/keys` 只回 masked/key_suffix，明文只在创建/轮换时返回一次；上游列表用 `has_api_key` 与 `key_count`（只统计 `upstream_keys` 行，不读退役的 `api_key_enc`；旧库未迁移时为 0，前端提示运行 `migrate_multikey_v2`）。连接密钥（旧称客户端密钥，后端 `/admin/api-keys`）才有 `sk-…abcd` 掩码 + 审计化 reveal。
7. **控制台会话是绝对过期（12h，无滑动续期）**；生产必须设 `SLIPSTREAM_COOKIE_SECURE=1` 并置于 TLS 之后，开发环境默认允许 http。
8. **字段级权限是“缺键”不是 null**：无 `billing:cost` 时成本/毛利键消失，无 `billing:spend` 时花费/余额键消失；前端必须按键存在性判断，不能把 null 当无权限。
9. **策略/护栏/MCP 保存不等于下发**：保存只写 `app_settings`，还要点一次 `POST /admin/config/apply` 才会产生新配置版本。
10. **可用性并入模型管理**：没有独立“可用性”页；**措施只属上游模型**（ADR-025），公开模型只有启用/关闭。上游模型行内一个「冷却」按钮，弹窗内切单次/周期两种模式，冷却中显示「解除」；周期规则在抽屉内紧凑编辑，不做完整排期日历；后端 daily/weekly/monthly 周期冷却与 `/admin/availability-rules` 的 POST/GET/PATCH/DELETE 完整保留，seed 为 2 条可用性规则（关闭 + 一次性冷却，无排期窗口）。**单次与周期互斥**（409，ADR-027）：解除只删一次性托管规则，命中周期窗口只跳过当前窗口、周期规则保留；公开模型冷却写操作返回 422。
11. **二期裁定不做**：组合（combo）编排、审计员角色、单条日志导出、TTFA 指标、表格过度分列；公开模型价只读展示，不给成员单独改价。

## 5. 范围外 / 后续

1. **接真实数据面**：把 `agentgateway` 渲染产物下发到 3600 实例（`l03_adapters/agentgateway/apply.py` 原子替换 + 回滚），保持 3691 生产实例不动。
2. **旧库迁移**：旧库 16 表按新模型（vendors/upstreams/upstream_keys/upstream_models/public_models/model_targets/api_keys/users）用脚本录入；priority 语义用 `migrate_priority_v2.py` 一次性翻转。
3. **趋势窗口化**：补 24h/小时桶与看板时间窗联动。
4. **（可选）** 把控制面迁到 `\\wsl.localhost\Ubuntu-26.04\home\microsoft\slipstream` 运行，Windows 侧只留数据面。

## 6. 三期交付段（2026-11-19，重构收口）

三期 = 病根修复（W1）+ 全站页面重构（W2–W5）+ 清理与浏览器验收（W6），已合入本地 `main`（未 push）。路由收口为 **26 条 = 16 功能页 + 登录 + 404 + 8 旧入口重定向页**；侧栏 4 组、**15 个一级入口 + 运营设置 3 个二级分区 = 18 个导航项**（清单唯一来源 `web/src/routes.ts` → `ops/checks/routes.json`；**五期已收口为 27 条 = 17 功能页 + 登录 + 404 + 8 重定向，侧栏 15 个一级入口，见 §7**）。逐批变更见 `docs/CHANGELOG-phase2.md` 后续提交与 `docs/FRONTEND-PLAN.md` 各工位「已完成」标注。

### 6.1 功能摘要

| 批次 | 内容 |
|---|---|
| W1 病根修复 | 用量补延迟三字段 + 连接密钥 last_used_at 批量前推；报表六接口 SQL 化（分位/时区/fx）；timeseries 多指标；overview 增 error_count/active_minutes/缓存两列；延迟四分位；日志排序 + 词元 + user 双匹配 + status:4xx；api-contract 全面重对齐 |
| W2 看板 + 日志 | 看板六卡新口径（请求/词元/费用/成本毛利/延迟/RPM·TPM）、区间 7 预设 + 自定义、热力图行虚拟化（30d+ 行内滚动）；日志筛选/排序/列显隐/详情抽屉（正文需开关） |
| W3 上游 + 模型 + 价目 | 上游渠道列表 + 整页编辑器（连接与模型/路由与模型/请求与响应/其他设置四 Tab；三期时第二 Tab 名为「路由与映射」）；模型管理双 Tab 行内可用性 + 批量操作 + 列显隐；价目管理成本/倍率可编辑 + JSON 导出/导入（ADR-020） |
| W4 密钥 + 用户 + 角色 | 连接密钥（掩码常驻 + 审计化 reveal + 一次性明文弹窗 + 签发入口）；用户管理 API 用户/控制台账号两 Tab（ADR-019）；角色管理权限矩阵（41 权限键） |
| W5 策略 + 审计 + 配置 + 设置 | 网关策略三 Tab 合并页（流量策略/护栏/MCP，validate→保存→apply→版本留档）；审计；配置版本；用户设置/运营设置；登录/404 |
| W6 清理 + 验收 | 后端：conftest 临时目录进程隔离、契约补录（缓存词元/上游改名可选/可用性窗口跳读）；前端：ENDPOINTS 归并、死代码删除、mock 补桩、术语 error 档；浏览器：26 路由/32 URL 逐页四查 + 七流程端到端（三期口径；五期为 27 路由/33 URL，见 §7） |
| W7 迁移终版（M1–M4） | 渲染层迁移落地 ADR-024 混合形态（gateways + llm.gateways + 顶层 policies[] 的 internal/llm:request 重试）；网关策略页「请求内重试 + 健康驱逐」配置面（M3）；日志检索与摄取管线 SQL 化（P2-7/8）；终版全量回归与文档收敛 |

### 6.2 门禁结果（2026-11-19 三期当时，五期基线见 §7）

- 后端：`python -m pytest` **658 passed / 8 skipped / EXIT=0**（含 test_availability 时钟冻结修复、M2/M3 渲染迁移与策略配置面用例）；`python -m ruff check src tests` **All checks passed**；import-lint（`tests/integration/test_import_layers.py` 全量 AST 分层扫描 + `test_layering_guards.py`）随 pytest 通过。
- 前端六门禁：`tsc --noEmit` 0；`eslint src` 0；`vite build` 成功；`check:bundle` PASS（首包 gzip **202.7 KB**、**70** 个 JS chunk）；`check-ui-foundation` **37/37**；`terminology_audit --strict` **error 0 · warn 0**（旧词 封禁/对外模型/客户端密钥 已清零）；`ops/checks/verify_web.sh` **RESULT PASS（tsc/eslint/route 3/3）**。
- 浏览器验收（M4 终版复跑，3700 同源托管）：`node ops/checks/w6_acceptance.mjs`（Playwright + msedge headless）→ **PASS 39 / FAIL 0**：26 条路由展开 32 URL 逐页四查（首屏/空态/错误态/交互）+ flow1 建上游→模型→公开模型→下发、flow2 建用户→签发密钥→复制 toast、flow3 日志筛选/排序/列显隐/详情、flow4 看板连点、flow5 价目导出导入回环、flow6 危险三档 + 周期冷却窗口启用、flow7 强制 500 降级；证据 `ops/checks/.logs/acceptance/m4-20261119-193758/report.md`（不入库）。
- 流程七（ADR-024/M3 配置面，M4 固化）：`node ops/checks/acceptance/m4_retry_flow.mjs` → **PASS 11 / FAIL 0**：网关策略页开「请求内重试」→ 4xx 码未配对健康驱逐时保存禁用并提示 → 配对（consecutive_failures=1）后保存下发 → 渲染配置出现 `internal/llm:request` + `gateway-retry` + `unhealthyExpression` → 真实 AG 加载后 mock 主目标 500 重试两次切备 200（命中矩阵 primary 2 / backup 1）→ 策略页关闭 → 渲染回默认透传 → 同一请求直接 500（primary +1 / backup +0）。证据 `ops/checks/.logs/acceptance/m4-retry-20261119-193758/report.md`（不入库）。
- 验收中发现并修复的真 bug：①Dialog 内 Select/Dropdown 被遮罩拦截点击（`--z-popover` 40→60，弹层浮在 modal 之上）；②启用/解除冷却前端先删周期规则导致窗口跳过失效（删除 clearPeriodicCooldowns，语义归后端）；③连接密钥签发 body 缺 `user_id` 必填字段；④test_availability 五个窗口用例在 UTC 02:00-04:00 运行时机钟依赖偶发失败（冻结服务时钟于用例窗口内）。

### 6.3 部署注意（生产必读）

- **必须覆盖 `SLIPSTREAM_ADMIN_USERNAME` / `SLIPSTREAM_ADMIN_PASSWORD`**（ADR-019 引导）：默认 `admin / admin` 仅本地演示；生产首次启动前必须设置，否则控制台入口是公开弱口令。配置可写在系统环境变量或仓库根/启动目录的 `.env`（`.env` 已随 hotfix 提交），优先级为系统环境变量 > `.env` > 默认值。`seed_demo` 的演示账号密码另由 `SLIPSTREAM_DEMO_ADMIN_PASSWORD` 控制（默认 `admin12345`）。
- 控制台会话绝对过期 12h（无滑动续期）；生产置 `SLIPSTREAM_COOKIE_SECURE=1` 并置于 TLS 之后，管理台与 API 必须同主机名。
- 单端口：先 `cd web && npm run build` 再启动控制面 3700（spa.py 同源托管 `web/dist`，深链回退 index.html）。
- **后台任务随 app 启动**（`l07_jobs`，进程内 `JobRunner`）：增量用量拉取 / 冷却到期重渲染 / 账本对账三项共享默认间隔 `SLIPSTREAM_JOBS_INTERVAL_SECONDS=60`；请求日志留存清理（ADR-021）每日执行一次，按 `log_retention_days` 删除数据面 `request_logs`/`request_log_payloads` 旧行（控制面账本与控制面数据一律不删）。每日状态检查（W6 票08）每日执行一次：比对活跃配置 revision hash 与数据面运行 hash（拿不到运行 hash 报「未知」不误报）、后端版本与前端构建 `app-version` meta（vite 构建注入）；不一致经 `GET /admin/system-status` 推给通知中心，同一问题 24 小时内去重（去重状态与提醒持久化在 app_settings，重启不失效），恢复后再次提醒。**启动命令用组合根入口**：`cd api && uvicorn server:create_app --factory --port 3700`（ADR-010 禁止 l06 import l07，接线在 `api/src/server.py` 组合层完成；`l06_api.app:create_app --factory` 仍可用但不带任务）。置 `SLIPSTREAM_JOBS_ENABLED=0` 可整体停用（例如任务改由独立 worker 跑：在 worker 入口里调用 `l07_jobs.wiring.build_runner(session_factory).run_forever()`）。多副本部署时只应有一个进程开启任务，否则同一游标被重复拉取（幂等，但浪费）。

### 6.4 三期已知边界

1. **请求内重试默认关闭，可按策略开启**（ADR-024/M3 取代早期「AG 1.7 零重试」结论）：网关策略页可开「请求内重试」+「健康标记与驱逐」；`retry.codes` 含 4xx 时必须成对配置 `health.unhealthyExpression` 与 `eviction.consecutiveFailures>=1`（保存前校验 + 渲染层兜底），关闭即回到默认透传。边界：**流式响应首字节后中断不切换目标**；**request_logs 仍 1 请求 1 行**（无尝试级日志，重试不产生额外行）；同一层内仍是 P2C 概率选路。
2. **image 类型上游模型不记词元**：无法计费，模型管理行内提示「AG 不记词元」。
3. **请求/响应正文日志默认不落库**：日志库引导已缺省化——未配置时渲染层仍产出 `config.logging.database.url`（AG 库默认文件名 `ag-data.db`）且 `llm=metadata`，新库开箱即有用量/请求日志数据源；运营设置开 `ag_access_log_llm=full` 才记录正文（metadata 默认，仅元数据），正文随留存周期清理。
4. **日志接口类型 join 为前端实现，upstream-models 列表 200 条分页上限**：模型列表接口本身分页上限 200 条；请求日志的名称回填由前端按页内 id 自行 join。
5. **热力图 30 天以上档位行内滚动**：行虚拟化（30d+ 行内滚），非整页展开。
6. **审计时间筛选未做**：审计其余筛选（动作/操作者/对象）可用，时间范围筛选待后续。

**ADR-024 混合形态（终版落地）**：渲染层迁移最初按 AG 1.7「完整形态」（`gateways` + AI 组）设计，但 1.7 的路由只能匹配 path/method/query/header/host，**读不到请求体里的 model**，一个 route 只对应一个 AI 后端，AI 组也没有 weight——若全部公开模型走同一路径/body，无法区分模型，会塌缩到同一后端并丢失各模型的 failover 链与健康策略，因此简化的「纯完整形态」被推翻。终版采用混合形态：模型路由与 failover/weighted/conditional 仍由 `llm.models`/`llm.virtualModels` 表达；网关面迁到 `gateways` + `llm.gateways`；请求内 retry 以顶层 `policies[]` 挂到内部路由 `internal/llm:request`。强制项：每个上游必须带自己的 `apiKey.file`（否则 AG 会把客户端 Authorization 透传到上游）、baseUrl 必须是绝对 http(s)、https 上游渲染 `models[].tls.hostname`。金样 `api/tests/contract/fixtures/ag_1_7_full_config.yaml` 由真实 1.7 二进制 `--validate-only` 校验。

## 四期交付注记（2026-11-20，详见 docs/CHANGELOG-phase4.md）

1. **多密钥平权（ADR-026）**：每把上游密钥 = 一个独立 AG 上游（`{model}#k{seq}`，E18 形态）；failover/weighted 下密钥级平权分流（P2C 概率性，非均匀），**conditional 模式密钥平权不生效（E20）**——每目标仅用第一把密钥且成员编排有提示；按上游密钥分账不可得（request_logs 只记最终上游）。
2. **主密钥概念废除**：is_primary/镜像/轮换端点全部退役；空上游非法（创建 422 + 删最后一把 409）。多密钥迁移触发路径：**旧库**跑 `api/scripts/migrate_multikey_v2.py`（dry-run 默认；`--apply` 把镜像转成首把密钥行、清空镜像、写 `multikey_semantics=v2`，之后 no-op）；**新库**无需执行（`init_db` 建库即带 `upstream_keys`，seed/CRUD 只写密钥行，跑脚本仅补标记）。
3. **表格与分页规范（DESIGN-AUDIT 四期）**：大表表体内部滚动+撑满页底+最小高度、操作列冻结右侧、头身对齐一致、凡表必有列设置；分页 nav 必须 `position:relative`（sr-only 逃逸 ICB 会顶高 html scrollHeight 酿成全站窗口滚动空白，见 §4 红线）。
4. **语义色=分位数锚定**：日志首字/耗时按当前窗口 `all` 块分位动态着色（≤P50 绿/≤P95 黄/>P95 红），非固定阈值；旧后端无 all 块时降级中性灰。
5. **模型参数来源**：models.dev 每日自动+手动兑入（只填空、手改永不覆盖、USD 进价按 fx_snapshots 折 CNY、无汇率 skip）；代理用户经 `GET /admin/my/models` 查参数（零金额键）。
6. **路由链（适配器遥测，ADR-028）**：E19 证实 AG 1.7 逐次尝试上游身份只能经 OTel Traces 获得；该采集收进 AG 适配器私有实现（loopback OTLP 接收器 + AttemptSink），系统只存归一化 `request_attempts`，不再有系统级接收器/trace_spans/tracing 策略配置。accessLog upstreamCalls 在 1.7.0 静默失效。
7. **conditional × 多密钥为受限组合**（E20/D2）：渲染不展开密钥、兜底至多 1 条且必须末位（AG 硬校验）、成员编排有提示。
8. 看板 8 卡（缓存/RPM/TPM 自六卡拆出，**只拆不加**）、峰值=窗口内单分钟最大值；热力图 30D 按周/365D 按月（13 行，跨年加年份前缀）。

9. **路由链已实现（ADR-028 重构，2026-11-20）**：AG 适配器在 `l03_adapters/agentgateway/telemetry.py` 内私有实现 OTLP/HTTP 采集（loopback，默认 127.0.0.1:4318，绑定失败降级）→ 解码后归一化为 `RequestAttempt` → 系统表 `request_attempts`（幂等）→ `GET /admin/logs/{event_id}/attempts` → 日志详情「路由链」时间线（每轮上游/状态码语义色/耗时/错误）。边界：AG 1.7 只 push OTLP（系统仍会多一个适配器内部 loopback 端口）；历史 trace_spans 不迁移；事件在采集端宕机期间丢失。

## 7. 五期（W5）交付段（2026-11-21 收口）

五期 ticket 01–16 已合入本地 `w5/integration`（未 push），本票（ticket 17）做文档/契约/术语/ADR 收口；ticket 18 负责全站浏览器验收。ADR 范围扩到 **ADR-001…028**（新增 ADR-027「冷却互斥与解除语义」；ADR-028「追踪归适配层」已取代 M5 系统级 OTLP/span 方案）。

### 7.1 能力摘要（按票）

- **01 看板分流**：分流桑基图支持图例隐藏阶段，隐藏由后端 `collapse` 按完整五段路径投影重算（守恒、至少 2 段），前端删除旧 splice。
- **02 可用性**：上游模型行内单按钮「冷却」双模式（单次/周期）；单次与周期互斥 409（ADR-027）；解除只删一次性规则、周期窗口只跳过当前窗口；公开模型无冷却（写操作 422）；写后立即下发。
- **03/04 日志**：模型列两行（公开模型 / 请求模型 → 上游模型），新增「N 次尝试」popover 与尝试链（ADR-028）；费用两行（计费/成本）；日志行新增 `requested_model / attempts_count / has_attempts / last_failure_status / last_failure_error_type / last_failure_error_message`（服务层只回事实字段，错误摘要由前端唯一拼装）。
- **05 模型探测**：上游模型逐模型主动探测（串行、单模型 20s、不落库）；与「模型拉取」`discover-models` 术语分工。
- **06 表格**：操作列 `sticky right-0` 冻结、头身对齐一致、行节奏统一（`lib/table-columns.ts` 单一来源）。
- **08 数字口径**：计数/词元/TPM/尝试次数千分位整数、RPM 两位、百分比一位、金额两位（`lib/format.ts` 单一来源）。
- **09 语义色/脏标记/toast**：语义色五档 token + `ACTION_TONES`；`dirty-fields` 原语与字段级脏标记；toast 统一 3s/右上 80px/最多 3 条。
- **10 看板八卡**：请求量/词元/缓存/费用/成本·毛利率/P50 延迟/RPM/TPM，八卡八形 + 图标单一来源。
- **11 上游模型抽屉**：100vh 右侧抽屉、内部滚动、固定底栏、脏标记，760–860px 自适应。
- **12 公开模型单事务**：公开模型保存改单 `PATCH`（基本字段 + routing_mode + enabled + targets 一次提交），旧 `PUT .../targets` 删除、无别名；双权限（`public_models:write` + 条件 `model_targets:write`）。
- **13 公开模型单页**：列表「编辑」进入 `/models/public/:id` 单页三段（页头 + 基本信息 + 成员编排 + 底部唯一保存），失败回滚并保留输入。
- **14 成员 chip**：成员编排改分层 chip（按 priority 分层、conditional 末位兜底、候选按上游分组搜索、成员脏标记）。
- **16 多密钥收口**：`is_primary` 死列幂等 DROP；apply 成功后按本次 `key_files` 白名单清理受管 `keys/*.key`（失败仅告警）；conditional×多密钥只展开首把（E20 既定裁决）。

### 7.2 破坏性变更（无兼容别名）

1. **删除 `PUT /admin/public-models/{id}/targets`**：targets 随公开模型单页 `PATCH` 一次提交（ticket 12）。契约生成物 `web/src/generated/contract.ts` 同步删除，无残留。
2. **删除 `GET /admin/traces/{trace_id}`** 与系统级 tracing 配置面/OTel 接收器/`trace_spans` 表：路由链改 `GET /admin/logs/{event_id}/attempts` + `request_attempts`（ADR-028）。
3. **删除 `upstream_keys.is_primary` 列**与「主密钥/轮换」端点：旧库启动时幂等 `ALTER TABLE ... DROP COLUMN`（ADR-026 补记）。
4. **旧入口删除而非重定向**：`/bills` 随账单页移除（ADR-023，三期已做，此处列全）；`/cost`、`/revenue`、`/unpriced` 不存在。八条旧入口重定向保留：`/settings`、`/ops-settings`、`/upstream-prices`、`/downstream-prices`、`/admins`、`/policies`、`/guardrails`、`/mcp`。

### 7.3 新端点 / 新字段

- `POST /admin/upstreams/{id}/models/probe`：模型探测（权限 `upstream_models:write`；串行 20s；不落库）。
- `GET /admin/logs/{event_id}/attempts`：请求尝试链（升序 attempt；空记录 200 空列表）。
- `GET /admin/reports/flow?collapse=...`：分流隐藏阶段后端投影（422 未知阶段/不足 2 段）。
- 日志列表行：`requested_model`、`attempts_count`、`has_attempts`、`last_failure_status`、`last_failure_error_type`、`last_failure_error_message`（动态 dict，不进入 `contract.ts`，由 pytest 与文档字段表约束；摘要由前端 `components/logs/error-summary.ts` 拼装）。
- 公开模型 PATCH：响应顶层 `window_skip`；批量启用：`window_skipped[]`。

### 7.4 五期门禁基线（2026-11-21 实测）

- 后端：`pytest` **836 passed / 18 warnings / EXIT=0**；`ruff check src tests` All checks passed；`gen_ts.py --check` PASS（contract.ts 最新）；`smoke_api.py` **40/40 PASS**。
- 前端：`tsc --noEmit` 0；`eslint src` 0；`vite build` 成功；`check:bundle` PASS（首包 gzip **213.1 KB** / **75** chunk / echarts 148.2 KB）；`check-ui-foundation` **75/75**；`check-semantic-dirty` **41/41**；`terminology_audit --strict` **error 0 · warn 0**（范围：web 文案，不含 docs）。
- 路由审计：`route-audit` 路由 **27** / 页面模块 **19** / 导航 **15**；OpenAPI **99 路径 / 133 操作**。
- 浏览器验收：矩阵与证据见 ticket 18（`node ops/checks/acceptance_browser.mjs --channel msedge --strict`，单端口 3700 同源托管；新交互覆盖公开模型单页/chip、日志 attempts、分流隐藏轴、sticky/数字/语义色/脏标记、模型探测、冷却互斥）。

### 7.5 五期已知边界（如实记录）

1. **路由链依赖适配器 loopback OTLP**：AG 1.7 只支持 push OTLP，AG 适配器内部监听 loopback 端口并解码为 `RequestAttempt`；系统绝对零新增端口则只能放弃逐次尝试链。历史日志无链路记录；采集端宕机期间的尝试丢失；`request_attempts` 保留期与日志一致（30 天）。
2. **conditional × 多密钥为受限组合（E20）**：每目标只展开首把密钥、成员编排有提示；密钥级平权/容错只在 failover/weighted 生效。
3. **按上游密钥分账不可得**：用量归因剥去 provider 名 `#序号` 后缀，账本按最终上游计（E18）。
4. **分流隐藏至少保留 2 段**：最多隐藏 3 段，隐藏后不足 2 段返回 422；mock 不重算投影（浏览器冒烟走真实 API）。
5. **`request_logs` 仍 1 请求 1 行**：尝试链单独存 `request_attempts`，两者按 `trace_id` join；不把尝试写进日志行。
6. **公开模型无冷却**：公开模型冷却写操作 422；上游模型冷却互斥生效期间另一形状创建/改期 409，UI 以 toast + 阻塞规则提示。
7. **模型探测不落库**：结果只用于本次响应，不写 `upstream_probes`/密钥测试/审计；`api_style` 仍为 `auto` 时 422；串行探测大批模型耗时线性增长（单模型 20s 上限）。
