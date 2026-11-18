# Slipstream 前端审计（t8 质量闸门）

- 快照时间：2026-11-17 03:12–03:15（W1 波次进行中，本清单随批次滚动更新，只增不改行号锚点）；03:20 采纳 lead 裁定，更新 §8 / S2 / G6 / build 口径
- 范围：web/src 全部 24 条路由（18 落地页 + 5 占位页 + 404）、components、lib
- 方法：逐页读源码 + 模式扫描（fetch/console/any/TODO/端口/mock/深色/tnum/响应式/状态四件套），脚本基线见 §6
- 分级：**阻断** = 验收矩阵四查或关键流程不过；**严重** = 功能/体验缺口需排期修复；**一般** = 一致性与打磨

## 1. 结论速览

| 级别 | 数量 | 一句话 |
|---|---|---|
| 阻断 | 2 | 错误态全站缺失；关键流程 CRUD 未接线（W2 认领中） |
| 严重 | 4 | 空态无主操作；/login 无认领；动态路由标题回退；遮罩硬编码 |
| 一般 | 6 | 裸 table、title 文案、英文表头、窄屏断点等 |

## 2. 阻断

### B1 错误态全站缺失（验收矩阵第 3 查不过）

- 证据：pages/ 下 grep `isError|错误|重试|加载失败` = **0 命中**；所有页面只解构 `{ data, isPending }`。
- 后果：query 失败后 data=undefined——
  - StatCard 永久骨架：stat-card.tsx:21 `loading || value === undefined` → 骨架永不消失（验收第 1 查「骨架 300ms 内消失」同样不过）；
  - DataTable 页误报空态：data-table.tsx:29 默认 `emptyText="暂无数据"`，错误被当成「没有数据」。
- 缓解：lib/api.ts:44-52 连接失败/HTTP 错误已有全局 toast，用户并非无反馈，但页面体无重试。
- 建议：给 DataTable/StatCard 增加 `error` + `onRetry`（或包 QueryErrorResetBoundary），W2 接线时每页补一行即可；验收前必须完成。

### B2 关键流程 CRUD 未接线（FRONTEND-PLAN §4 流程 1/2/4 暂不可走）

- upstreams.tsx:26 纯只读 DataTable：无新建/编辑/删除/发现模型入口；FEATURE-PARITY §3 要求的批量工具栏、密钥面板、连接状态徽章均未落盘。
- availability.tsx:25 只读：无封禁/冷却/周期计划设置入口。
- 全站 mutation toast 仅 client_keys.tsx（4 处）与 unpriced.tsx（2 处）两页。
- 定性：W2（04:40–06:10）认领中的快照事实，**不是最终判定**；列入跟踪，06:10 后复查是否清零。

## 3. 严重

| # | 问题 | 证据 | 建议 |
|---|---|---|---|
| S1 | 空态无主操作 | ui/empty.tsx:5-8 仅一段文本；DataTable 的 emptyText 无 action 槽 | Empty 加 `action?: ReactNode`；主列表页传「去新建」按钮 |
| S2 | /login + ProtectedRoute 无认领无落盘 | FEATURE-PARITY.md §1 要求保留；FRONTEND-PLAN 波次表无 owner | 已裁定（03:20）归 t7 实现；t8 只复核：登录可达、未登录跳转、登录后回跳原路由 |
| S3 | 动态路由标题永远显示 Slipstream | app-shell.tsx:57 `PAGE_TITLES[location.pathname]` 精确匹配，/upstreams/:id 命不中 | 改 startsWith/基路径匹配，或 PAGE_TITLES 加 `/upstreams/:id` 规则 |
| S4 | 遮罩色硬编码 bg-black/80 | ui/alert-dialog.tsx:31、ui/dialog.tsx:34、ui/sheet.tsx:34 | 深浅色无差异；W3 由 t7 收进 token（--overlay） |

## 4. 一般

| # | 问题 | 证据 | 建议 |
|---|---|---|---|
| G1 | 充值记录用裸 table | client_keys.tsx L117-139 | 换 ui/table 组件保持一致性 |
| G2 | title= 承载说明文案 | client_keys.tsx:82、:96 | 键盘/触屏不可达；页面底部已有说明段，title 可删或换 Tooltip |
| G3 | 表头英文 Base URL | upstreams.tsx:21 | 改「接入地址」 |
| G4 | 窄屏仅靠表格横滚 | ui/table.tsx overflow-x-auto 全站依赖；overview.tsx 有响应式网格 ✓；settings/mcp/audits 等 grid-cols-2 固定 | W3 给卡片网格补 sm: 断点 |
| G5 | eslint react-refresh 警告 2 处 | ui/button.tsx:6、components/governance/user-dialogs.tsx:312 | 仅 DX，低优先 |
| G6 | ~~命名与 parity 文档不一致~~ 已裁定 | FEATURE-PARITY 用 /api-keys，实现为 /client-keys | UI 保持 /client-keys（客户端密钥），后端 /admin/api-keys；FEATURE-PARITY.md 已同步 |

