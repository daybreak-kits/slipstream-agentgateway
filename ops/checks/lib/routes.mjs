/**
 * ops/checks：读 web/src/routes.ts 生成的 routes.json（唯一页面清单的只读导出）。
 *
 * route-audit.mjs 用它核对页面文件/导出/导航；interaction_audit.mjs 用它派生
 * 逐页审计清单——路径不再手抄，新增页面只改 web/src/routes.ts 一处。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** 生成位置：ops/checks/routes.json（由 cd web && npm run routes:json 写入）。 */
export const ROUTES_FILE = path.resolve(HERE, "..", "routes.json");

/**
 * 读并校验页面清单。
 * @param {string} [file]
 * @returns {{ version: number, source: string, sections: string[], routes: Array<Record<string, any>> }}
 */
export function loadRouteTable(file = ROUTES_FILE) {
  let raw;
  try {
    raw = fs.readFileSync(file, "utf8");
  } catch {
    throw new Error(
      "未找到页面清单 " + file + "：先跑 cd web && npm run routes:json（从 web/src/routes.ts 生成）",
    );
  }
  let table;
  try {
    table = JSON.parse(raw);
  } catch (error) {
    throw new Error("页面清单 " + file + " 不是合法 JSON：" + String((error && error.message) || error));
  }
  if (!table || !Array.isArray(table.routes)) {
    throw new Error("页面清单 " + file + " 缺少 routes 数组：重新跑 cd web && npm run routes:json");
  }
  return table;
}

/** 兼容传 table 或传 routes 数组。 */
function routeList(table) {
  return Array.isArray(table) ? table : table.routes;
}

export function variantsOf(route) {
  return Array.isArray(route.variants) ? route.variants : [];
}

/** 参数化路由实例的标题：默认「父 title·实例 title」；父标题与实例相同时只留一个。 */
export function variantLabel(route, variant) {
  if (route.auditLabel) return route.auditLabel;
  if (!variant.title || variant.title === route.title) return variant.title || route.title;
  return route.title + "·" + variant.title;
}

/**
 * 交互审计的页面清单：静态路由 + 参数化路由的可枚举实例，顺序与 routes.ts 一致。
 * 没有 variants 的参数化路由（/upstreams/:id）由脚本按运行期数据补进去。
 * @returns {Array<[string, string]>} [path, label]
 */
export function auditPages(table) {
  const pages = [];
  for (const route of routeList(table)) {
    if (route.audit === false) continue;
    const variants = variantsOf(route);
    if (variants.length > 0) {
      for (const variant of variants) pages.push([variant.path, variantLabel(route, variant)]);
      continue;
    }
    if (route.path === "*" || route.path.includes(":")) continue;
    pages.push([route.path, route.auditLabel || route.title]);
  }
  return pages;
}

/** 按 path 查路由（先精确、再参数化匹配），返回 RouteDef 或 null。 */
export function matchRoute(table, pathname) {
  const routes = routeList(table);
  const exact = routes.find((route) => route.path === pathname);
  if (exact) return exact;
  const parts = String(pathname).split("/");
  return (
    routes.find((route) => {
      if (!route.path.includes(":")) return false;
      const segments = route.path.split("/");
      if (segments.length !== parts.length) return false;
      return segments.every((segment, i) => segment.startsWith(":") || segment === parts[i]);
    }) || null
  );
}

/** 路径对应的页面标题（动态路径靠模板匹配），用于运行期补进来的审计页面。 */
export function labelForPath(table, pathname) {
  const route = matchRoute(table, pathname);
  return route ? route.title : pathname;
}

/** 所有导航项（含参数化路由的二级项），用于核对「导航都能落到路由」。 */
export function navEntries(table) {
  return routeList(table).filter((route) => Boolean(route.nav));
}
