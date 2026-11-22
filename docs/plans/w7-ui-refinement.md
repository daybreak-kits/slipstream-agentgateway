# W7 UI 与领域收口方案（待确认，未实施）

状态：**方案已按 W1–W6 决策复核并调整，14 张 tickets 已发布；等待实施启动。** 与 spec 冲突处以 `.scratch/w7/spec.md` 的 Conflict Review 为准。
日期：2026-11-21
依据：用户 m06570 / m06684 / m06721；旧系统参考（本地只读快照，路径脱敏）；当前 HEAD 5c13b6b（w6/preview）。

## 0. 完成定义（DoD）

1. 用户确认本方案后再实施；实施后所有页面和交互按 §3 决策落地。
2. 不写生产迁移脚本、不保留厂商兼容层：当前只有 mock/seed 数据，实施时重置本地库并重新 seed。
3. 后端契约、GLOSSARY、DESIGN-AUDIT、api-contract、billing 文档同步；全量 pytest、tsc、eslint、vite build、check-bundle、check-ui-foundation、terminology、键盘/浏览器验收全绿。
4. 不引入真实上游凭据；mock 测试只使用本地固定响应。

## 1. 已定决策

### D1 用户：一张表、所有用户都有登录账号
- `users` 继续作为唯一用户表；username 落库必填且唯一（不可改），password_hash 对所有用户非空；创建时保留 ADR-019 的自动生成/一次性密码，也支持手填。
- 删除用户表“类型”列及“控制台/无账号”二态；没有登录账户的 mock 用户全部由 seed 补齐用户名和密码。
- 不写生产迁移脚本；seed 直接生成完整账号。
- 登录名/显示名在用户表中的 UI 文案统一为「用户名称」「登录帐户」。
- 角色仍是控制台权限；用户是 API 消费者，但每个用户都必须有登录账户。

### D2 厂商：彻底移除，代价是缓存价目键迁移
- 用户指出得对：厂商不是成本价目的业务维度；当前 `upstream_prices` 用 `(vendor_id, upstream_model, item)` 是历史残留。
- 供应商/厂商的 `Vendor` 领域、`vendors` 表、`/admin/vendors` API、`vendors:read/write` 权限、前端厂商字段/类型/搜索/种子数据全部删除。
- 缓存价目改为 `upstream_prices(upstream_model_id, item, ...)`；成本主价继续挂 `upstream_models`（ADR-020）。
- `cost_entries` 去掉 `vendor_id`；成本回溯按 `upstream_model_id`。账单/报表/契约/测试同步。
- 不保留旧厂商表与兼容查询；重置 mock 库，不迁移历史数据。

### D3 上游标志与别名
- 不新增 slug/code；`upstreams.name` 作为唯一“上游标志”，保留 ADR-023 的 base_url 自动生成与重名 422。
- 新增可选 `upstreams.alias`，仅用于展示；允许为空、不参与路由。
- 列表列改为「上游标志」「上游别名」；详情页标志与别名同排。
- 中等屏幕以上：连接地址与协议风格同排；标志与别名同排。
- 删除厂商字段、厂商筛选、厂商展示和 `/admin/vendors` 相关入口。

### D4 登录：保留白色背景，只增强渐变
- 现有登录页布局和白色背景**不改**；不做旧系统的深色左栏，不改整体背景。
- 借鉴旧系统的渐变手法：用更大的柔光色场/多层径向渐变增强可见度，保持静态、低饱和、文字可读。
- 保留三态主题、密码显隐、错误预留、窄屏适配。
- 旧系统只作为渐变质感参考，不照搬其深色背景。

### D5 已选成员表格化
- 左侧从 flex 行改为表格：`成员 / 上游 | 优先级 | 权重或表达式 | 更多配置 | 移除`。
- 输入标签用中文「优先级」「权重」「表达式」；按当前策略只显示适用字段。
- 每行「更多配置」点击向下展开，承接未来扩展字段；窄屏退化为卡片堆叠。
- 已选与候选两栏的标题、表头、搜索框在同一水平线对齐；候选列表与表格列头对齐。
- 候选成员始终保留在原位；点击后变灰、`+` 变 `×`，原地再点取消；左侧已选只能点 `×` 移除。

### D6 日志筛选与尝试
- 删除“筛选已修改，点「查询」生效。”提示。
- 查询按钮默认白底（与其他普通按钮一致）；只有筛选条件发生未应用变化时才变为强调色。
- 发生变化的筛选输入框只加黄色边框，不加提示文案。
- 删除独立「尝试」列。模型单元格在 `attempts_count > 0` 时显示分叉图标；点击弹 popover，每行模型/状态码/耗时，点行展开错误详情。
- 删除输入框式的“请求模型未记录”：`requested_model` 缺失时只显示实际上游模型，不补占位提示。

