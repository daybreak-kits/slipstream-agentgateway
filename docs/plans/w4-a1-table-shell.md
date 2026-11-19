# W4-A1 表格基建壳层（四期地基）

交底文件：按本文件落地实现，改完自验后在回报里写清「改了哪些文件、跑了哪些门禁、EXIT 码」。只做本票范围，发现范围外问题记进回报，不要顺手改。

## 背景

规范全文见 `docs/DESIGN-AUDIT.md`「四期·表格与分页规范」与「四期增补」。已坐实的共用根因：

1. `web/src/components/ui/pagination.tsx:171` 的 sr-only 段（position:absolute）父级 nav 无 relative → 包含块逃逸到 html，长页面时把 html scrollHeight 顶到内容底部 → 整窗滚动出大片空白（全站事故，已活体验证、一行修复）。
2. `data-table.tsx` 的 TableWrap 无纵向滚动 → 所有 DataTable 页面整页滚动。
3. `ui/table.tsx` TH 固定 text-left、TD 无默认对齐；`models/table.tsx`（ModelColumn.className 只上 td）与 `pricing/table.tsx` 同病 → 表头与数据不对齐。
4. `data-table.tsx` storageKey 缺失时列设置静默消失。
5. 行内/批量操作大量缺图标、9 处「已关闭」徽章用中性灰（规范 12、16）。

## 范围（只做这些）

### 组件层
1. `ui/pagination.tsx`：外层 `nav` 加 `position:relative`（一行）。
2. `ui/table.tsx`：TH 对齐类支持（不改默认 left；供列定义镜像使用）。
3. `data-table.tsx`：
   - TableWrap 改造为表体内部滚动：滚动区高度自适应视口（目标：表格默认撑到页面最底部），用 `max-h-[calc(100dvh-17rem)]` 起步并配 `min-h-80` 兜底；表头吸顶已有 sticky 需确认在该容器内生效。
   - storageKey 未传且存在可隐列时 `console.warn` 一次（防静默丢列设置）。
4. `models/table.tsx`、`components/pricing/table.tsx`：
   - `ModelColumn.className`（及 PriceTable 等价物）改为**头身同用**（同时上 th 与 td），`headerClassName` 保留为覆盖通道；滚动高度公式与 DataTable 一致。
5. 新建 `web/src/lib/icons.ts`：动作动词 → lucide 图标单一来源（编辑=Pencil、删除=Trash2、关闭=Ban、启用=Play、测试连接=PlugZap、刷新=RefreshCw、复制=Copy、详情/查看=Eye、添加=Plus、冷却=Snowflake、周期=CalendarClock、重命名=Pencil、重置=KeyRound、充值=Wallet、流水=Receipt、撤销=Undo2、恢复默认=RotateCcw、保存=Save、导入=Upload、选择文件=FolderOpen、试运行=FlaskConical、下发=Rocket、原始JSON=FileJson、全局搜索=Search）。图标+短词按钮模式，纯图标按钮必须带 title/aria-label。注意：不设「轮换」映射——主密钥概念已废除（ADR-026），keys-panel 的轮换/设为主密钥入口归 D 波移除，本票不碰 keys-panel。

### 页面接入（本票只做这四页，其余页面归 A2 扫尾票）
- `pages/logs.tsx`：详情按钮加 Eye；重置加 RotateCcw；空态清除筛选加 X。
- `pages/upstreams.tsx`：裸 `<Table>` 迁移到 DataTable（列设置+存储+内部滚动）；行内 关闭/启用/测试连接/编辑/删除、批量四按钮、空态新建、错误重试全部配图标；「已关闭」徽章 `tone="neutral"` → `warning`（语义色规范 16）。
- `pages/models.tsx`（两个 Tab）：价格/被引用/成员列头身对齐修复；行内与批量按钮全部配图标（28 处清单见审计：models.tsx:688-732、1256-1289、905、918）；「已关闭」语义色。
- `components/upstreams/models-panel.tsx`：编辑/关闭启用/删除配图标；「关闭」语义色（本票只做图标与语义色，编辑器归一归 C 波，勿动字段）。

## 明确不做
- 不动 DataTable 分页/排序逻辑；不动日志耗时列语义色（F 波）；不动策略/弹窗业务逻辑；不删任何孤儿文件（I 波）；`upstreams.tsx` 迁移时保持现有列与筛选行为不变。

## 验收（全部亲自跑，EXIT 码写进回报）
```bash
cd web
npx tsc --noEmit
npx eslint src
npm run build   # 本机需先 export TEMP/TMP 指向仓库内目录（如 web/.scratch/tmproot）
node scripts/check-ui-foundation.mjs
node ops/checks/terminology_audit.mjs  # 仓库根目录跑，strict 口径 error=0
```
浏览器冒烟（vite dev 或 build 后预览均可，mock 账号 admin/admin12345，会话仅内存态、须 SPA 内导航）：
1. `VITE_MOCK=1 npm run dev` → /logs：1333×643 视口下 `document.documentElement.scrollHeight === clientHeight`（无窗口级滚动）；表格区出现内部滚动条且表头吸顶。
2. /models 两个 Tab：价格、被引用列表头与数据同侧对齐（截图贴回报）。
3. /upstreams：列设置按钮出现且勾选状态刷新后保留；小窗（约 1100px 宽）横向滚动时操作列冻结可见。
4. 回报中列出：改动文件清单、每条门禁 EXIT 码、冒烟截图路径。
