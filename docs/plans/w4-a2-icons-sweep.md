# W4-A2 图标/语义色/对齐扫尾（依赖 A1 合入，使用 lib/icons 映射表）

前置：W4-A1 已合入（lib/icons.ts 存在、表格壳层改造完成）。本票把审计清单的剩余页面全部扫完。

## 范围（对照三路审计清单执行，逐条销号）

1. **补图标**（用 lib/icons 映射，图标+短词，纯图标带 title/aria-label）：
   - pages/client_keys.tsx：关闭/启用、重命名、重置、删除；页头「新建密钥」、弹窗「签发密钥」。
   - pages/roles.tsx：查看/编辑（Eye/Pencil）、删除、刷新、新建角色。
   - pages/gateway-policies.tsx 三 Tab：原始 JSON（FileJson）、恢复默认（RotateCcw）、编辑（Pencil）、试运行校验（FlaskConical）、保存并下发（Rocket）；mcp-tab 行内编辑/移除。
   - pages/audits.tsx、pages/config_revisions.tsx：详情（Eye）；config_revisions 抽屉「回滚到此版本」（Undo2）。
   - pages/settings.tsx、pages/ops_settings.tsx：编辑/保存/恢复默认；price-io 选择文件/重新选择（FolderOpen）、开始导入（Upload）。
   - components/pricing/upstream-prices.tsx：撤销（Undo2）、保存（Save）、批量改价；cache-prices.tsx 编辑、新建缓存价。
   - components/users/api-users-tab.tsx：充值（Wallet）、调整余额、流水（Receipt）、编辑、删除、新建用户（UserPlus）；console-tab.tsx：重置密码（KeyRound）、启用/停用→启用/关闭、删除；ledger-drawer.tsx：刷新、关闭。
   - pages/upstream_detail.tsx 页头：获取上游模型（CloudDownload）、测试连接（PlugZap）、保存（Save）。
2. **对齐修复**（头身一致，配 headerClassName/镜像机制）：client_keys 最后使用/创建时间、roles 成员数/权限数、users 余额/密钥数、audits 与 config_revisions 的**空表头 `header:""` 改「操作」**+时间/版本列、guardrails 起始版本。
3. **语义色**：settings 停用徽章、guardrails 不支持/未验证徽章、mcp-tab 移除按钮加 text-danger-text。
4. **空态误用修正**：api-users-tab.tsx 空列表 ErrorState → EmptyState（与同页 console-tab 一致）；roles/client_keys 空态补 emptyAction（新建角色/签发密钥 CTA）。
5. **术语**：停用→关闭（upstream-prices、settings、users 域）；「管理员」散点→管理用户（login.tsx 提示语、cooldown-dialogs、transforms-editor 文案、settings.tsx）。

## 不做
三套空态组件的彻底归一、上游渠道页（A1 已做）、models 域（C 波）。

## 验收
tsc / eslint / build（TEMP 指仓库内目录）/ check-ui-foundation / terminology strict error=0 全绿；抽查每类至少一处的截图贴回报；一次 commit `web(w4-a2): 图标语义色对齐扫尾——审计清单销号`。
