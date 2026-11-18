#!/usr/bin/env node
// Slipstream 路由审计：以 ops/checks/routes.json（由 web/src/routes.ts 生成）为唯一输入，
// 核对每个路由的页面文件存在、组件已导出、导航可见性、页头标题覆盖、FEATURE-PARITY 缺口。
// 路由清单变更后先跑：cd web && npm run routes:json（清单过期会给出警告）
// 用法：node ops/checks/route-audit.mjs   退出码：0 通过 / 2 有阻断缺失
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { ROUTES_FILE, loadRouteTable, matchRoute, variantsOf } from "./lib/routes.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..", "..");
const SRC = path.join(ROOT, "web", "src");
const ROUTES_TS = path.join(SRC, "routes.ts");

const blocking = [];
const warnings = [];
const info = [];

let table;
try {
  table = loadRouteTable();
} catch (error) {
  console.error("# Slipstream 路由审计");
  console.error(String((error && error.message) || error));
  process.exit(2);
}

const routes = table.routes;
const navRoutes = routes.filter((route) => Boolean(route.nav));
const navItems = navRoutes.reduce((sum, route) => sum + 1 + variantsOf(route).length, 0);
const pages = new Set(routes.map((route) => route.page));

/* 1. 页面文件存在 + 具名导出（不再从 JSX 正则猜「组件名 -> 文件」） */
for (const route of routes) {
  const file = path.join(SRC, "pages", route.page + ".tsx");
  if (!fs.existsSync(file)) {
    blocking.push("路由 " + route.path + "：页面文件 pages/" + route.page + ".tsx 不存在");
    continue;
  }
  const src = fs.readFileSync(file, "utf8");
  const exported =
    new RegExp("export\\s+(?:async\\s+)?function\\s+" + route.component + "\\b").test(src) ||
    new RegExp("export\\s+const\\s+" + route.component + "\\b").test(src);
  if (!exported) blocking.push("路由 " + route.path + "：pages/" + route.page + ".tsx 未导出 " + route.component);
  if (!route.title) blocking.push("路由 " + route.path + "：缺少 title（导航/页头/审计标签会退化）");
}

/* 2. 清单是否比 routes.ts 旧 */
if (fs.existsSync(ROUTES_TS) && fs.statSync(ROUTES_TS).mtimeMs > fs.statSync(ROUTES_FILE).mtimeMs) {
  warnings.push("routes.json 比 web/src/routes.ts 旧：先跑 cd web && npm run routes:json");
}

/* 3. 导航项都要能落到路由（侧栏可点但 404 是阻断性体验问题） */
for (const route of navRoutes) {
  const navPath = route.nav.path || route.path.replace(/\/:[^/]+$/, "");
  if (!matchRoute(routes, navPath)) warnings.push("导航项 " + navPath + " 没有对应路由（侧栏可点但会落到 404）");
  for (const variant of variantsOf(route)) {
    if (!matchRoute(routes, variant.path)) warnings.push("导航子项 " + variant.path + " 没有对应路由");
  }
}

/* 4. 归类说明：哪些路由没有侧栏入口 */
for (const route of routes) {
  if (route.path === "*") {
    info.push("通配 404 路由存在（" + route.component + "，无导航入口，符合预期）");
    continue;
  }
  if (route.path.includes(":")) {
    const variants = variantsOf(route);
    info.push(
      "动态路由 " + route.path + "（" + route.component + "）：无导航入口，符合预期" +
        (variants.length > 0 ? "；审计实例 " + variants.length + " 个" : "；审计按运行期数据补实例"),
    );
    continue;
  }
  if (!route.nav) info.push("路由 " + route.path + " 不在侧栏导航中（" + route.component + "）");
}

/* 5. 页头标题：AppShell 按导航项最长前缀匹配，动态页需要带导航的父路径兜底 */
for (const route of routes) {
  if (!route.path.includes(":") || route.nav) continue;
  const prefix = route.path.split("/:")[0];
  if (!routes.some((other) => other.path === prefix && Boolean(other.nav))) {
    warnings.push("动态路由 " + route.path + " 没有带导航的父路由 " + prefix + "，页头标题会回退为 Slipstream");
  }
}

const PARITY = [
  ["/dashboard", "数据看板（W1 t3 认领）"],
  ["/logs", "使用日志+详情抽屉（W1 t2 认领）"],
  ["/playground", "模型试验，FEATURE-PARITY 标注必须保留（W1 t6 认领）"],
  ["/roles", "RBAC 管理员（W1 t4 认领；ADR-023 改名角色管理）"],
  ["/users", "用户与余额/充值（W1 t4 认领）"],
  ["/login", "登录+ProtectedRoute（FEATURE-PARITY §1 要求保留，未见认领）"],
];
for (const [routePath, why] of PARITY) {
  if (!routes.some((route) => route.path === routePath)) warnings.push("FEATURE-PARITY 缺口：" + routePath + "（" + why + "）");
}
info.push("FEATURE-PARITY 的 /api-keys 现实现为 /client-keys（语义一致，命名与 parity 文档不一致，待定）");

console.log("# Slipstream 路由审计");
console.log(
  "路由 " + routes.length + " 条 / 页面模块 " + pages.size + " 个 / 导航 " + navItems + " 项" +
    "（来源 web/src/routes.ts -> ops/checks/routes.json）\n",
);
for (const route of routes) {
  console.log("  " + route.path.padEnd(22) + " -> pages/" + route.page + ".tsx（" + route.component + "）");
}
console.log("");
if (blocking.length) { console.log("阻断："); blocking.forEach((x) => console.log("  ✗ " + x)); }
if (warnings.length) { console.log("警告："); warnings.forEach((x) => console.log("  ▲ " + x)); }
if (info.length) { console.log("说明："); info.forEach((x) => console.log("  · " + x)); }
process.exitCode = blocking.length ? 2 : 0;
