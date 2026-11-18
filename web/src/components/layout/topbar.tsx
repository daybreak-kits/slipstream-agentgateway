import { useQuery, useQueryClient } from "@tanstack/react-query";
import { LogOut, Monitor, Moon, PanelLeftClose, PanelLeftOpen, RefreshCw, Sun } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";

import { GlobalSearch } from "@/components/global-search";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { roleLabel } from "@/components/governance/roles";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { API_BASE_LABEL, api, ENDPOINTS } from "@/lib/api";
import { AUTH_ME_QUERY_KEY, fetchMe, logoutAdmin } from "@/lib/auth";
import { useMock } from "@/lib/mock";
import { usePermissions } from "@/lib/permissions";
import { useTheme, type Theme } from "@/lib/theme";

interface LatestRevision {
  id: string;
  artifact_hash: string;
  status: string;
}

const THEME_OPTIONS: Array<{ value: Theme; label: string; icon: typeof Sun }> = [
  { value: "light", label: "浅色", icon: Sun },
  { value: "dark", label: "深色", icon: Moon },
  { value: "system", label: "跟随系统", icon: Monitor },
];

interface TopbarProps {
  title: string;
  group: string;
  collapsed: boolean;
  onToggleCollapse: () => void;
}

export function Topbar({ title, group, collapsed, onToggleCollapse }: TopbarProps) {
  const { theme, setTheme } = useTheme();
  const { can } = usePermissions();
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const me = useQuery({
    queryKey: AUTH_ME_QUERY_KEY,
    queryFn: fetchMe,
    staleTime: 60_000,
  });

  const onLogout = () => {
    void logoutAdmin().then(() => {
      queryClient.clear();
      navigate("/login", { replace: true });
      toast.success("已退出登录");
    });
  };

  const latest = useQuery({
    queryKey: ["config-revisions", "latest"],
    queryFn: async () => {
      const rows = await api.get<LatestRevision[]>(ENDPOINTS.configRevisions + "?limit=1");
      return rows[0] ?? null;
    },
  });

  const onRefresh = () => {
    void queryClient.invalidateQueries().then(() => toast.success("已刷新"));
  };

  return (
    <header className="relative z-[var(--z-topbar)] flex h-16 shrink-0 items-center gap-3 border-b border-border bg-surface px-4 lg:px-6">
      <Button
        variant="ghost"
        size="icon"
        title={collapsed ? "展开侧栏" : "收起侧栏"}
        aria-label={collapsed ? "展开侧栏" : "收起侧栏"}
        onClick={onToggleCollapse}
      >
        {collapsed ? <PanelLeftOpen className="size-4" /> : <PanelLeftClose className="size-4" />}
      </Button>
      <nav aria-label="面包屑" className="flex min-w-0 items-center gap-1.5 text-2sm">
        {group ? (
          <>
            <span className="hidden text-muted-foreground sm:inline">{group}</span>
            <span aria-hidden="true" className="hidden text-faint sm:inline">/</span>
          </>
        ) : null}
        <span className="truncate font-medium text-title">{title}</span>
      </nav>
      <div className="ml-auto flex items-center gap-1.5 sm:gap-2">
        {useMock ? <Badge tone="warning">Mock 演示</Badge> : null}
        <span className="hidden text-2xs text-faint xl:inline">
          {API_BASE_LABEL.replace("https://", "").replace("http://", "")}
        </span>
        {can("config:read") ? (
          <span className="hidden items-center gap-1.5 text-2sm text-body md:flex">
          配置版本
          {latest.isPending ? (
            <Skeleton className="h-4 w-24" />
          ) : latest.data ? (
            <Badge tone="primary" className="tnum">{latest.data.id}</Badge>
          ) : (
            <Badge tone="warning">未知</Badge>
          )}
          </span>
        ) : null}
        {me.data ? (
          <span className="hidden items-center gap-1.5 text-2sm sm:flex">
            <Badge tone="neutral">{roleLabel(me.data.role)}</Badge>
            <span className="max-w-32 truncate text-title">{me.data.name || me.data.username}</span>
          </span>
        ) : null}
        <GlobalSearch />
        <Button variant="ghost" size="icon" title="退出登录" aria-label="退出登录" onClick={onLogout}>
          <LogOut className="size-4" />
        </Button>
        <Button variant="ghost" size="icon" title="刷新全部数据" aria-label="刷新全部数据" onClick={onRefresh}>
          <RefreshCw className="size-4" />
        </Button>
        <ToggleGroup
          type="single"
          value={theme}
          onValueChange={(next) => { if (next) setTheme(next as Theme); }}
          aria-label="主题"
          className="gap-0 rounded-control border border-border"
        >
          {THEME_OPTIONS.map((option) => (
            <ToggleGroupItem
              key={option.value}
              value={option.value}
              title={option.label}
              aria-label={option.label}
              className="grid h-7 w-7 place-items-center rounded-none text-faint hover:bg-surface-2 data-[state=on]:bg-primary-soft data-[state=on]:text-primary"
            >
              <option.icon className="size-3.5" />
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>
    </header>
  );
}
