import { useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { toast } from "@/lib/notify";

import { RequestChain } from "@/components/layout/request-chain";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AUTH_ME_QUERY_KEY, fetchMe, loginAdmin } from "@/lib/auth";

/** 只接受站内绝对路径，避免 ?next=//evil 造成开放重定向。 */
function safeNext(search: string): string {
  const raw = new URLSearchParams(search).get("next") ?? "/";
  return raw.startsWith("/") && !raw.startsWith("//") ? raw : "/";
}

/**
 * 登录页（unslop pass 6/8）：左侧品牌 + 请求链路母题，右侧唯一的入口卡片；
 * 控制台类产品不靠插画，靠「一张链路图」说明自己是什么。
 */
export function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const next = safeNext(location.search);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
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
      return;
    }
    queryClient.setQueryData(AUTH_ME_QUERY_KEY, outcome.user);
    toast.success("登录成功");
    navigate(next, { replace: true });
  }

  return (
    <div className="relative flex min-h-full items-center justify-center overflow-hidden bg-surface-2 p-6">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 bg-blueprint opacity-70" />
      <div className="relative grid w-full max-w-5xl items-center gap-10 lg:grid-cols-[1.05fr_0.95fr] lg:gap-14">
        <section className="hidden lg:block">
          <div className="flex items-center gap-3">
            <img src="/logo-v10-contrast.svg" alt="" aria-hidden="true" className="h-10 w-10 shrink-0" />
            <div className="leading-tight">
              <p className="text-sm font-semibold tracking-tight text-title">驭流</p>
              <p className="text-2xs font-medium uppercase tracking-[0.12em] text-muted-foreground">Slipstream</p>
            </div>
          </div>
          <p className="mt-12 text-2xs font-medium uppercase tracking-[0.12em] text-faint">LLM API GATEWAY</p>
          <p className="mt-3 max-w-lg text-3xl font-semibold tracking-tight text-title">
            把每一次调用，
            <br />
            送进正确的通道。
          </p>
          <p className="mt-4 max-w-md text-sm text-faint">
            三层寻址、请求内重试与健康驱逐、双账本计费——一个控制面管住从入口到上游的每一步。
          </p>
          <RequestChain className="mt-8 max-w-xl" />
          <p className="mt-10 font-mono text-2xs text-faint">SLIPSTREAM · 控制面 :3700 · 数据面 :3600</p>
        </section>

        <section className="mx-auto w-full max-w-sm lg:mx-0">
          <div className="mb-6 flex items-center gap-3 lg:hidden">
            <img src="/logo-v10-contrast.svg" alt="" aria-hidden="true" className="h-10 w-10 shrink-0" />
            <div className="leading-tight">
              <p className="text-sm font-semibold tracking-tight text-title">驭流</p>
              <p className="text-2xs font-medium uppercase tracking-[0.12em] text-muted-foreground">Slipstream</p>
            </div>
          </div>
          <p className="mb-3 text-2xs text-faint lg:hidden">大模型请求路由控制台</p>
          <form onSubmit={submit}>
            <Card className="p-6 shadow-pop">
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
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="login-password">密码</Label>
                  <Input
                    id="login-password"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    autoComplete="current-password"
                  />
                </div>
                {error ? <p className="text-sm text-danger-text">{error}</p> : null}
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
          <p className="mt-4 text-center text-2xs text-faint">会话有效期 12 小时，退出登录后立即失效。</p>
        </section>
      </div>
    </div>
  );
}
