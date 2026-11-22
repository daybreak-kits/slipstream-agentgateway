/**
 * Slipstream 管理台唯一页面清单（唯一事实来源）。
 *
 * 三处消费同一张表：
 *   1. web/src/app.tsx                       —— <Route> 的 path / 权限守卫 / 页面组件
 *   2. components/layout/nav-items.ts        —— 侧栏分组、图标、可见权限、页头标题
 *   3. ops/checks/routes.json（npm run routes:json）—— route-audit 与 interaction_audit
 *      读它，不再从 JSX 正则抠路由、也不再手抄审计路径
 *
 * 因此本文件只放「数据」：不 import React / 图标 / 页面模块，保证 Node 侧能直接
 * 把它转成 JSON。组件映射在 app.tsx（PAGE_MODULES），图标映射在 nav-items.ts
 * （NAV_ICONS），两边的键都取自这里的类型，写错会被 tsc 挡住。
 *
 * 新增页面 = 这里加一条 + app.tsx 的 PAGE_MODULES 加一个 loader（tsc 强制）+ nav-items 无需改。
 */

/** 侧栏图标名（nav-items.ts 的 NAV_ICONS 必须几何级覆盖）。 */
export type NavIconName =
  | "CircleUser"
  | "FileClock"
  | "FileText"
  | "FlaskConical"
  | "KeyRound"
  | "Layers"
  | "LayoutDashboard"
  | "LayoutGrid"
  | "Link2"
  | "ScrollText"
  | "Server"
  | "Settings"
  | "ShieldCheck"
  | "SlidersHorizontal"
  | "Tags"
  | "UserCog"
  | "Users";

/** web/src/pages/<page>.tsx 的模块名（app.tsx 的 PAGE_MODULES 必须全覆盖）。 */
export type PageModule =
  | "login"
  | "not-found"
  | "quick-start"
  | "dashboard"
  | "logs"
  | "playground"
  | "models"
  | "pricing"
  | "pricing_redirect"
  | "upstreams"
  | "upstream_detail"
  | "client_keys"
  | "config_revisions"
  | "audits"
  | "gateway-policies"
  | "roles"
  | "users"
  | "settings"
  | "ops_settings";

/** 参数化路由的可枚举实例：导航二级项、审计路径、标题都从这里来。 */
export interface RouteVariant {
  /** 实例路径，如 /settings/:section 的 /settings/profile */
  path: string;
  /** 实例标题：导航子项用它；审计标签用「父 title·实例 title」 */
  title: string;
  /** 二级导航图标（只有作为导航子项时才需要） */
  icon?: NavIconName;
}

/** 侧栏位置。可见权限与路由守卫是两件事：/ 的路由不设守卫，导航却要求 reports:read。 */
export interface NavPlacement {
  /** 分组标题，顺序见 NAV_SECTION_ORDER */
  section: string;
  icon: NavIconName;
  /** 导航文案，缺省用 route.title */
  label?: string;
  /** 导航指向的路径；参数化路由（/ops-settings/:section）指向父路径 /ops-settings */
  path?: string;
  /** 侧栏可见所需权限；缺省表示登录即可见 */
  permission?: string;
  /** 同组内排序（升序） */
  order: number;
}

export interface RouteDef {
  path: string;
  /** public：未登录可访问（登录页）；app：ProtectedRoute + AppShell 内 */
  layout: "public" | "app";
  /** web/src/pages/<page>.tsx */
  page: PageModule;
  /** 该模块的具名导出；app.tsx 的 loader 与 route-audit 都用它核对 */
  component: string;
  /** 固定 props（旧入口重定向页的 section） */
  props?: Record<string, string>;
  /** 路由级权限守卫（RequirePermission）；缺省不守，后端仍是最终裁决者 */
  permission?: string;
  /** 页面标题：导航文案 / 页头 / 审计标签的默认值 */
  title: string;
  nav?: NavPlacement;
  variants?: RouteVariant[];
  /** 审计报告里的自定义名称（默认 title，或「title·variant.title」） */
  auditLabel?: string;
  /** 交互审计不遍历（登录页由 auditLogin 单独覆盖） */
  audit?: false;
  note?: string;
}

