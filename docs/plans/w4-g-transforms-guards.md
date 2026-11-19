# W4-G 改写编辑器主从重构 + 未保存守卫全站铺开 + 确认弹窗校准

依赖：A1/A2 合入（icons）；建议在 D/E 之后（守卫 hook 会碰 upstream_detail 与 roles）。

## 范围

1. **TransformsEditor 主从布局重构**（components/transforms/transforms-editor.tsx）：
   - 左栏：四段导航（请求头/请求体/响应头/响应体 + 各段规则计数徽章），点击切换；右栏：选中段规则列表（每行=动作摘要+条件摘要，点击展开/定位编辑）+ 段底部「添加规则」；保留 JSON 模式、试运行本段、保存全部、系统默认只读块。
   - 规则多时右栏内部滚动；用户原话对齐：「左边选择要修改哪块内容，规则列表在对应修改的地方，方便找到自己添加了什么规则，要调整能快速定位，右边是规则调整」。
2. **统一 dirty 守卫 hook**：新 `web/src/lib/use-dirty-guard.ts`（从 upstream_detail.tsx 抽取：beforeunload + 捕获阶段 <a> 拦截 + 确认框 + leavingRef 放行），参数化 dirty 布尔。铺到：
   - upstream_detail.tsx：改用 hook；**新建态纳入**（isNew 时 dirty=pendingKeys.length>0 或 baseUrl/名称非默认——现 dirty 恒 false 的漏洞）。
   - transforms 编辑器：editor dirty 上抛到 upstream_detail 页面级（切页签判断也要纳入 transforms dirty，切走即丢的现状修掉）。
   - pages/gateway-policies.tsx（dirtyTotal>0 时守卫）。
   - components/roles/role-drawer.tsx（关闭抽屉前 dirty 比较+确认）。
   - pages/ops_settings.tsx 连接地址段、components/pricing/upstream-prices.tsx 行编辑（离开页面级守卫）。
3. **弹窗草稿守卫**：models.tsx 的 UpstreamModelDialog/PublicModelDialog/MembersDialog/BatchPriceDialog、cache-prices CachePriceDialog、keys-panel 弹窗——dirty 时 Esc/点遮罩/取消 → 确认「放弃修改？」（Radix onEscapeKeyDown/onPointerDownOutside 阻断 + ConfirmDialog；「保存并关闭」可不做，取消/继续编辑两键即可）。
4. **确认弹窗校准**（DESIGN-AUDIT §15）：
   - 「保存并下发」（gateway-policies）加确认：影响摘要（N 个分区有修改 + 提示将热加载数据面）；按钮旁加说明文案。
   - price-io「开始导入」加确认：显示将覆盖 N 行。
   - 删除「匿名尝试」确认与分支（D 波已做则跳过）。
5. **顺带**：upstream_detail 的 tabConfirm（若 D 波未清）删除；页签脏圆点若 D 波未做则本票补。

## 验收
前端五门禁绿；pytest 不受影响（无后端改动）；浏览器冒烟：①改写编辑器左栏切段/添加规则/定位编辑；②网关策略改一条→不保存直接点侧栏→出确认；③新建上游填一半→导航→出确认；④角色抽屉改权限→关闭→出确认；⑤策略保存并下发弹摘要确认；截图贴回报。commit `web(w4-g): 改写主从布局/dirty守卫全站/弹窗草稿守卫/确认校准`。
