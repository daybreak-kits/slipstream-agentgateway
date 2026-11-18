# 功能对齐清单：旧前端 → 新管理台

- 状态：§1–§4 为旧仓功能盘点（2026-11-17 定稿，用户指出「之前前端的功能不能丢」后整理）；§6 为本轮整改后的逐项实现状态
- 图例：✅ 已实现并核验 · ⚠️ 部分实现或与后端不一致 · ⏸ 延期 · — 本轮未核验
- 旧仓路径：`llmapi/web/src/`；新仓路径：`slipstream/web/src/`

## 1. 旧导航（6 项）与新导航的映射

| 旧页面 | 旧功能要点 | 新落点 | 处置 |
|---|---|---|---|
| 全局概览 `/overview` | 连接地址、接入示例（curl/python）、运行概况 | `/overview` | **保留**，接入示例按新协议重写 |
| 数据看板 `/` | 请求量/token/成本/延迟；trend-card、flow-card、flow-sankey（桑基） | `/dashboard` | **保留**，趋势用 recharts，桑基用 echarts 按需引入 |
| 使用日志 `/logs` | 逐条请求、详情抽屉、查询语法帮助、查询报错提示 | `/logs` | **保留**，含查询语法与详情抽屉 |
| 渠道管理 `/channels` | 列表、批量工具栏、渠道表单、密钥面板、模型映射、发现模型、连接状态、探活/健康徽章、启用开关、改写规则 | `/upstreams` + `/upstreams/:id` | **保留**，改名为「上游」；密钥组支持多密钥（每上游最多 20 把）；健康徽章改为只读数据面状态 |
| 模型管理 `/catalog` | 可调用模型清单、组合编排、批量操作、可用性控制、冷却对话框、周期冷却计划 | `/models`（上游模型/公开模型两 Tab） | **保留**；组合不做，由公开模型成员替代；可用性并入行内（关闭/启用/冷却/解除）；UI 提供紧凑周期冷却编辑（重复方式+时间窗），不做完整排期日历，后端周期冷却保留 |
| 模型试验 `/playground` | 多轮流式调试、参数面板、模型下拉、历史、消息列表 | `/playground` | **保留**；UI 名称统一「模型试验」（不再叫游乐场） |
| 用户密钥 `/keys` | 签发与封禁 | `/client-keys`（UI 名称「连接密钥」；后端 `/admin/api-keys`） | 保留，并加密存储 + 掩码 + 审计化 reveal |
| 价目管理 `/upstream-prices` + `/downstream-prices` | 上下游两套价目 | `/pricing` 单页 | **合并**；成本+倍率可编辑、公开模型加权平均价只读、待补价 |
| 成本 / 营收 / 待补价 | 三个独立页面 | `/bills` 的 Tab（我的花费 + 运营账单） | **合并**；旧入口 `/cost` `/revenue` `/unpriced` 重定向 |
| 用户 `/users` | 层级、父级、状态 | `/users`（列表/树） | 保留并加用户树、代理子树汇总 |
| 系统设置 `/settings` | 管理员账号、日志策略 | `/settings`（用户设置）+ `/ops-settings`（运营设置）+ `/admins` | 保留，改为 RBAC 多管理员；设置拆成用户视角与运营视角 |
| 登录 `/login` | AuthProvider、ProtectedRoute、PublicOnlyRoute | 同 | 保留 |

## 2. 旧布局与全局能力（之前也漏了）

| 能力 | 旧实现 | 新要求 | 状态 |
|---|---|---|---|
| 全局搜索 / 命令面板 | `components/layout/global-search.tsx` + `ui/command.tsx` | 移植：⌘K 唤起，跨上游/模型/密钥跳转 | ✅ `web/src/components/global-search.tsx`，`app-shell` 挂载；⌘K / Ctrl+K，四组结果（上游、上游模型、公开模型、连接密钥），本地子串过滤 |
| 时区切换 | `components/layout/timezone-toggle.tsx` + `lib/time` | 移植：表格与图表按所选时区渲染 | — 本轮未核验（`web/src/lib/time.tsx` 在） |
| 主题菜单 | `components/layout/theme-menu.tsx` | 已有深浅色，补「跟随系统」 | ✅ 三态 `light` / `dark` / `system`（`web/src/lib/theme.ts`） |
| 侧栏分组 | `lib/navigation.tsx`（navGroups） | 已有，分组名沿用「常规/配置/工具/系统」风格 | — 本轮未核验（分组导航在 `app-shell.tsx` 内） |
| UI 组件库 | `components/ui/` 50+（command、combobox、calendar、confirm-dialog、empty、icon-badge、input-group、collapsible、form…） | **整体移植**，不要重新发明；样式 token 换成新色板 | ✅ 已移植约 45 个到 `web/src/components/ui/` |

