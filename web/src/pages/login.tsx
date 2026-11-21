import { useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { Eye, EyeOff, Monitor, Moon, Sun } from "lucide-react";
import { toast } from "@/lib/notify";
import { pushErrorNotificationOnce } from "@/lib/notification-store";
import { useTheme, type Theme } from "@/lib/theme";

import { RequestChain } from "@/components/layout/request-chain";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AUTH_ME_QUERY_KEY, fetchMe, loginAdmin } from "@/lib/auth";
import { cn } from "@/lib/utils";

/** 只接受站内绝对路径，避免 ?next=//evil 造成开放重定向。 */
function safeNext(search: string): string {
  const raw = new URLSearchParams(search).get("next") ?? "/";
  return raw.startsWith("/") && !raw.startsWith("//") ? raw : "/";
}

/** 底部提示固定文案：预留固定高度单行省略，hover 用 title 看全文（user story 53）。 */
const LOGIN_HINT = "会话有效期 12 小时，退出登录后立即失效。遇到问题请联系管理员或查阅部署文档。";

/**
 * 登录页三态主题：与顶栏 / 用户设置共用同一份 useTheme 状态与持久化
 * （全站主题 key，反闪烁脚本同源），不另起存储（user story 51）。
 */
const THEME_OPTIONS: Array<{ value: Theme; label: string; icon: typeof Sun }> = [
  { value: "light", label: "浅色", icon: Sun },
  { value: "dark", label: "深色", icon: Moon },
  { value: "system", label: "跟随系统", icon: Monitor },
];

function ThemeSwitcher() {
  const { theme, setTheme } = useTheme();
  return (
    <div
      data-slot="login-theme"
      role="group"
      aria-label="主题"
      className="absolute right-4 top-4 z-10 flex items-center gap-1 rounded-control border border-border bg-surface/85 p-1 shadow-card backdrop-blur-sm sm:right-6 sm:top-6"
    >
      {THEME_OPTIONS.map(({ value, label, icon: Icon }) => (
        <button
          key={value}
          type="button"
          aria-label={label}
          aria-pressed={theme === value}
          title={label}
          onClick={() => setTheme(value)}
          className={cn(
            "flex h-8 w-8 items-center justify-center rounded-control transition-colors",
            theme === value
              ? "bg-primary-soft text-primary"
              : "text-muted-foreground hover:bg-surface-2 hover:text-title",
          )}
        >
          <Icon aria-hidden="true" className="size-4" />
        </button>
      ))}
    </div>
  );
}

/**
 * 登录页（unslop pass 6/8）：左侧品牌 + 请求链路母题，右侧唯一的入口卡片；
 * 控制台类产品不靠插画，靠「一张链路图」说明自己是什么。
 *
 * W6 票12：低对比浅色渐变背景（静态不动画）、三态主题、密码显隐、错误只标红字段
 * 且详情进通知中心、错误区固定预留高度（按钮零位移）、底部提示预留省略、
 * 登录框三档宽度 384/460/576（1x/1.2x/1.5x，user story 32）。
 */