### D7 连接密钥与用户
- 复制密钥不再直接依赖 `navigator.clipboard`：先尝试 Clipboard API，失败回退 `textarea + execCommand`，再失败 toast 错误；只在写成功后提示。
- 连接密钥采用 B 方案：客户只能给自己签发；管理员/分销商在可见子树内可代签。customer/reseller 需补 apikeys:read/write；客户界面隐藏用户选择，管理员/分销商保留代签入口。
- 用户列表所有用户都有登录帐户；删除类型列；关闭/启用由行操作表达，不再保留重复状态列。

### D8 状态表达
- 所有有启用/关闭/冷却行操作的表格删除独立状态列：上游渠道、连接密钥、用户管理、模型管理。
- 模型名称旁放小状态图标：只在非正常状态（关闭/冷却/未知）显示；正常不显示。
- 悬浮详情：关闭=“已关闭，人工启用后恢复”；冷却=“冷却中，yyyy-mm-dd hh:mm:ss 后解除”；未知=“状态未知”。
- 行底色和操作文案继续表达关闭/冷却；键盘可聚焦并触发提示。

### D9 模型参数与 HoverInfo
- 所有模型参数列只显示：`输入 xxx,xxx / 输出 xxx,xxx`。
- 其余参数（上下文、模态、工具/推理能力等）放进统一 `HoverInfo`；表格单元格和模型详情共用。
- 新建 `web/src/components/ui/hover-info.tsx`：hover 250ms 出现、键盘 focus 可触发、portal 定位、视口碰撞处理、触屏点击可显示；逐步替换散落 `title`。

### D10 全局脏字段
- 去掉 `DirtyField` 左侧深色黄线；保留浅黄背景和「已修改」文字/图标/恢复入口（W5 D8 不可仅颜色编码）。标记使用固定槽/绝对定位，不推挤或移动原有页面元素。

### D11 弹框键盘操作
- 创建/保存/确认弹框统一：Enter 触发主操作（输入法组合中不触发），Escape 取消，Tab 焦点陷阱，关闭后焦点还原。
- 危险确认默认焦点在“取消”；表单型弹框默认焦点在第一个输入框；提交中禁用重复提交。
- 所有使用 `Dialog`/`AlertDialog` 的创建、保存、删除、签发、重置密码流程纳入统一测试。

## 2. 非范围

- 不做生产数据迁移；不写兼容旧厂商/旧角色的迁移脚本。
- 不接真实上游；mock 固定响应只在 ops/checks 测试中使用。
- 不改登录页整体白色背景/左右布局；不搬旧系统深色左栏。
- 不新增拖拽排序、批量成员编辑等未提出的功能。

## 3. 工作包与文件范围

### W7.1 后端领域与数据模型
- `api/src/l02_domain/models.py`：删除 Vendor；Upstream 删 vendor_id、增 alias；UpstreamModel 补 `upstream_model_id` 价格语义如需要。
- `api/src/l04_repo/orm.py`：删 `vendors` 表/VendorORM；`upstreams.vendor_id` 删除、增 alias；`upstream_prices` 改 `upstream_model_id`；`cost_entries.vendor_id` 删除；UserORM username 非空。
- `api/src/l05_service/crud.py`、`prices.py`、`usage_ingest.py`、`aggregates.py`、`rbac.py`：去 vendor、缓存价按 upstream_model_id、成本查询、权限表清理。
- `api/src/l06_api/routers_upstreams.py`、`routers_models.py`、`routers_billing.py`、`routers_vendors.py`、`schemas.py`：删厂商 API/字段；上游 alias；用户 username 必填；密钥签发只允许当前用户。
- `api/scripts/seed_demo.py`：无 vendor；上游含 flag/alias；用户全部有用户名/密码；缓存价按 upstream_model_id；更新预期计数。
- `api/tests/**`：删除厂商测试/夹具；更新价格、用户、密钥、上游、种子测试；新增“无厂商字段”“所有用户可登录”“缓存价按键模型”用例。
- 重置本地 mock DB；不写迁移脚本。

### W7.2 前端基础组件
- 新增 `web/src/components/ui/hover-info.tsx`。
- 新增 `web/src/components/ui/status-icon.tsx`（模型状态图标 + 悬浮详情）。
- 扩展 `web/src/components/ui/dialog.tsx`（或统一 `confirm-dialog`）：键盘行为、焦点还原。
- `web/src/components/ui/dirty-field.tsx`：删左侧线，改浅黄背景。

