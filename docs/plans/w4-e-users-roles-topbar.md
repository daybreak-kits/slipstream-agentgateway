# W4-E 用户管理合并 + 角色门禁 + 顶栏用户菜单

规范依据：DESIGN-AUDIT §13（RBAC 显隐红线：操作显隐一律查权限键，禁止按实体类型硬编码）、ADR-019（统一用户表）。

## 范围

1. **用户管理单页合并**（pages/users.tsx + components/users/*）：
   - 删除「API 用户 / 控制台账号」双页签：**一个列表**（保留 树视图/列表 视图切换），数据源维持 GET /admin/users/tree。
   - 有 username（可登录控制台）的行显示「控制台」徽章（Badge neutral）——仅标识，**不作为任何操作的显隐依据**。
   - 操作列按 RBAC 显隐：充值/调整余额/流水=逐个查 billing 相关键（billing:spend/billing:cost/ledger:read）；重置密码=users:update（或现用键，以后端 require 为准逐一核对）；编辑=users:update；删除=users:delete；无键账号不显示登录相关操作。
   - 角色编辑统一走 EditUserDialog（删除 console-tab 的行内 Select）；删除确认文案统一一套（软删除语义）；行内 启用/关闭 统一。
   - 列：用户（树形缩进）/角色/类型徽章/余额/密钥数/状态/层级/操作。
2. **角色管理**（pages/roles.tsx）：自定义角色 CRUD 已通，补两处——「编辑」按钮加 `roles:write` 门禁（无权限隐藏，与删除同规则）；内置角色入口改「查看权限」只读摘要视图（沿用抽屉但保存区隐藏，文案明确"内置角色权限由后端锁定"）。
3. **顶栏用户菜单**（components/layout/topbar.tsx）：
   - 最右侧改为 头像圈（首字）+名字，点击开 DropdownMenu：**用户设置**（跳 /settings）、**修改密码**（跳 /settings 安全段）、**主题**（浅色/深色/跟随系统，选中即写服务端偏好——与 settings.tsx 同端点，顶栏不再有独立主题 ToggleGroup；未登录服务端偏好时降级 localStorage）、**退出登录**。
   - 删除独立退出图标按钮与独立主题切换组；settings.tsx 主题 section 保留但与顶栏同源。
4. **全局搜索**（components/global-search.tsx）：加入 **用户**（GET /admin/users 现有端点，跳 /users 并带定位参数或仅跳页）与 **角色**（GET /admin/roles，跳 /roles）；更新描述文案；`/models?tab=` 深链修复——models.tsx 页签状态回写 URL（useSearchParams，TabBar 受控）。
5. **routes.json 重生成**：routes.ts 变更后跑 web 的 routes-json 脚本，消除 verify_web 告警。

## 不做
用户/角色后端（已自洽）；权限键目录变更。

## 验收
前端五门禁全绿（tsc/eslint/build/ui-foundation/术语 strict）；浏览器冒烟：普通 admin 可见全部操作、构造无 billing:cost 的角色验证充值/成本相关操作隐藏（mock 模式改权限或用生产模式受限账号，二选一说明）；顶栏菜单四项可用、主题选择持久化一致；全局搜索能搜到用户与角色；routes.json 告警消失；截图贴回报。commit `web(w4-e): 用户单页合并/角色门禁/顶栏用户菜单/搜索扩展/术语收口`。