## 5. 每页四件套矩阵（03:15 快照）

图例：✓ 已实现 / ▲ 继承基座但基座缺该态 / ✗ 缺失。加载/空态由 DataTable（data-table.tsx:56-63、:96）继承；错误态 B1 全缺。

| 页面 | 加载 | 空态 | 错误态 | 操作反馈 | 窄屏 | 深色 | 中文 | 备注 |
|---|---|---|---|---|---|---|---|---|
| overview | ✓ StatCard 骨架 | ▲「—」占位 | ✗ | — | ✓ 响应式网格 | ✓ token | ✓ | 图表是占位组件 |
| availability/cost/revenue/unpriced/upstream-prices/downstream-prices/upstreams/upstream-models/public-models/config-revisions/audits/policies/guardrails/mcp/settings（14 页） | ▲ DataTable | ▲ 无主操作 | ✗ | 仅 unpriced 补价 toast | ▲ 横滚 | ✓ | ✓ | 纯列表页，等 W2 接 CRUD |
| client_keys | ▲ DataTable | ▲ 无主操作 | ✗ | ✓ reveal/充值 toast | ▲ 横滚 | ✓ | ✓ | G1/G2 待修；掩码+reveal 语义正确（明文不进缓存） |
| upstream_detail | ✓ 双 Skeleton | ▲ | ✗ | — | ▲ | ✓ | ✓ | 双 tab：基本信息/改写（transforms-editor） |
| dashboard/logs/playground/admins/users | 占位页 | — | — | — | — | — | — | pages/placeholders.tsx，W1 落盘中（admins.tsx 已见真实代码） |
| 404 | — | — | — | — | ✓ | ✓ | ✓ | app.tsx 内联「页面不存在」 |

## 6. 专项扫描与闸门基线（03:12）

| 检查 | 结果 |
|---|---|
| 裸 fetch | 仅 lib/api.ts:43（统一入口），页面 0 命中 ✓ |
| 3691 / 1900x 端口、localhost | 仅 lib/api.ts:5 默认 `http://127.0.0.1:3700`（合规），违禁端口 0 命中 ✓ |
| console.log / `: any` / as any / TODO | 全 0 ✓ |
| mock 硬编码进页面 | 0；mock 集中在 lib/mock.ts + lib/playground.ts（W1 进行中）+ app-shell useMock 开关 ✓ |
| .tnum 等宽数字 | 58 处 ✓ |
| tsc --noEmit | **1 error**：pages/admins.tsx:133 TS6133 openEdit 未使用（t4 收尾可清零） |
| eslint src | **1 error**（同上 admins.tsx:132）+ 1 warning（user-dialogs.tsx:312 react-refresh） |
| vite build | 由 Lead 统一执行（沙箱内 esbuild spawn 受限）；verify_web.sh 已把该步注释并标注 |
| 路由遍历 | 24 路由全部解析：文件存在 ✓、导出 ✓、导航覆盖 ✓（见 ops/checks/route-audit.mjs 输出） |

## 7. 闸门工具（t8 交付，业务代码零改动）

- `ops/checks/verify_web.sh`：tsc → eslint → vite build → route-audit，逐项 PASS/FAIL + 耗时，日志落 `ops/checks/.logs/`。
- `ops/checks/route-audit.mjs`：路由表 → 页面文件存在性/导出/导航可见性/PAGE_TITLES 覆盖/FEATURE-PARITY 缺口；阻断缺失退出码 2。

## 8. 裁定记录（lead 03:20）

1. /login + ProtectedRoute 归 t7 实现，t8 只复核（S2 转跟踪）。
2. 命名：UI 路由保持 /client-keys（中文「客户端密钥」），后端 /admin/api-keys；FEATURE-PARITY.md 已同步（G6 关闭）。
3. B1/B2 修复归 t7（DataTable/StatCard 三态、Empty CTA、上游/对外模型 CRUD）；t8 下一轮复核重点：**错误态可重试、空态 CTA 可点、深色模式对比度、1280 宽可用**。
## 9. 收尾复核（Lead 09:40，W2 批次落地后）

本轮针对 §2 的两项阻断与 §3 的严重项做最终复核，结论如下（以当前工作树 + 3700 实测为准）：

