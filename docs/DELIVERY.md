# 二期交付说明（2026-11-18）

本仓为 Slipstream：**agentgateway 当数据面黑盒 + 自建控制面/管理台**（B+ 架构，见 docs/PLAN.md 与 docs/DECISIONS.md）。

状态：二期 ticket 01–22 **全部合入** `phase2/integration`（本地提交，未 push），全部门禁与浏览器逐页验收已跑过。逐项变更见 `docs/CHANGELOG-phase2.md`。

## 1. 交付范围

| 层 | 位置 | 内容 | 验证 |
|---|---|---|---|
| 控制面 API | `api/`（l01~l07 分层） | OpenAPI 实测 **89 条路径 / 125 个操作**：上游、上游密钥、上游模型、公开模型、模型目标、连接密钥（后端 `/admin/api-keys`）、用户与层级/代理、管理员、角色与权限矩阵、价目（成本+倍率）、账单（成本/营收/待补价/我的花费）、日志、审计、配置版本、策略/护栏/MCP、用户设置/运营设置、概览、看板（趋势/流向/热力/成员/延迟）、模型试验、真实会话登录 | `pytest` **315 passed**；`python ops/checks/smoke_api.py` **40/40 PASS** |
| 认证与权限 | `api/src/l05_service/auth.py`、`rbac.py`、`l06_api/field_filter.py` | scrypt 密码、DB 会话、httpOnly cookie、5 次/分钟限流；三角色 + 自建角色、**41 个权限键**、字段级金额过滤（缺键非 null）；`X-Admin-Role` 不再信任 | `test_auth_api.py`、`test_rbac.py`、`test_rbac_field_filter.py` |
| 数据面适配 | `api/src/l03_adapters/` | `DataPlaneAdapter` 八方法 SPI + `mock` + `agentgateway` 渲染/下发/回滚/用量拉取；IR 在 `l02_domain/ir.py`；AG 1.7 `--validate-only` 门禁；priority 旧→新语义迁移脚本 | 契约测试 + 渲染快照 + 真实二进制校验 + 迁移集成测试 |
| 管理台 | `web/`（Vite+React+TS+Tailwind） | **23 个页面组件 = 19 个功能页 + 登录 + 404 + 2 个旧入口重定向页**，29 条路由。功能页：全局概览、数据看板（柱形/面积/分流三 Tab + 成员详情 + 热力图 7D/30D/365D）、使用日志、账单（成本/营收/待补价/我的花费）、上游管理 + 上游详情（五 Tab）、模型管理（上游模型/公开模型两 Tab，可用性行内操作）、价目管理（成本+倍率可编辑、公开模型加权平均价只读）、模型试验、连接密钥、用户（树/代理）、管理员（角色/权限矩阵）、策略、护栏、MCP、审计、配置版本、用户设置、运营设置（连接地址/系统参数/运行信息） | `tsc --noEmit` exit 0；`eslint` 0 error；`vite build` 成功 |
| 导航 IA | `web/src/components/layout/nav-items.ts` | 侧栏按**页面类型**四组：常规（全局概览/数据看板/使用日志/账单）、配置（上游管理/模型管理/价目管理）、工具（模型试验）、系统（连接密钥/用户/管理员/策略/护栏/MCP/审计/配置版本/用户设置/运营设置） | route-audit + 浏览器验收 |
| 前端包体 | `web/scripts/check-bundle.mjs` | 路由级 code-split；首包 gzip **193.8 KB**，共 **66 个 JS chunk**，echarts 惰性 chunk 148.2 KB | `check:bundle` PASS（maxFirstLoad 220 / minChunks 20 / maxChunk 400） |
| 验收自动化 | `ops/checks/` | `acceptance_browser.mjs`（Playwright，25 项端到端）、`interaction_audit.mjs`（全站 37 条审计路径逐控件交互审计）、`terminology_audit.mjs`、`route-audit.mjs`、`smoke_api.py`；`docs/ACCEPTANCE.md` 为人工核对清单 | `--strict` 全绿（证据见 §3） |
| 实验结论 | `docs/experiments/P0-RESULTS.md` | E1~E13：重试、热加载、健康、internal/404、failover 打平、sqlite 日志表、P2C 同层选路、transformations 头体改写、预算语义、keyHash、额度桶、retry 不支持 | 隔离实例实测，全程未碰生产 AG |
| 文档 | `docs/` | PLAN、CHANGELOG-phase2、GLOSSARY、FEATURE-PARITY、api-contract、DELIVERY、DECISIONS、contracts/*、ACCEPTANCE | — |

## 2. 怎么跑（Windows 单机）

```powershell
# 1) 演示数据（幂等；已有数据时加 --keep 会主动拒绝覆盖）
cd C:\Users\microsoft\workspace\webdev\slipstream\api
$env:PYTHONPATH="src"; python scripts/seed_demo.py
# 旧库 priority 语义迁移：默认 dry-run，--apply 写入并记录 priority_semantics=v2；已迁移则 no-op
python scripts/migrate_priority_v2.py --database-url sqlite:///./.data_store/slipstream.db

# 2) 控制面（管理台后端）
$env:PYTHONPATH="src"; python -m uvicorn l06_api.app:create_app --factory --host 127.0.0.1 --port 3700

# 3) 管理台（单端口：构建产物由控制面 3700 同源托管）
cd C:\Users\microsoft\workspace\webdev\slipstream\web
npm run build          # 产物 web/dist；控制面启动时自动挂载（先构建再启动）
# 打开 http://localhost:3700
```

- **演示数据规模**：3 厂商 / 6 上游 / 20 上游模型（其中 **19 个带成本 + 1.2 倍率**）/ 8 公开模型（6 failover + 2 weighted）/ 16 目标 / **6 用户**（根用户 D + 两层代理树）/ 5 把 `sk-` 连接密钥 / 252 条用量 / 245 条计费流水 / 2 条配置版本 / 68 条审计 / 12 条 app_settings / 2 条可用性规则（ban + cooldown，无排期窗口）；策略、护栏、MCP 各有一份样例配置。全程不使用 qax/qianxin 厂商名。
- **登录**：真实会话（ticket 02）。默认演示账号 `admin / admin12345`（管理用户），另有 `lisi`（代理用户）、`wangwu`（普通用户），首次登录后请修改。除登录/健康检查外的 `/admin/*` 全部要求会话。
- **端口**：管理台与控制面同为 **3700**（单端口：`web/dist` 由控制面同源托管，不再单独起前端端口）；仅本地 HMR 可选 `cd web && npm run dev`（5173，vite 代理 `/admin`、`/api` 到 3700）；数据面 **3600**；旧的 agentgateway（3691 / 19004-19006）**未做任何改动**。
- **主机名**：管理台与 API 必须同主机名（都用 `localhost`）；混用 `localhost` 与 `127.0.0.1` 会因 SameSite=Lax 不带 cookie。

## 3. 验收证据

- 后端：`cd api && PYTHONPATH=src python -m pytest tests -q` → **315 passed**（含单端口 SPA 托管 4 个新用例）；`ruff check src tests` → All checks passed；`python ops/checks/smoke_api.py` → **40/40 PASS**（overview 与 margin 同窗口口径、has_api_key、登录/退出/限流/未认证 401、设置往返、审计筛选、账单/看板/模型管理等）。
- 前端门禁：`npx tsc --noEmit` exit 0；`npx eslint src --max-warnings 0` exit 0；`npm run build` exit 0；`npm run check:bundle` PASS（首包 gzip **193.8 KB**，**66** 个 JS chunk）。
- 路由审计：`node ops/checks/route-audit.mjs` exit 0（29 条路由，含旧入口重定向与动态路由的显式放行）。
- UI 基础层：`node web/scripts/check-ui-foundation.mjs` → **37/37**（指标卡图标/间距/页面接线/术语「词元」「花费」）。
- 组件原语化：`4826e50` 把 17 个文件里的原生 `button/select/checkbox/textarea/input/table` 与手写 tabs/分页/主题卡统一到 `components/ui`（Radix Tabs、Pagination、ToggleGroup、Table、Card 等）；tsc/eslint/build 全绿，check-ui-foundation 37/37；规范与逐项清单见 `docs/DESIGN-AUDIT.md`「组件原语化整改」。
- 全站交互审计：`node ops/checks/interaction_audit.mjs --channel msedge --max-controls 400` → **37 条审计路径**（含登录页），发现控件 **2470**、已操作 **1828**、禁用 **457**、重渲染后未操作 **69**、因跳转/上限未操作 **116**（playground 单页超 400 上限）、弹层 **160**、软问题 **15**、**硬失败 0**；证据 `ops/checks/.logs/interaction/20261118-183422/report.md`。15 条软问题均为审计自身操作引起：3 条 toast 来自上游管理「删除」前的连通性测试（演示上游端口未启动，页面已提示），11 条 toast/422 + 1 条页级 422 汇总来自上游详情规则编辑器主动提交不完整表单（页面已提示）；上一轮的护栏草稿删除与 Switch 可读名称误报已不再出现。本轮发现并修掉 3 个真实缺陷：价目管理成本输入框每敲一个字符丢焦点（DataTable 把行内函数型 cell 当组件类型渲染 → React 卸载重建单元格）、/bills 等表格页切时间范围/筛选时主线程卡死（data 引用不稳定触发 TanStack Table 行模型同步死循环）、`POST /admin/config/apply` 502（`ag_config_dir` 相对路径被 agentgateway 二次解析）；另修 playground 用量 `page_size` 常量、MCP/策略/运营设置数字输入 NaN、护栏 Switch 可读名称与上一轮 5 个缺陷（健康 Tab 兜底、设置页可读名称、用户停用二次确认、Toaster 位置、page_size=25）。
- 设计巡检：`docs/DESIGN-AUDIT.md`（静态检索设计 tells + 逐页截图目视核对，无失败退出码）。
- 单端口部署（本提交）：`web/dist` 由控制面 3700 同源托管（`api/src/l06_api/spa.py`），管理台不再单独占端口；`npm run build` 后 `/`、`/login`、`/models` 深链均 200 HTML，`/assets/*.js` 200，`/admin/health` 200，未知 `/admin/*` 保持 JSON，`/openapi.json`、`/docs` 200；浏览器验收 `--strict` PASS 25/FAIL 0（证据 `ops/checks/.logs/acceptance/20261118-202505/report.md`）。
- 浏览器端到端：`node ops/checks/acceptance_browser.mjs --channel msedge --strict` → **PASS 25 / FAIL 0 / PENDING 0 / SKIP 0**；证据在 `ops/checks/.logs/acceptance/20261118-192227/report.md`，覆盖登录品牌与错误密码、控制面健康、管理员主导航逐页无 console error、策略/护栏/MCP 编辑入口、上游详情五 Tab、模型试验 20 参数与会话操作、设置 IA、普通用户看不到成本且直连 `/cost` 被重定向/拦截、后端无 `billing:cost` 返回 403、代理用户可管用户但无成本、命令面板（Ctrl+K）、主题三态（ToggleGroup radio）、看板三 Tab 与热力图区间、价目编辑与还原。
- 截图：浏览器验收时逐页截图保存在 `ops/checks/.logs/acceptance/<时间戳>/`（不入库）；历史批次汇总截图已清理（不入库，可用验收脚本重新生成）。
- seed / 迁移：连续两次 `seed_demo.py` 计数一致；`migrate_priority_v2.py` 的 dry-run、apply、二次 no-op 由 `tests/integration/test_priority_migration_demo.py` 覆盖（seed 产生的 v2 数据先还原为 legacy 形状再验证翻转）。ticket 20 的验收脚本、ticket 19 的 seed/迁移、ticket 21 的本文档互相引用同一组数字。

## 4. 已知限制（如实记录）

1. **请求级重试不实现**：AG v1.7.0 的 LLM 配置面不接受 retry 策略（P0-E13 validate 失败）；策略页的 `retry` 必须为 null，非 null 被 422 拒绝，前端不落该开关。
2. **同层路由**由 AG 的 P2C 决定（健康 + 延迟 EWMA），控制面只配 failover 的 priority 分层与 weighted 权重；不支持“轮询/最小连接”的假实现（ADR-012/014）。
3. **MCP 支持 sse/stdio**：顶层 `mcp.targets` 已实测通过 pinned AG 1.7 `--validate-only`；http 变体与 `url` 字段被二进制拒绝，后端 422、前端置灰。
4. **trend 只有 `metric + range`（7d/30d/90d 日桶）**，未实现 `24h`/`bucket=hour`；桑基 flow 与 overview 的金额已跟随时间窗，但 trend 的窗口化仍待后续。
5. **前端包体**：ticket 18 已做路由级 code-split，当前首包 gzip 193.8 KB；最大 chunk 为 echarts（gzip 148.2 KB），后续可继续按页面细化拆包（playground/params-panel.tsx 常量外移）。
6. **上游密钥不回显**：`GET /admin/upstreams/{id}/keys` 只回 masked/key_suffix，明文只在创建/轮换时返回一次；上游列表用 `has_api_key` 与 `key_count`。连接密钥（旧称客户端密钥，后端 `/admin/api-keys`）才有 `sk-…abcd` 掩码 + 审计化 reveal。
7. **控制台会话是绝对过期（12h，无滑动续期）**；生产必须设 `SLIPSTREAM_COOKIE_SECURE=1` 并置于 TLS 之后，开发环境默认允许 http。
8. **字段级权限是“缺键”不是 null**：无 `billing:cost` 时成本/毛利键消失，无 `billing:spend` 时花费/余额键消失；前端必须按键存在性判断，不能把 null 当无权限。
9. **策略/护栏/MCP 保存不等于下发**：保存只写 `app_settings`，还要点一次 `POST /admin/config/apply` 才会产生新配置版本。
10. **可用性并入模型管理**：没有独立“可用性”页；关闭/启用/一次冷却/解除在模型管理行内完成（`PATCH /admin/upstream-models/{id}` 的 `enabled`/`cooldown_until_ms` 与批量 PATCH）。UI 提供紧凑的周期冷却编辑（重复方式+时间窗），不做完整排期日历；后端 daily/weekly/monthly 周期冷却与 `/admin/availability-rules` 的 POST/GET/PATCH/DELETE 完整保留，seed 仍是 2 条 ban/一次性 cooldown 记录。
11. **二期裁定不做**：组合（combo）编排、审计员角色、单条日志导出、TTFA 指标、表格过度分列；对外/公开模型价只读展示，不给成员单独改价。

## 5. 范围外 / 后续

1. **接真实数据面**：把 `agentgateway` 渲染产物下发到 3600 实例（`l03_adapters/agentgateway/apply.py` 原子替换 + 回滚），保持 3691 生产实例不动。
2. **旧库迁移**：旧库 16 表按新模型（vendors/upstreams/upstream_keys/upstream_models/public_models/model_targets/api_keys/users）用脚本录入；priority 语义用 `migrate_priority_v2.py` 一次性翻转。
3. **趋势窗口化**：补 24h/小时桶与看板时间窗联动。
4. **（可选）** 把控制面迁到 `\\wsl.localhost\Ubuntu-26.04\home\microsoft\slipstream` 运行，Windows 侧只留数据面。