## 3. 旧业务组件（逐项处置）

| 旧组件 | 新处置 | 状态 |
|---|---|---|
| `channels/rewrite-rules-editor.tsx` | 已迁移为 transforms-editor（v2 动词表） | ✅ 已迁移；W1 文案、W2 保留路径、regex/replacement 拆分三处均在 12:40 跟随（见 §6.2） |
| `channels/discover-models-dialog.tsx` | **保留**：上游详情里「拉取模型列表」，一键生成上游模型 | ✅ 后端 `POST /admin/upstreams/{id}/discover-models` 在；前端未单独成组件，入口本轮未核验 |
| `channels/channel-batch-toolbar.tsx` | **保留**：批量启用/禁用/删除 | ✅ `web/src/pages/upstream_models.tsx` 批量条（`PATCH /admin/upstream-models/batch`） |
| `channels/connection-status-badge.tsx` / `model-health-badge.tsx` / `probe-status-badge.tsx` | 保留为只读状态（数据面健康不落库，见 ADR-004） | — 未以独立徽章组件存在，状态在列表页内只读展示（本轮未逐页核验） |
| `catalog/availability-control.tsx` | 保留：可用性改为模型管理行内操作 | ✅ 上游模型/公开模型行内：关闭/启用/一次性冷却/解除；批量 PATCH 同样动作；无独立 `/availability` 页 |
| `models/cooldown-dialog.tsx` + `cooldown-axes.ts` | 保留：一次性冷却 | ✅ 冷却对话框只选时长与原因，到点自动恢复；另设「周期」按钮编辑重复方式与时间窗，不做完整排期日历；后端周期冷却保留（ADR-004） |
| `models/schedule-editor-dialog.tsx` + `schedule-rules.tsx` | **部分做 UI** | ✅ 模型页「周期」按钮提供重复方式 + 时间窗的紧凑编辑；不做完整排期日历；后端 daily/weekly/monthly 周期冷却与规则 API 完整保留，`recurrence` 是现行能力而非历史兼容 |
| `models/bulk-action-bar.tsx` | 保留 | ✅ 同 `channel-batch-toolbar`（`{ids, action: enable\|disable\|delete}`） |
| `models/add-to-combo-dialog.tsx` / `combos/combo-editor-dialog.tsx` | 组合 v1 不做；`add-to-combo` 改为「加入对外模型」向导（选 public model + priority） | ⏸ 延期：未见组合/加入向导组件 |
| `logs/log-detail-drawer.tsx` / `query-syntax-help.tsx` / `query-error.tsx` | **保留**：日志详情抽屉 + 查询语法 | ✅ `components/logs/log-detail-drawer.tsx`、`components/logs/query-syntax-help.tsx` |
| `dashboard/trend-card.tsx` / `flow-card.tsx` / `flow-sankey.tsx` | 保留，趋势 recharts，桑基 echarts | ✅ `components/dashboard/trend-chart.tsx`、`flow-sankey.tsx`（flow-card 并入 dashboard 页） |
| `playground/*`（chat-composer、chat-params-panel、message-list、model-combobox、history-store） | **整体移植** | ✅ `components/playground/{composer,message-list,params-panel,session-list}.tsx`；模型字段改用 `upstream_*`（`lib/channel-models.ts` 已删） |
| `protected-route.tsx` + `lib/auth` | 保留，接 RBAC 登录 | ✅ `components/auth/protected-route.tsx` |

## 4. 新增（旧系统没有的）

- 上游 / 上游模型 / 公开模型 / 成员绑定（三层数据模型）
- 用户层级与代理子树汇总（ticket 04）
- 看板三 Tab + 成员详情 + 热力图（ticket 12/13）；日志合并列与详情（ticket 14）
- 用户设置/运营设置 IA（ticket 16）；seed 幂等与 priority 迁移（ticket 19）
- 浏览器验收脚本与 50 条 User Story 映射（ticket 20）
- 账单页（成本/营收/待补价/我的花费）+ 价目管理单页（成本+倍率、公开模型加权平均价）+ 待补价
- 配置版本（下发留档、回滚）
- 审计日志
- 策略 / 护栏 / MCP：✅ 三块可编辑并落库（`app_settings`），写路径 dry-run 后渲染到 `llm.policies` 与顶层 `mcp`；接口 `GET/PUT/DELETE /admin/policies|guardrails` 与 `GET/POST/PUT/DELETE /admin/mcp-servers`，保存后走既有 apply 流程；AG 1.7 不支持的字段（retry、webhook scope/path、http MCP）由后端 422 显式拒绝
- 余额与充值

## 5. 验收口径

新管理台必须能回答旧系统能回答的全部问题：这条请求花了多少、打给谁、为什么选它、用户被扣多少；并且新增：这笔钱进了谁的账、我们赚了多少。

