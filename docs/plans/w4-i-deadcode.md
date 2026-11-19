# W4-I 死代码清理与收口（最后实施波）

前置：A1/A2/B/C/D/E/F/G/H 全部合入后执行（防止误删仍被引用的文件）。

## 范围

1. **删除零引用孤儿文件**（已由审计 grep 确认 0 引用；删除前再跑一次引用核查，若有新引用则该文件移出清单并在回报说明）：
   - components/billing/：cost-panel.tsx、my-spend-panel.tsx、unpriced-panel.tsx、cells.tsx
   - components/upstreams/health-panel.tsx（与 status-panel 重复）
   - components/chart-placeholder.tsx
   - components/ui/：avatar.tsx、breadcrumb.tsx、form.tsx、input-group.tsx、metric-pills.tsx、progress.tsx、scroll-area.tsx
   - lib/storage.ts、lib/timezone.ts
   - components/governance/permissions.ts（旧 RBAC 镜像，14 资源×read/write/manage 模型）
   - 未消费的 barrel（components/governance/gateway-policies/index.ts、components/time-range-picker/index.ts）——核实后删或保留（倾向删）
2. **mock.ts 对齐**：MOCK_ROLES/MOCK_PERMISSION_GROUPS 旧 owner/operator/viewer 模型改为 admin/agent/user + 真实权限键（与 lib/roles.ts 一致）；fetchRoles mock 返回同步。
3. **收口杂项**：grep 全仓确认无 `轮换|设为主密钥|is_primary|匿名尝试` 残留（UI 层；ADR/历史文档除外）；components/logs/report-mocks 等仍被 useMock 引用的不动。

## 验收
删除后全仓 `npx tsc --noEmit`、`npx eslint src`、`npm run build`（TEMP 指仓库内目录）、check-bundle、check-ui-foundation、术语 strict 全绿；`python -m pytest` EXIT=0（web 删除不应影响 api，跑一次作基线确认）；bundle 体积对比（应下降）。commit `web(w4-i): 死代码清理——孤儿组件15文件/mock角色对齐/收口杂项`，回报附删除清单与各门禁 EXIT 码。
