import {
  CircleUser, FileClock, FileText,
  FlaskConical, KeyRound, Layers, LayoutDashboard, LayoutGrid, Link2, ScrollText,
  Server, Settings, ShieldCheck, SlidersHorizontal, Tags, UserCog, Users,
  type LucideIcon,
} from "lucide-react";

import { NAV_SECTION_ORDER, ROUTES, type NavIconName, type NavPlacement, type RouteDef } from "@/routes";

export interface NavItem {
  path: string;
  label: string;
  icon: LucideIcon;
  /** 需要的权限键；缺省表示登录即可见。后端仍是最终裁决者。 */
  permission?: string;
  /** 二级导航：点击父项后出现在左侧，随父项激活而展开（ticket 16）。 */
  children?: NavItem[];
}

/**
 * 侧栏导航完全从 web/src/routes.ts 派生：新增页面只改那一条清单，
 * 这里只负责把「图标名」翻译成 lucide 组件、把 RouteDef 摊平成 NavItem。
 * Record<NavIconName, LucideIcon> 保证图标名不漏不余。
 */
const NAV_ICONS: Record<NavIconName, LucideIcon> = {
  CircleUser,
  FileClock,
  FileText,
  FlaskConical,
  KeyRound,
  Layers,
  LayoutDashboard,
  LayoutGrid,
  Link2,
  ScrollText,
  Server,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  Tags,
  UserCog,
  Users,
};

const NAV_ENTRIES: Array<{ route: RouteDef; nav: NavPlacement }> = ROUTES.flatMap((route) =>
  route.nav ? [{ route, nav: route.nav }] : [],
);

function navPathOf(route: RouteDef, nav: NavPlacement): string {
  if (nav.path) return nav.path;
  // 兜底：参数化路由的导航指向父路径（/ops-settings/:section -> /ops-settings）
  return route.path.replace(/\/:[^/]+$/, "");
}

function toNavItem(route: RouteDef, nav: NavPlacement): NavItem {
  const variants = route.variants ?? [];
  const children: NavItem[] | undefined =
    variants.length > 0
      ? variants.map((variant) => {
          const child: NavItem = {
            path: variant.path,
            label: variant.title,
            icon: NAV_ICONS[variant.icon ?? nav.icon],
          };
          if (nav.permission) child.permission = nav.permission;
          return child;
        })
      : undefined;

  const item: NavItem = {
    path: navPathOf(route, nav),
    label: nav.label ?? route.title,
    icon: NAV_ICONS[nav.icon],
  };
  if (nav.permission) item.permission = nav.permission;
  if (children) item.children = children;
  return item;
}

export const NAV_SECTIONS: Array<{ title: string; items: NavItem[] }> = NAV_SECTION_ORDER.map((title) => ({
  title,
  items: NAV_ENTRIES.filter((entry) => entry.nav.section === title)
    .sort((a, b) => a.nav.order - b.nav.order)
    .map((entry) => toNavItem(entry.route, entry.nav)),
})).filter((section) => section.items.length > 0);

/** 拍平二级导航，供页头标题与面包屑按最长前缀匹配。 */
export const NAV_LEAVES: Array<{ item: NavItem; section: string; parent?: string }> = NAV_SECTIONS.flatMap(
  (section) => section.items.flatMap((item) => [
    { item, section: section.title },
    ...(item.children ?? []).map((child) => ({ item: child, section: section.title, parent: item.label })),
  ]),
);

export const PAGE_TITLES: Record<string, string> = Object.fromEntries(
  NAV_LEAVES.map(({ item }) => [item.path, item.label]),
);