| 原编号 | 状态 | 证据 |
|---|---|---|
| B1 错误态全站缺失 | **关闭** | `components/ui/data-table.tsx` 与 `stat-card.tsx` 已接 `error/onRetry`（Scholarly 页面统一可重试）；`app.tsx` 增路由级 `ErrorBoundary`（/public-models 白屏事故后加） |
| B2 关键 CRUD 未接线 | **关闭（主要实体）** | 已接线写操作：上游、上游模型、对外模型（含路由目标）、客户端密钥、用户（充值/调账/退款）、管理员、设置、改写编辑器、待补价；只读展示：价目、日志、审计、配置版本、策略、护栏、MCP |
| S1 空态无主操作 | 关闭 | DataTable `Empty` 增加 `action` 槽，列表页空态可点「新建」 |
| S2 /login 无认领 | 关闭 | `pages/login.tsx` + `components/protected-route.tsx` + 501 直通标志（`lib/auth.ts`） |
| S3 动态路由标题回退 | 关闭 | `app-shell` 前缀匹配 + PAGE_TITLES 兜底 |
| S4 遮罩硬编码 | 关闭 | 统一 `--overlay` token |
| G5 eslint react-refresh | 1 条保留 | `components/playground/params-panel.tsx:33` 常量导出，DX 级，不阻断 |

**闸门基线（09:40）**：`tsc --noEmit` exit 0；`eslint src` 0 error / 1 warning；`vite build` exit 0（1,741.93 kB / gzip 546.59 kB）；24 条路由全部解析；23 页浏览器逐页截图已清理（可用 `node ops/checks/acceptance_browser.mjs` 重新生成）。

**仍未闭环（转入二期）**：`/admin/reports/trend` 的 24h/小时桶；前端包体拆分；控制台登录真实鉴权（当前 501 直通）。

## 10. 双轴审查整改复核（Lead 12:40）

用户对 /code-review 指出的问题裁定「全部修复」。整改后复核如下（以当前工作树 + 3700/5173 实测为准）：

### 10.1 后端（代码审查 Standards 轴）

| 原问题 | 修复 | 证据 |
|---|---|---|
| import-lint 解析 bug，规则恒真（每层 name 形如 `l01_core`，`part[2:]` 不是数字） | 重写为纯函数 `_violations_for(layer, modules)`，只把 target_layer > own_layer 判违规（同层合法），并加自检用例 | `api/tests/test_import_layers.py` 全绿；`test_layering_guards.py` 单独钉 S2 三条 |
| `l05_service` import `l03_adapters.registry.create`（越层），校验下沉 | 唯一构造点 `l06_api/adapter_factory.py:make_adapter`；rendering/apply/rollback 改为接收 adapter；`validate_gateway_ir` 下沉 `l02_domain/validation.py`；`pull_once` 下沉 `l05_service/usage_pull.py` | `api/src/l05_service/rendering.py` 不出现 `adapter_factory`；`pytest` 98 passed |
| 服务层不调 adapter.validate | apply 写文件**之前**调 `adapter.validate`，失败返回 APPLY_FAILED + details.errors | `api/src/l03_adapters/agentgateway/apply.py` |
| apply status 返回控制面 marker 而非真实 hash | 读配置文件真实 sha256 与 `.hash` marker 比对，返回一致/`config file missing`/`config drift` | 同上 |
| adapter-spi §5 契约测试只有 mock | 新增 `api/tests/contract/test_agentgateway_adapter.py` 13 条（status hash、usage 幂等、validate 等），mock 补 2 条 | `pytest` 98 passed |
| with_default_actions 注入 `response.code < 400`（推翻 ADR-010 #2） | 删除注入，默认动作只剩 response header delete server / x-powered-by | `l03_adapters/agentgateway/render.py`；`pytest` 全绿 |
| 体改写黑名单拦 `model` / `stream`（推翻 ADR-010 #3） | 删除黑名单，只保留路径形状校验 | `l02_domain/transforms_codec.py` |
| `regex_replace` 实为字面 replace（ADR-009/013） | 编译为 CEL `regexReplaceAll(ref, regex, replacement)`，删 REGEX_NOTE；测试断言两侧都生成 regexReplaceAll | `l03_adapters/agentgateway/transforms.py`；`test_transforms_compiler.py` |
| weighted 目标顺序未按 IR | `build_render_plan` 仅 failover 按 priority 排序，weighted 保留 IR 顺序；weight 为整数相对比例 | `test_render_snapshot.py` |
| IR 缺 policies/guardrails/mcp 三块（M4） | `l02_domain/ir.py` 定义（frozen+slots），`l05_service/policies.py:build_policy_blocks(adapter)` 填充；渲染守卫 `test_render_never_emits_unsupported_blocks` | `pytest` 全绿 |
| 只读接口返回裸 dict | 改为 schemas 类型模型 PoliciesOut / GuardrailsOut / McpServersOut；ErrorCode 改 StrEnum | `ruff check` All checks passed |
| availability 创建 500（多传 scope/scope_id） | 关键字签名 + 校验 scope_id 存在性；CREATABLE_SCOPES=(upstream, upstream_model, model_target)，EVALUATOR_SCOPES=(upstream, model_target)，上模型创建 422 | `api/tests/integration/test_availability_api.py` 8 条 |

