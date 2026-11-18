import { lazy, Suspense, type ComponentType, type LazyExoticComponent } from "react";
import { Route, Routes } from "react-router-dom";

import { ProtectedRoute } from "./components/auth/protected-route";
import { RequirePermission } from "./components/auth/require-permission";
import { AppShell } from "./components/layout/app-shell";
import { RouteFallback } from "./components/route-fallback";
import { ROUTES, type PageModule, type RouteDef } from "./routes";

/**
 * 路径 / 权限 / 标题 / 侧栏全部来自 web/src/routes.ts（唯一页面清单）；
 * 这里只放「页面模块 -> 具名导出」的懒加载器，页面仍按路由单独成 chunk
 * （见 scripts/check-bundle.mjs，首包不下载非当前路由的页面）。
 *
 * PAGE_MODULES 的键受 PageModule 联合类型约束：routes.ts 新增页面而这里漏加
 * loader 会直接 tsc 报错。
 */
type PageComponent = ComponentType<Record<string, string>>;

const PAGE_MODULES = {
  login: lazy(() => import("./pages/login").then((m) => ({ default: m.LoginPage }))),
  "not-found": lazy(() => import("./pages/not-found").then((m) => ({ default: m.NotFoundPage }))),
  "quick-start": lazy(() => import("./pages/quick-start").then((m) => ({ default: m.OverviewPage }))),
  dashboard: lazy(() => import("./pages/dashboard").then((m) => ({ default: m.DashboardPage }))),
  logs: lazy(() => import("./pages/logs").then((m) => ({ default: m.LogsPage }))),
  playground: lazy(() => import("./pages/playground").then((m) => ({ default: m.PlaygroundPage }))),
  models: lazy(() => import("./pages/models").then((m) => ({ default: m.ModelsPage }))),
  pricing: lazy(() => import("./pages/pricing").then((m) => ({ default: m.PricingPage }))),
  pricing_redirect: lazy(() => import("./pages/pricing_redirect").then((m) => ({ default: m.PricingRedirect }))),
  upstreams: lazy(() => import("./pages/upstreams").then((m) => ({ default: m.UpstreamsPage }))),
  upstream_detail: lazy(() =>
    import("./pages/upstream_detail").then((m) => ({ default: m.UpstreamDetailPage })),
  ),
  client_keys: lazy(() => import("./pages/client_keys").then((m) => ({ default: m.ClientKeysPage }))),
  config_revisions: lazy(() =>
    import("./pages/config_revisions").then((m) => ({ default: m.ConfigRevisionsPage })),
  ),
  audits: lazy(() => import("./pages/audits").then((m) => ({ default: m.AuditLogsPage }))),
  "gateway-policies": lazy(() =>
    import("./pages/gateway-policies").then((m) => ({ default: m.GatewayPoliciesPage })),
  ),
  roles: lazy(() => import("./pages/roles").then((m) => ({ default: m.AdminsPage }))),
  users: lazy(() => import("./pages/users").then((m) => ({ default: m.UsersPage }))),
  settings: lazy(() => import("./pages/settings").then((m) => ({ default: m.SettingsPage }))),
  ops_settings: lazy(() => import("./pages/ops_settings").then((m) => ({ default: m.OpsSettingsPage }))),
} as unknown as Record<PageModule, LazyExoticComponent<PageComponent>>;

/** 渲染单条路由：需要时套 RequirePermission（权限键来自清单，不再散落在 JSX 里）。 */
function renderRoute(route: RouteDef) {
  const Page = PAGE_MODULES[route.page];
  const element = <Page {...route.props} />;
  return route.permission ? <RequirePermission permission={route.permission}>{element}</RequirePermission> : element;
}

export function App() {
  return (
    <Suspense fallback={<RouteFallback />}>
      <Routes>
        {ROUTES.filter((route) => route.layout === "public").map((route) => (
          <Route key={route.path} path={route.path} element={renderRoute(route)} />
        ))}
        <Route element={<ProtectedRoute />}>
          <Route element={<AppShell />}>
            {ROUTES.filter((route) => route.layout === "app").map((route) => (
              <Route key={route.path} path={route.path} element={renderRoute(route)} />
            ))}
          </Route>
        </Route>
      </Routes>
    </Suspense>
  );
}
