import { ChevronDown } from "lucide-react";
import { NavLink, useLocation } from "react-router-dom";

import { Badge } from "@/components/ui/badge";
import { usePermissions } from "@/lib/permissions";
import { cn } from "@/lib/utils";
import { NAV_SECTIONS } from "./nav-items";

const APP_VERSION = "v0.1.0";
const ENV = (import.meta.env.VITE_APP_ENV as string | undefined) ?? "local";

/** 品牌锁：logo 36 + 两行「驭流 / Slipstream」，折叠态文字进 sr-only、用 title 兜底。 */
export function BrandLockup({ collapsed }: { collapsed: boolean }) {
  return (
    <div className={cn("flex h-16 shrink-0 items-center", collapsed ? "justify-center px-2" : "justify-between px-5")}>
      <div className={cn("flex items-center", !collapsed && "gap-2.5")}>
        <img
          src="/logo-v10-contrast.svg"
          alt=""
          aria-hidden="true"
          className="h-9 w-9 shrink-0"
          title={collapsed ? "驭流 Slipstream" : undefined}
        />
        <div className={cn("leading-tight", collapsed && "sr-only")}>
          <p className="text-sm font-semibold tracking-tight text-title">驭流</p>
          <p className="text-2xs font-medium uppercase tracking-[0.12em] text-muted-foreground">Slipstream</p>
        </div>
      </div>
    </div>
  );
}

export function Sidebar({
  collapsed,
  className,
  onNavigate,
}: {
  collapsed: boolean;
  /** 移动抽屉里用 w-full 填满抽屉，桌面仍由 w-sidebar/w-18 控制。 */
  className?: string;
  /** 移动抽屉点击导航后关闭；桌面无副作用。 */
  onNavigate?: () => void;
}) {
  const { can } = usePermissions();
  const location = useLocation();
  const visibleSections = NAV_SECTIONS.map((section) => ({
    ...section,
    items: section.items.filter((item) => item.permission === undefined || can(item.permission)),
  })).filter((section) => section.items.length > 0);

  return (
    <aside
      data-testid="app-sidebar"
      className={cn(
        "flex h-full min-w-0 shrink-0 flex-col border-r border-border bg-surface transition-[width] duration-200",
        collapsed ? "w-18" : "w-sidebar",
        className,
      )}
    >
      <BrandLockup collapsed={collapsed} />
      <nav aria-label="主导航" className={cn("flex-1 overflow-y-auto", collapsed ? "px-2" : "px-3")}>
        {visibleSections.map((section) => (
          <div key={section.title} className="mt-4 first:mt-1">
            <div
              className={cn(
                "px-3 pb-1.5 text-2xs font-semibold uppercase tracking-[0.1em] text-muted-foreground",
                collapsed && "sr-only",
              )}
            >
              {section.title}
            </div>
            <ul className="space-y-0.5">
              {section.items.map((item) => {
                // 二级导航：父项被激活（点击运营设置）后，子项在左侧展开。
                const children = (item.children ?? []).filter(
                  (child) => child.permission === undefined || can(child.permission),
                );
                const expanded =
                  !collapsed && children.length > 0 &&
                  (location.pathname === item.path || location.pathname.startsWith(item.path + "/"));
                const target = children[0]?.path ?? item.path;
                return (
                  <li key={item.path}>
                    <NavLink
                      to={target}
                      end={target === "/"}
                      title={item.label}
                      onClick={onNavigate}
                      className={({ isActive }) =>
                        cn(
                          "relative flex items-center rounded-control py-2 text-2sm transition-colors",
                          collapsed ? "justify-center px-0" : "gap-2.5 px-2.5",
                          isActive
                            ? "bg-primary-soft font-medium text-primary"
                            : "text-body hover:bg-surface-2 hover:text-title",
                        )
                      }
                    >
                      {({ isActive }) => (
                        <>
                          <span
                            className={cn(
                              "grid h-7 w-7 shrink-0 place-items-center rounded-md",
                              isActive ? "bg-surface text-primary shadow-xs" : "bg-surface-2 text-muted-foreground",
                            )}
                          >
                            <item.icon className="size-4" strokeWidth={1.75} />
                          </span>
                          <span className={cn("truncate", collapsed && "sr-only")}>{item.label}</span>
                          {children.length > 0 && !collapsed ? (
                            <ChevronDown
                              aria-hidden="true"
                              className={cn(
                                "ml-auto size-3.5 shrink-0 text-faint transition-transform",
                                expanded && "rotate-180",
                              )}
                            />
                          ) : null}
                          {isActive && !collapsed ? (
                            <span
                              aria-hidden="true"
                              className="absolute top-1/2 -left-3 h-4 w-0.5 -translate-y-1/2 rounded-r-full bg-primary"
                            />
                          ) : null}
                        </>
                      )}
                    </NavLink>
                    {expanded ? (
                      <ul className="mt-0.5 ml-7 space-y-0.5 border-l border-border pl-2">
                        {children.map((child) => (
                          <li key={child.path}>
                            <NavLink
                              to={child.path}
                              title={child.label}
                              onClick={onNavigate}
                              className={({ isActive }) =>
                                cn(
                                  "block truncate rounded-control px-2 py-1 text-2xs transition-colors",
                                  isActive
                                    ? "bg-primary-soft font-medium text-primary"
                                    : "text-body hover:bg-surface-2 hover:text-title",
                                )
                              }
                            >
                              {child.label}
                            </NavLink>
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>
      <div
        className={cn(
          "flex items-center border-t border-border px-4 py-3",
          collapsed ? "justify-center" : "justify-between gap-2",
        )}
      >
        <span className={cn("font-mono text-2xs text-faint", collapsed && "sr-only")}>{APP_VERSION}</span>
        <Badge tone="success" className="gap-1">
          <span className={cn("h-1.5 w-1.5 rounded-full bg-success", collapsed && "sr-only")} />
          {collapsed ? null : ENV}
        </Badge>
      </div>
    </aside>
  );
}
