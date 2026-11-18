import { Navigate } from "react-router-dom";

/**
 * 旧入口统一重定向：默认 /pricing（/upstream-prices、/downstream-prices，ticket 06）；
 * 也可由路由清单传 to 指向其他页（ADR-023：/admins→/roles、/policies /guardrails /mcp→网关策略对应 Tab）。
 */
export function PricingRedirect({ to = "/pricing" }: { to?: string }) {
  return <Navigate to={to} replace />;
}
