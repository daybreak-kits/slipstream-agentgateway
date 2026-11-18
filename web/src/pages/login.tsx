import { useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { toast } from "sonner";

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
    <div className="flex min-h-full items-center justify-center bg-surface-2 p-6">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center gap-3">
          <img
            src="/logo-v10-contrast.svg"
            alt=""
            aria-hidden="true"
            className="h-10 w-10 shrink-0"
          />
          <div>
            <div className="text-lg font-semibold text-title">
              驭流 <span className="font-normal text-faint">Slipstream</span>
            </div>
            <p className="text-2xs text-faint">大模型请求路由控制台</p>
          </div>
        </div>

        <form onSubmit={submit}>
          <Card className="p-6">
          <h1 className="text-h1 font-semibold text-title">登录</h1>
          <p className="mt-1 text-xs text-faint">使用管理员账号进入控制台。</p>
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
            {error ? <p className="text-xs text-danger-text">{error}</p> : null}
            <Button
              type="submit"
              className="w-full"
              disabled={busy || username.trim() === "" || password === ""}
            >
              {busy ? "登录中…" : "登录"}
            </Button>
          </div>
          <p className="mt-4 text-2xs text-faint">
            演示默认账号 admin / admin12345，首次登录后请立即在「管理员」页修改密码。
          </p>
          </Card>
        </form>
        <p className="mt-4 text-center text-2xs text-faint">
          会话有效期 12 小时，退出登录后立即失效。
        </p>
      </div>
    </div>
  );
}