### W7.3 登录页
- `web/src/pages/login.tsx`、`web/src/index.css`：保留白底和现有布局；增强多层柔光渐变；深浅主题对比检查。

### W7.4 公开模型成员编辑
- `web/src/components/models/member-chip-flow.tsx`：表格/展开/对齐/候选切换。
- `web/src/components/models/member-chip.ts`、`member-drafts.ts`：候选全量渲染、选中态、toggle 语义；保留去重/兜底校验。
- `web/src/pages/models.tsx`：编辑页接入新表格。

### W7.5 日志页
- `web/src/pages/logs.tsx`：筛选 dirty 样式、查询按钮白底/变色、尝试图标与 popover、模型单元格回退。
- 复用/扩展现有 `RequestAttemptChainPopover` 或抽出 `AttemptsPopover`，删除独立 attempts 列。

### W7.6 密钥与用户页
- `web/src/pages/client_keys.tsx`：复制回退、新建密钥只给自己、去掉用户 Select。
- `web/src/components/keys/copy-key-button.tsx`：安全复制。
- `web/src/components/users/users-panel.tsx`：删类型列/状态列、列名改用户名称/登录帐户、无账号逻辑移除。

### W7.7 上游渠道
- `web/src/pages/upstreams.tsx`：删 vendor 查询/展示；列改上游标志/别名；删状态列。
- `web/src/pages/upstream_detail.tsx`、`web/src/components/upstreams/connection-tab.tsx`：标志/别名同排，地址/协议同排；删厂商字段。
- `web/src/components/upstreams/models-panel.tsx`：测试密钥默认项去重；添加模型/拉取模型/全部测试与标签页分隔。

### W7.8 模型管理
- `web/src/pages/models.tsx`：删状态列、模型名旁状态图标、参数列只留输入/输出、HoverInfo 展示完整参数。

### W7.9 文档、门禁与验收
- 更新 GLOSSARY（Vendor 删除、User 登录账号、上游标志/别名、Member 表格、Attempts 图标）。
- 更新 DESIGN-AUDIT（登录渐变、成员表格、状态图标、HoverInfo、键盘）。
- 更新 GLOSSARY、api-contract、contracts/billing、DELIVERY、ACCEPTANCE、DESIGN-AUDIT；修订 ADR-019/020/023、ADR-002（或新增 ADR-030）；历史计划保留原样并注明取代关系。
- 运行：全量 pytest；web 全部门禁；浏览器逐页截图；键盘用例；确认工作区无临时文件、无真实密钥。

## 4. 验收清单

- [ ] 用户管理无“类型/无登录”行；所有用户可登录；列名为用户名称/登录帐户。
- [ ] 上游渠道无厂商字段/筛选/API；标志唯一、别名可选；中等屏两两同排。
- [ ] 缓存价按 upstream_model_id，成本/账单/价目页面无 vendor。
- [ ] 登录页仍白底，渐变肉眼可见且不压文字；浅/深/跟随系统均通过。
- [ ] 已选成员表格、中文输入标签、展开行、候选灰态+×、左右对齐全部通过。
- [ ] 日志筛选无提示文案、默认白按钮、改动黄边/变色；尝试图标与 popover 正常；无独立尝试列。
- [ ] 密钥复制在 HTTP/HTTPS、无 Clipboard API 环境均成功或明确报错；新建密钥不能选用户。
- [ ] 有操作表格无状态列；模型非正常状态图标与冷却解除时间准确。
- [ ] 模型参数只列入/出；HoverInfo 在鼠标/键盘/触屏可用。
- [ ] 创建/保存/确认弹框 Enter/Esc/Tab/焦点还原通过。
- [ ] 全量门禁绿；无临时文件/真实凭据。

## 5. 风险与处理

- 删除 vendor 会触及缓存价、成本归因、账单报表；这是本方案最大改动。因为当前只有 mock 数据，采用“删表+重 seed”而不是迁移；实现前先跑一次当前基线，实现后重建本地库。
- 登录渐变容易再次做成“存在但看不见”；验收以 1440/375 截图和对比度检查为准，不以 CSS 类存在为准。
- 成员表格在 375 宽度容易溢出；采用桌面表格、移动卡片两套布局，不用横向滚动承载编辑。
- 去除状态列后必须确保操作文案和行底色仍能表达关闭/冷却，避免用户失去状态感知。

## 6. 确认项

用户确认后按 W7.1→W7.9 实施；未确认前不改代码。