/** 侧栏分组顺序（与设计稿的四组一致）。 */
export const NAV_SECTION_ORDER: string[] = ["常规", "配置", "工具", "系统"];

/**
 * 顺序 = 管理台的「页面盘点顺序」：主要页面 -> 二级实参 -> 旧入口重定向 -> 404。
 * app.tsx 直接按这个顺序声明路由（React Router 7 按结构打分，声明顺序不影响匹配）。
 * 交互审计的页面清单也从这里派生，所以这里的顺序就是报告里的顺序。
 */
export const ROUTES: RouteDef[] = [
  {
    path: "/login",
    layout: "public",
    page: "login",
    component: "LoginPage",
    title: "登录",
    audit: false,
    note: "未登录可访问；交互审计由 auditLogin 单独覆盖",
  },
  {
    path: "/",
    layout: "app",
    page: "quick-start",
    component: "OverviewPage",
    title: "快速上手",
    nav: { section: "常规", icon: "LayoutGrid", order: 1, permission: "reports:read" },
    note: "ADR-023：全局概览改名快速上手，页面类型「上手指引」；页面内容重写归 F2 工位",
  },
  {
    path: "/dashboard",
    layout: "app",
    page: "dashboard",
    component: "DashboardPage",
    title: "数据看板",
    nav: { section: "常规", icon: "LayoutDashboard", order: 2, permission: "reports:read" },
  },
  {
    path: "/logs",
    layout: "app",
    page: "logs",
    component: "LogsPage",
    title: "使用日志",
    permission: "logs:read",
    nav: { section: "常规", icon: "ScrollText", order: 3, permission: "logs:read" },
  },
  {
    path: "/upstreams",
    layout: "app",
    page: "upstreams",
    component: "UpstreamsPage",
    title: "上游渠道",
    nav: { section: "配置", icon: "Server", order: 1, permission: "upstreams:read" },
    note: "ADR-023 术语：上游管理 → 上游渠道",
  },
  {
    path: "/upstreams/:id",
    layout: "app",
    page: "upstream_detail",
    component: "UpstreamDetailPage",
    title: "上游详情",
    permission: "upstreams:read",
  },
  {
    path: "/models",
    layout: "app",
    page: "models",
    component: "ModelsPage",
    title: "模型管理",
    permission: "upstream_models:read",
    nav: { section: "配置", icon: "Layers", order: 2, permission: "upstream_models:read" },
    note: "ticket 10：上游模型 / 公开模型两个 Tab",
  },
  {
    path: "/models/public/:id",
    layout: "app",
    page: "models",
    component: "ModelsPage",
    title: "编辑公开模型",
    permission: "public_models:write",
    note: "W4-C：公开模型整页编辑器（编辑+成员合并入口，ADR-025）；PAGE_MODULES 按页面文件懒加载，ModelsPage 内按路径分流",
  },
  {
    path: "/pricing",
    layout: "app",
    page: "pricing",
    component: "PricingPage",
    title: "价目管理",
    permission: "prices:read",
    nav: { section: "配置", icon: "Tags", order: 3, permission: "prices:read" },
  },
  {
    path: "/playground",
    layout: "app",
    page: "playground",
    component: "PlaygroundPage",
    title: "模型试验",
    permission: "playground:use",
    nav: { section: "工具", icon: "FlaskConical", order: 1, permission: "playground:use" },
  },
  {
    path: "/client-keys",
    layout: "app",
    page: "client_keys",
    component: "ClientKeysPage",
    title: "连接密钥",
    permission: "apikeys:read",
    nav: { section: "系统", icon: "KeyRound", order: 1, permission: "apikeys:read" },
  },
  {
    path: "/users",
    layout: "app",
    page: "users",
    component: "UsersPage",
    title: "用户管理",
    permission: "users:read",
    nav: { section: "系统", icon: "Users", order: 2, permission: "users:read" },
  },
  {
    path: "/roles",
    layout: "app",
    page: "roles",
    component: "AdminsPage",
    title: "角色管理",
    permission: "admins:read",
    nav: { section: "系统", icon: "UserCog", order: 3, permission: "admins:read" },
    note: "ADR-023：管理用户页改角色管理（角色+权限矩阵）；权限键沿用 admins:read；页面内容重写归 F5 工位",
  },
  {
    path: "/gateway-policies",
    layout: "app",
    page: "gateway-policies",
    component: "GatewayPoliciesPage",
    title: "网关策略",
    permission: "policies:read",
    nav: { section: "系统", icon: "ShieldCheck", order: 4, permission: "policies:read" },
    note: "ADR-023：策略/护栏/MCP 合并单页三 Tab（?tab=policies|guardrails|mcp）；F6 已按三 Tab 正式实现（validate→保存→apply→版本留档），临时壳已替换",
  },
  {
    path: "/audits",
    layout: "app",
    page: "audits",
    component: "AuditLogsPage",
    title: "审计日志",
    nav: { section: "系统", icon: "ScrollText", order: 5, permission: "audits:read" },
  },
  {
    path: "/config-revisions",
    layout: "app",
    page: "config_revisions",
    component: "ConfigRevisionsPage",
    title: "配置版本",
    permission: "config:read",
    nav: { section: "系统", icon: "FileClock", order: 6, permission: "config:read" },
  },
  {
    path: "/settings/:section",
    layout: "app",
    page: "settings",
    component: "SettingsPage",
    title: "用户设置",
    variants: [
      { path: "/settings/profile", title: "个人资料" },
      { path: "/settings/theme", title: "主题" },
      { path: "/settings/tokens", title: "连接密钥" },
      { path: "/settings/spend", title: "我的花费" },
      { path: "/settings/notifications", title: "通知偏好" },
    ],
  },
  {
    path: "/ops-settings/:section",
    layout: "app",
    page: "ops_settings",
    component: "OpsSettingsPage",
    title: "运营设置",
    permission: "settings:read",
    nav: {
      section: "系统",
      icon: "Settings",
      order: 8,
      path: "/ops-settings",
      permission: "settings:read",
    },
    note: "ticket 16：页面内子导航；侧栏不重复挂二级项（2026-11-20 全站修复）",
  },
  {
    path: "/settings",
    layout: "app",
    page: "settings",
    component: "SettingsPage",
    title: "用户设置",
    nav: { section: "系统", icon: "CircleUser", order: 7 },
    auditLabel: "旧设置入口重定向",
  },
  {
    path: "/ops-settings",
    layout: "app",
    page: "ops_settings",
    component: "OpsSettingsPage",
    title: "运营设置",
    permission: "settings:read",
    auditLabel: "旧运营设置入口重定向",
  },
  {
    path: "/upstream-prices",
    layout: "app",
    page: "pricing_redirect",
    component: "PricingRedirect",
    title: "旧价目入口重定向",
  },
  {
    path: "/downstream-prices",
    layout: "app",
    page: "pricing_redirect",
    component: "PricingRedirect",
    title: "旧对外价目入口重定向",
  },
  {
    path: "/admins",
    layout: "app",
    page: "pricing_redirect",
    component: "PricingRedirect",
    props: { to: "/roles" },
    title: "旧账号入口重定向",
    note: "ADR-023：/admins → /roles 过渡重定向",
  },
  {
    path: "/policies",
    layout: "app",
    page: "pricing_redirect",
    component: "PricingRedirect",
    props: { to: "/gateway-policies?tab=policies" },
    title: "旧策略入口重定向",
    note: "ADR-023：/policies → /gateway-policies?tab=policies",
  },
  {
    path: "/guardrails",
    layout: "app",
    page: "pricing_redirect",
    component: "PricingRedirect",
    props: { to: "/gateway-policies?tab=guardrails" },
    title: "旧护栏入口重定向",
    note: "ADR-023：/guardrails → /gateway-policies?tab=guardrails",
  },
  {
    path: "/mcp",
    layout: "app",
    page: "pricing_redirect",
    component: "PricingRedirect",
    props: { to: "/gateway-policies?tab=mcp" },
    title: "旧 MCP 入口重定向",
    note: "ADR-023：/mcp → /gateway-policies?tab=mcp",
  },
  {
    path: "*",
    layout: "app",
    page: "not-found",
    component: "NotFoundPage",
    title: "404",
    variants: [{ path: "/not-exists-audit", title: "404" }],
    note: "通配 404：无导航入口；审计用 /not-exists-audit 实例覆盖",
  },
];