## 6. 本轮整改后的实现状态（2026-11-17 核验）

### 6.1 逐项状态

| 功能 | 状态 | 证据 / 说明 |
|---|---|---|
| ⌘K 全局搜索 | ✅ | `web/src/components/global-search.tsx`，`app-shell` 挂载；⌘K / Ctrl+K 开关，四组结果（上游、上游模型、对外模型、客户端密钥），本地子串过滤，↑↓ 选择、回车跳转 |
| 主题三态（跟随系统） | ✅ | `web/src/lib/theme.ts`：`Theme = "light" \| "dark" \| "system"`，`system` 用 `prefers-color-scheme` 解析并监听变化；其余两态是显式选择，不再跟随系统 |
| 冷却 / 周期规则 | ✅ | `/admin/availability-rules` 提供 GET/POST/PATCH/DELETE，`recurrence` 支持 once/daily/weekly/monthly 与 `schedule_json.windows`；UI 只暴露一次性冷却，周期规则由 API/规则层管理（ADR-004） |
| 批量启用 / 停用 / 删除 | ✅ | 上游模型页批量条；`PATCH /admin/{upstream-models,public-models,model-targets}/batch`，body `{ids, action: "enable"\|"disable"\|"delete"}`，响应 `{changed, missing, action}` |
| IR 三块（policies / guardrails / mcp） | ✅ | `api/src/l02_domain/ir.py` 定义（frozen+slots，默认空结构），`l05_service/policies.py:build_policy_blocks(adapter)` 填充；渲染守卫 `test_render_never_emits_unsupported_blocks` |
| MCP | ✅ sse/stdio | 顶层 `mcp.targets` 可增删改；sse 用 host，stdio 用 cmd/args/env；http 被 pinned AG 1.7 拒绝（`mcp.transport.http=false`，保存 422） |
| 404 页 | ✅ | `web/src/pages/not-found.tsx`，由 `app.tsx` 的 `path="*"` 路由兜底 |
| 占位页 | ✅ 已移除 | `web/src/pages/placeholders.tsx` 已删除，不再有「敬请期待」假页面 |
| mock 开关 | ✅ | `web/src/lib/mock.ts:12`：只有 `VITE_MOCK=1`（或 `true`）才启用 mock，默认全部走真实 `/admin` 接口 |

### 6.2 改写编辑器的三处未跟随已修复（Lead 12:40 复核）

| 原缺口 | 修复 | 证据 |
|---|---|---|
| 把 `model` / `stream` 当保留路径（`RESERVED_BODY_PATHS`，标红且不算有效行），与 ADR-010 #3 相反 | 删除常量与 `isReservedBodyPath`；行校验只拦保护头。改这两个路径时给**黄色提示**（影响选路 / SSE 帧），风险归管理员，不再拦截 | `web/src/components/transforms/transforms-editor.tsx` 无 `RESERVED_BODY_PATHS`；`ruleValid` 仅 `isProtected` 拦截 |
| 只读块仍写「仅 `response.code < 400` 参与改写」 | 改为「响应改写默认条件：无（W1 整改）」：控制面不再注入守卫，要只改成功响应需自己加条件行 | 同文件 `ReadOnlyBlock` 标题与两行文案已更新 |
| `regex_replace` 只存一个 `value`，后端读 `regex` / `replacement` | 规则行拆成「正则」「替换文本（留空=删除匹配）」两个输入；`types.ts:TransformRule` 增 `regex?` / `replacement?`；校验要求正则非空 | `npx tsc --noEmit` exit 0；`npx eslint src` 0 error / 0 warning |

## 7. 二期收口（2026-11-18）

本节覆盖上文 §1/§3 的“快照”状态：ticket 01–22 已全部合入 phase2/integration，旧系统功能对齐按最终 IA 复核。

- 导航四组（常规/配置/工具/系统）与页面命名：全局概览、数据看板、使用日志、账单、上游管理、模型管理、价目管理、模型试验、连接密钥、用户、管理员、策略、护栏、MCP、审计、配置版本、用户设置、运营设置。
- 旧功能均有落点：渠道→上游管理；模型管理→/models 两 Tab；模型试验→/playground；用户密钥→/client-keys（连接密钥）；成本/营收/待补价→/bills；上下游价目→/pricing；设置→/settings + /ops-settings。
- 可用性不再独立成页；UI 暴露一次性冷却与紧凑周期冷却编辑（重复方式+时间窗），完整排期日历不做，规则层能力完整保留（ADR-004）。
- 验证：node ops/checks/acceptance_browser.mjs --channel msedge --strict → PASS 25 / FAIL 0 / PENDING 0；route-audit exit 0；历史浏览器盘点见 §6。