export function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const next = safeNext(location.search);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);

  const me = useQuery({
    queryKey: AUTH_ME_QUERY_KEY,
    queryFn: fetchMe,
    retry: false,
    staleTime: 30_000,
  });

  if (me.data) return <Navigate to={next} replace />;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    const outcome = await loginAdmin(username.trim(), password);
    setBusy(false);
    if (outcome.kind === "error") {
      setError(outcome.message);
      // 详情进通知中心（票07 去重）：页面内只标红字段 + 固定错误区，不插推挤块（user story 49）。
      pushErrorNotificationOnce({
        title: "登录失败",
        description: outcome.message,
        dedupeKey: "login|" + outcome.message,
      });
      return;
    }
    queryClient.setQueryData(AUTH_ME_QUERY_KEY, outcome.user);
    toast.success("登录成功");
    navigate(next, { replace: true });
  }

  return (
    <div className="login-gradient relative flex min-h-full flex-col p-4 sm:p-6">
      <ThemeSwitcher />
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 bg-blueprint opacity-50" />
      <div className="relative mx-auto my-auto grid w-full max-w-5xl items-center gap-10 lg:grid-cols-[1.05fr_0.95fr] lg:gap-14 2xl:max-w-[1240px] 2xl:grid-cols-[1fr_36rem]">
        <section className="hidden lg:block">
          <div className="flex items-center gap-3">
            <img src="/logo-v10-contrast.svg" alt="" aria-hidden="true" className="h-10 w-10 shrink-0" />
            <div className="leading-tight">
              <p className="text-sm font-semibold tracking-tight text-title">驭流</p>
              <p className="text-2xs font-medium uppercase tracking-[0.12em] text-muted-foreground">Slipstream</p>
            </div>
          </div>
          <p className="mt-12 text-2xs font-medium uppercase tracking-[0.12em] text-faint">模型接口网关</p>
          <p className="mt-3 max-w-lg text-3xl font-semibold tracking-tight text-title">
            把每一次调用，
            <br />
            送进正确的通道。
          </p>
          <p className="mt-4 max-w-md text-sm text-faint">
            三层寻址、请求内重试与健康驱逐、双账本计费：一个控制面管住从入口到上游的每一步。
          </p>
          <RequestChain className="mt-8 max-w-xl" />
          <p className="mt-10 font-mono text-2xs text-faint">SLIPSTREAM · 控制面 :3700 · 数据面 :3600</p>
        </section>

        {/* 登录框三档：基础 384 / md 460 / 2xl 576；m-auto 让矮视口顶对齐、高视口垂直居中。
            min-w-0 允许栅格轨道收缩到视口内（提示行 nowrap 的 min-content 不得撑破窄屏）。 */}
        <section className="mx-auto w-full min-w-0 max-w-[384px] md:max-w-[460px] 2xl:max-w-[576px] lg:mx-0">
          <div className="login-landscape-hide mb-6 flex items-center gap-3 lg:hidden">
            <img src="/logo-v10-contrast.svg" alt="" aria-hidden="true" className="h-10 w-10 shrink-0" />
            <div className="leading-tight">
              <p className="text-sm font-semibold tracking-tight text-title">驭流</p>
              <p className="text-2xs font-medium uppercase tracking-[0.12em] text-muted-foreground">Slipstream</p>
            </div>
          </div>
          <p className="login-landscape-hide mb-3 text-2xs text-faint lg:hidden">大模型请求路由控制台</p>
          <form onSubmit={submit}>
            <Card data-slot="login-card" className="p-6 shadow-pop">
              <h1 className="text-h1 font-semibold tracking-tight text-title">登录</h1>
              <p className="mt-1 text-sm text-faint">使用管理用户账号进入控制台。</p>
              <div className="mt-5 space-y-3">
                <div className="space-y-1">
                  <Label htmlFor="login-username">用户名</Label>
                  <Input
                    id="login-username"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    autoComplete="username"
                    autoFocus
                    aria-invalid={Boolean(error)}
                    className={error ? "border-danger focus-visible:border-danger" : undefined}
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="login-password">密码</Label>
                  <div className="relative">
                    <Input
                      id="login-password"
                      type={showPassword ? "text" : "password"}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      autoComplete="current-password"
                      aria-invalid={Boolean(error)}
                      className={cn("pr-11", error && "border-danger focus-visible:border-danger")}
                    />
                    <button
                      type="button"
                      data-slot="login-password-toggle"
                      aria-label={showPassword ? "隐藏密码" : "显示密码"}
                      aria-pressed={showPassword}
                      title={showPassword ? "隐藏密码" : "显示密码"}
                      onClick={() => setShowPassword((v) => !v)}
                      className="absolute inset-y-0 right-0 flex w-11 items-center justify-center text-muted-foreground transition-colors hover:text-title"
                    >
                      {showPassword ? (
                        <EyeOff aria-hidden="true" className="size-4" />
                      ) : (
                        <Eye aria-hidden="true" className="size-4" />
                      )}
                    </button>
                  </div>
                </div>
                {/* 错误区固定预留 h-10：错误出现时按钮零位移（user story 50）；详情在通知中心可回看。 */}
                <div data-slot="login-error" aria-live="polite" className="h-10 overflow-hidden">
                  {error ? <p className="line-clamp-2 text-sm text-danger-text">{error}</p> : null}
                </div>
                <Button
                  type="submit"
                  className="w-full"
                  disabled={busy || username.trim() === "" || password === ""}
                >
                  {busy ? "登录中…" : "登录"}
                </Button>
              </div>
            </Card>
          </form>
          <p data-slot="login-hint" title={LOGIN_HINT} className="mt-4 h-5 truncate text-center text-2xs text-faint">
            {LOGIN_HINT}
          </p>
        </section>
      </div>
    </div>
  );
}
