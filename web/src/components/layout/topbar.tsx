import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  KeyRound, LogOut, Monitor, Moon, PanelLeftClose, PanelLeftOpen, RefreshCw, Sun, UserRound,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { toast } from "@/lib/notify";

import { GlobalSearch } from "@/components/global-search";
import { roleLabel } from "@/components/governance/roles";
import { NotificationCenter } from "@/components/layout/notification-center";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { API_BASE_LABEL, api, ENDPOINTS } from "@/lib/api";
import { AUTH_ME_QUERY_KEY, fetchMe, logoutAdmin } from "@/lib/auth";
import { useMock } from "@/lib/mock";
import { usePermissions } from "@/lib/permissions";
import { usePreferencesSync, useSavePreferences } from "@/lib/settings-ia";
import { useTheme, type Theme } from "@/lib/theme";

interface LatestRevision {
  id: string;
  artifact_hash: string;
  status: string;
}

/** 顶栏主题三选一：与用户设置页 /settings/theme 同一份选项与同一个服务端端点。 */
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
  const prefs = usePreferencesSync();
  const savePrefs = useSavePreferences();
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

  /** 选中即写服务端偏好（与 settings.tsx 同端点）；写失败时本机 localStorage 已生效，仅提示。 */
  const onThemeChange = (next: string) => {
    const nextTheme = next as Theme;
    setTheme(nextTheme);
    savePrefs.mutate(
      { ...prefs.preferences, theme: nextTheme },
      {
        onError: (error) =>
          toast.error("主题已在本机生效，但保存到用户设置失败", { description: error.message }),
      },
    );
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

  const displayName = me.data?.name || me.data?.username || "";

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
        <GlobalSearch />
        <ThemeMenu theme={theme} onChange={onThemeChange} />
        <NotificationCenter />
        <Button variant="ghost" size="icon" title="刷新全部数据" aria-label="刷新全部数据" onClick={onRefresh}>
          <RefreshCw className="size-4" />
        </Button>
        {me.data ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="gap-1.5 px-1.5"
                title="用户菜单"
                aria-label="用户菜单"
              >
                <span
                  aria-hidden="true"
                  className="grid size-7 shrink-0 place-items-center rounded-full bg-primary-soft text-2xs font-semibold text-primary"
                >
                  {(displayName || "?").charAt(0).toUpperCase()}
                </span>
                <span className="hidden max-w-32 truncate text-2sm text-title sm:inline">{displayName}</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
              <DropdownMenuLabel className="font-normal">
                <span className="block truncate text-2sm font-medium text-title">{displayName}</span>
                <Badge tone="neutral" className="mt-1">{roleLabel(me.data.role)}</Badge>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => navigate("/settings")}>
                <UserRound />
                用户设置
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => navigate("/settings/profile")}>
                <KeyRound />
                修改密码
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem className="text-danger-text" onClick={onLogout}>
                <LogOut />
                退出登录
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </div>
    </header>
  );
}

/** 主题三选一：放在全局搜索旁（用户菜单里只留账号动作，不再重复主题入口）。 */
function ThemeMenu({ theme, onChange }: { theme: Theme; onChange: (next: string) => void }) {
  const current = THEME_OPTIONS.find((option) => option.value === theme) ?? THEME_OPTIONS[2]!;
  const CurrentIcon = current.icon;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" title={"主题：" + current.label} aria-label="切换主题">
          <CurrentIcon className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-36">
        <DropdownMenuLabel>主题</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={theme} onValueChange={onChange}>
          {THEME_OPTIONS.map((option) => (
            <DropdownMenuRadioItem key={option.value} value={option.value}>
              <option.icon className="size-4" />
              {option.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