### 10.2 前端（代码审查 Spec 轴 + 范围蔓延）

| 原问题 | 修复 | 证据 |
|---|---|---|
| ⌘K 全局搜索缺失 | `web/src/components/global-search.tsx`（Command+Dialog，四组结果，⌘K/Ctrl+K），app-shell 挂载 | 浏览器实测：⌘K 打开、输入 glm 命中 11 条、Esc 关闭 |
| 主题缺「跟随系统」 | `lib/theme.ts` 三态 light/dark/system，默认 system + matchMedia 监听 | 浏览器实测：点「跟随系统」后 localStorage=system |
| 冷却/周期计划、批量操作只有只读 | `availability-create-dialog.tsx`（once + daily/weekly/monthly windows）；`upstream_models.tsx` 行选择 + 批量启用/停用/删除 | 浏览器实测：新建规则弹窗可开；表头全选后工具条「已选 20 / 20」；API `PATCH /admin/upstream-models/batch` 返回 `{changed,missing,action}` |
| `channel-models.ts` 旧「渠道」词汇、placeholders 页、mock 默认开启 | 删除并替换为 `lib/playground-model-options.ts`；删除 placeholders；mock 改 `VITE_MOCK` 显式开关（默认关） | `grep` 无 `channel_` 字段；`app.tsx` 无占位路由 |
| public_models 无 ADR-014 提示、weight 写「万分数」 | 加「无跨层兜底 / 无 P2C」提示；weight 改整数相对比例（1:3 措辞，校验拦小数） | 浏览器实测文案在，且「万分数」消失 |
| 改写编辑器三处未跟随 W1/W2/regex | 见 FEATURE-PARITY §6.2（保留下路径提示不拦截、默认条件文案、regex/replacement 拆分） | `tsc` 0；`eslint src` 0 error / 0 warning |
| 404 页缺失 | `web/src/pages/not-found.tsx` + `path="*"` | 浏览器实测 /no-such-page 显示 404 页 |

### 10.3 终局闸门（12:40）

- 后端：`pytest` **98 passed**；`ruff check api` **All checks passed**；`ops/checks/smoke_api.py` **33/33 PASS**。
- 前端：`npx tsc --noEmit` **exit 0**；`npx eslint src` **0 error / 0 warning**（原 params-panel react-refresh warning 已通过抽取 `lib/playground-params.ts` 消除）；`npm run build` exit 0（1,777.07 kB / gzip 555.58 kB，>900kB chunk 警告保留，转二期 code-split）。
- 浏览器（1440x900，dev 5173）：24 条路由全部渲染，无 NaN/undefined/[object Object]、无错误边界；⌘K、主题三态、批量操作、可用性新建弹窗、改写编辑器均已实测。

### 10.4 回滚链路缺陷（docs 子代理交叉复核发现，已修）

| 缺陷 | 修复 | 证据 |
|---|---|---|
| `rollback_to_revision` 把 `target.artifact_hash` 传给 `adapter.rollback(revision_id)`（驱动按版本号查历史，永远查不到），且不检查 `ApplyResult`，失败也会归档为 active | 改传 `target.id`；驱动无历史（重启）时用归档 artifact 走 `apply` 重放；两条路都失败则归档 `status="failed"`、保留旧 active、抛 APPLY_FAILED + details.message；成功时 hash 取 `applied_hash` | `api/tests/integration/test_config_rollback.py` 3 条（传版本号、历史丢失回退、失败归档）；`pytest` 101 passed |
| 上游「改写」tab 白屏：GET transforms 返回 `{upstream_id, transforms}` 包装，前端当 4 段规则用（`value[section].every is not a function`）；预览接口吃 4 段全量规则、返回编译后 dict，前端只发 `{section, rules}` 并按 `skipped_reason` 字符串渲染 | 前端解包并归一化 `transforms: null` → 四段空数组；预览改发 `{...allTransforms, [section]: rules}`，渲染 `after` 的 JSON 与 `notes/skipped`；mock 同步包装与预览形状；契约补进 api-contract §3.2 | Playwright 实测：未配置改写的上游不再白屏；新建 regex_replace 行填 `^abc$`→`xyz`，预览返回 `regexReplaceAll(request.headers["x-trace"], "^abc$", "xyz")` |

**仍未闭环（转二期）**：`/admin/reports/trend` 的 24h/小时桶与 flow 时间区间；前端包体 code-split；控制台登录真实鉴权（当前 501 直通）；availability 规则的编辑/删除接口。
