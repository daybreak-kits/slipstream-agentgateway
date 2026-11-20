import { Suspense, useEffect, useState } from "react";
import { Outlet, useLocation } from "react-router-dom";

import { ErrorBoundary } from "@/components/error-boundary";
import { RouteFallback } from "@/components/route-fallback";
import { Sidebar } from "./sidebar";
import { Topbar } from "./topbar";
import { NAV_LEAVES } from "./nav-items";

const COLLAPSE_KEY = "slipstream.sidebar_collapsed";

export function AppShell() {
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem(COLLAPSE_KEY) === "1");
  const location = useLocation();

  useEffect(() => {
    localStorage.setItem(COLLAPSE_KEY, collapsed ? "1" : "0");
  }, [collapsed]);

  // 前缀匹配：/upstreams/:id 等动态路由也能命中标题与分组（最长前缀优先）。
  // 二级导航项的面包屑上级用父项名（运营设置 / 连接地址），一级项用导航分组。
  const match = NAV_LEAVES
    .map(({ item, section, parent }) => ({ ...item, group: parent ?? section }))
    .filter((item) => location.pathname === item.path || location.pathname.startsWith(item.path + "/"))
    .sort((a, b) => b.path.length - a.path.length)[0];

  return (
    <div className="flex h-full overflow-hidden bg-bg">
      <Sidebar collapsed={collapsed} />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar
          title={match?.label ?? "Slipstream"}
          group={match?.group ?? ""}
          collapsed={collapsed}
          onToggleCollapse={() => setCollapsed((value) => !value)}
        />
        <main className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-480 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
            <ErrorBoundary>
              <Suspense fallback={<RouteFallback />}>
                <div key={location.pathname} className="animate-fade-up">
                  <Outlet />
                </div>
              </Suspense>
            </ErrorBoundary>
          </div>
        </main>
      </div>
    </div>
  );
}
