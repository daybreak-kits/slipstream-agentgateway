import { useMutation, useQuery } from "@tanstack/react-query";
import {
  Bell, Check, Coins, Copy, KeyRound, Monitor, Moon, Palette, Save, Sun, UserRound,
} from "lucide-react";
import { useEffect, useState } from "react";
import { Link, NavLink, useParams } from "react-router-dom";
import { toast } from "@/lib/notify";

import { roleHint, roleLabel } from "@/components/governance/roles";
import { fmtCny, fmtInt, fmtMs } from "@/lib/format";
import { SettingsGrid, SettingsTile } from "@/components/settings/tile";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Textarea } from "@/components/ui/textarea";

import { AUTH_ME_QUERY_KEY, fetchMe } from "@/lib/auth";
import { usePermissions } from "@/lib/permissions";
import { useConnection, usePreferencesSync, useSavePreferences, useSaveProfile } from "@/lib/settings-ia";
import { dataPlanePortCopy, defaultBaseUrl, effectiveBaseUrl, isDataPlaneEnabled, isPortEnabled } from "@/lib/url";
import { useTheme, type Theme } from "@/lib/theme";
import { cn } from "@/lib/utils";
import { controlPlane } from "@/lib/control-plane";
import type { UserPreferences } from "@/types";
import { PageHeader } from "@/components/layout/page-header";

// docs/api-contract.md：POST /admin/auth/change-password（自助改密，ADR-019）；



type SectionKey = "profile" | "theme" | "tokens" | "spend" | "notifications";

type NotifyKey = "notify_email" | "notify_browser" | "notify_weekly";

/** 三个通知偏好只有开关文案不同，统一用一个列表渲染，避免逐块复制。 */
const NOTIFY_PREFS: { key: NotifyKey; title: string; hint: string }[] = [
  { key: "notify_email", title: "邮件通知", hint: "仅保存偏好，暂不投递。" },
  { key: "notify_browser", title: "浏览器通知", hint: "仅保存偏好，不请求浏览器权限。" },
  { key: "notify_weekly", title: "周报摘要", hint: "仅保存偏好，不发送邮件。" },
];

const SECTIONS: Array<{ key: SectionKey; label: string; icon: typeof UserRound }> = [
  { key: "profile", label: "个人资料", icon: UserRound },
  { key: "theme", label: "主题", icon: Palette },
  { key: "tokens", label: "连接密钥", icon: KeyRound },
  { key: "spend", label: "我的花费", icon: Coins },
  { key: "notifications", label: "通知偏好", icon: Bell },
];

const THEME_OPTIONS: Array<{ value: Theme; label: string; hint: string; icon: typeof Sun }> = [
  { value: "light", label: "浅色", hint: "始终使用浅色主题", icon: Sun },
  { value: "dark", label: "深色", hint: "始终使用深色主题", icon: Moon },
  { value: "system", label: "跟随系统", hint: "随操作系统浅色/深色切换", icon: Monitor },
];

async function copyText(text: string, label: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    toast.success("已复制" + label);
  } catch {
    toast.error("复制失败，请手动选中复制");
  }
}

function TileSkeleton() {
  return <Skeleton className="h-28 w-full" />;
}

/** 用户设置·自助改密（ADR-019）：验证旧密码后设置新密码；其他已登录会话吊销，当前会话保留。 */
function PasswordTile() {
  const [oldPassword, setOldPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: (payload: { old_password: string; new_password: string }) =>
      controlPlane.settings.changePassword(payload),
    onSuccess: (result) => {
      toast.success("密码已修改", {
        description:
          result.revoked_sessions > 0
            ? "已吊销其他 " + result.revoked_sessions + " 个会话，当前会话保留"
            : "当前会话保留",
      });
      setOldPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setFormError(null);
    },
    onError: (error) => setFormError(error.message),
  });

  const submit = () => {
    if (newPassword.length < 8) {
      setFormError("新密码至少 8 位");
      return;
    }
    if (newPassword !== confirmPassword) {
      setFormError("两次输入的新密码不一致");
      return;
    }
    if (newPassword === oldPassword) {
      setFormError("新密码不能与旧密码相同");
      return;
    }
    setFormError(null);
    save.mutate({ old_password: oldPassword, new_password: newPassword });
  };

  const filled = oldPassword !== "" && newPassword !== "" && confirmPassword !== "";

  return (
    <SettingsTile
      title="修改密码"
      hint="验证旧密码后设置新密码（至少 8 位）；保存后其他已登录会话全部吊销，当前会话保留。管理用户重置他人密码在用户管理页。"
      className="md:col-span-3 xl:col-span-3"
    >
      <Input
        type="password"
        autoComplete="current-password"
        aria-label="旧密码"
        placeholder="旧密码"
        value={oldPassword}
        onChange={(event) => setOldPassword(event.target.value)}
      />
      <Input
        type="password"
        autoComplete="new-password"
        aria-label="新密码"
        placeholder="新密码（至少 8 位）"
        value={newPassword}
        onChange={(event) => setNewPassword(event.target.value)}
      />
      <Input
        type="password"
        autoComplete="new-password"
        aria-label="确认新密码"
        placeholder="确认新密码"
        value={confirmPassword}
        onChange={(event) => setConfirmPassword(event.target.value)}
      />
      {formError !== null && <p className="text-2xs text-danger-text">{formError}</p>}
      <Button variant="primary" size="sm" disabled={!filled || save.isPending} onClick={submit}>
        {save.isPending ? "修改中…" : "修改密码"}
      </Button>
    </SettingsTile>
  );
}

/** 用户设置·个人资料：显示名可改，用户名/角色只读。 */
function ProfileSection() {
  const me = useQuery({ queryKey: AUTH_ME_QUERY_KEY, queryFn: fetchMe, staleTime: 60_000 });
  const saveProfile = useSaveProfile();
  const [name, setName] = useState("");

  useEffect(() => {
    if (me.data?.name) setName(me.data.name);
  }, [me.data?.name]);

  if (me.isPending) return <SettingsGrid>{Array.from({ length: 3 }, (_, i) => <TileSkeleton key={i} />)}</SettingsGrid>;

  const current = me.data;
  if (!current) {
    return (
      <SettingsGrid>
        <SettingsTile title="个人资料" hint="未取得登录身份" className="md:col-span-3 xl:col-span-6">
          <Button variant="outline" size="sm" onClick={() => void me.refetch()}>重试</Button>
        </SettingsTile>
      </SettingsGrid>
    );
  }

  const trimmed = name.trim();
  const dirty = trimmed.length > 0 && trimmed !== current.name;

  return (
    <SettingsGrid>
      <SettingsTile title="显示名" hint="用于顶栏与操作记录，保存后立即生效。">
        <Input className="h-8" value={name} onChange={(event) => setName(event.target.value)} maxLength={255} aria-label="显示名" />
        <Button
          size="sm"
          variant="primary"
          disabled={!dirty || saveProfile.isPending}
          onClick={() =>
            saveProfile.mutate(trimmed, {
              onSuccess: () => toast.success("个人资料已保存"),
              onError: (error) => toast.error("保存失败", { description: error.message }),
            })
          }
        >
          <Save className="h-3.5 w-3.5" />
          {saveProfile.isPending ? "保存中…" : "保存"}
        </Button>
      </SettingsTile>
      <SettingsTile title="账号" hint="用户名与角色由管理用户维护。">
        <p className="font-mono text-2sm text-title">{current.username}</p>
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge tone="primary">{roleLabel(current.role)}</Badge>
          <span className="text-2xs text-faint">{roleHint(current.role)}</span>
        </div>
      </SettingsTile>
      <SettingsTile title="会话" hint="httpOnly 会话，退出登录即撤销。">
        <p className="text-2xs text-faint">当前身份</p>
        <p className="text-2sm text-title">{current.name || current.username}</p>
        <p className="text-2xs text-faint">
          {current.expires_at ? "有效期至 " + fmtMs(Date.parse(current.expires_at)) : "有效期由控制面会话策略决定"}
        </p>
      </SettingsTile>
      <PasswordTile />
      <SettingsTile title="权限" hint="来自 /admin/auth/me，前端只用于显隐，后端仍强制校验。" className="md:col-span-3 xl:col-span-3">
        <div className="flex flex-wrap gap-1">
          {current.permissions.length === 0 ? (
            <span className="text-2xs text-faint">没有额外权限</span>
          ) : (
            current.permissions.map((permission) => (
              <Badge key={permission} tone="neutral" className="font-mono text-2xs">
                {permission}
              </Badge>
            ))
          )}
        </div>
      </SettingsTile>
    </SettingsGrid>
  );
}

/** 用户设置·主题：三个选项，写服务端偏好并同步本机 localStorage。 */
function ThemeSection() {
  const { theme, setTheme } = useTheme();
  const prefs = usePreferencesSync();
  const save = useSavePreferences();

  const choose = (next: Theme) => {
    setTheme(next);
    save.mutate(
      { ...prefs.preferences, theme: next },
      {
        onSuccess: () => toast.success("主题已保存", { description: "已写入用户设置，换浏览器登录仍生效" }),
        onError: (error) => toast.error("主题已在本机生效，但保存到用户设置失败", { description: error.message }),
      },
    );
  };

  return (
    <SettingsGrid>
      <ToggleGroup
        type="single"
        value={theme}
        onValueChange={(next) => { if (next) choose(next as Theme); }}
        aria-label="主题"
        className="contents"
      >
        {THEME_OPTIONS.map((option) => (
          <ToggleGroupItem
            key={option.value}
            value={option.value}
            className={cn(
              "flex h-auto min-w-0 flex-col items-start gap-2 rounded-lg border border-border bg-surface p-3 text-left shadow-card transition-colors hover:bg-surface-2",
              "data-[state=on]:border-primary data-[state=on]:bg-primary-soft",
            )}
          >
            <span className="flex w-full items-center gap-1.5">
              <option.icon className="h-4 w-4 text-muted-foreground" strokeWidth={1.75} />
              <span className="flex-1 text-2sm font-medium text-title">{option.label}</span>
              {theme === option.value && <Check className="h-3.5 w-3.5 text-primary" />}
            </span>
            <span className="text-2xs text-faint">{option.hint}</span>
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
      <SettingsTile title="当前生效" hint="跟随系统时按操作系统实时切换。">
        <p className="text-2sm text-title">
          {theme === "light" ? "浅色" : theme === "dark" ? "深色" : "跟随系统"}
        </p>
        <p className="text-2xs text-faint">{prefs.isLoading ? "正在同步用户设置…" : "已同步到用户设置"}</p>
      </SettingsTile>
    </SettingsGrid>
  );
}

/** 用户设置·连接密钥：统一连接地址 + 我的密钥 + 接入示例。 */
function ConnectionKeysSection() {
  const { can } = usePermissions();
  const connection = useConnection();
  const address = effectiveBaseUrl(connection.data);
  // 端口 0/缺失 = 数据面未启用（外部数据面）：不拼 /v1，也不提供会复制出 host:0 的按钮。
  const dataPlaneEnabled = isDataPlaneEnabled(connection.data);
  const baseUrl = dataPlaneEnabled ? address + "/v1" : address;
  const canReadKeys = can("apikeys:read");
  const keys = useQuery({
    queryKey: ["api-keys", "settings"],
    queryFn: () => controlPlane.clientKeys.list(),
    enabled: canReadKeys,
    retry: false,
  });

  const curlSample = [
    "curl " + baseUrl + "/chat/completions \\",
    '  -H "Authorization: Bearer sk-ss-你的连接密钥" \\',
    '  -H "Content-Type: application/json" \\',
    '  -d \'{"model":"glm","messages":[{"role":"user","content":"你好"}],"stream":true}\'',
  ].join("\n");

  return (
    <SettingsGrid>
      <SettingsTile
        title="统一连接地址"
        hint={
          connection.isPending
            ? "读取连接设置…"
            : connection.data?.configured
              ? "来自运营设置，所有用户共用"
              : dataPlaneEnabled
                ? dataPlanePortCopy("address-default")
                : dataPlanePortCopy("address-disabled")
        }
        action={
          <Badge tone={connection.data?.configured ? "info" : "neutral"}>
            {connection.data?.configured ? "已配置" : dataPlaneEnabled ? "默认" : "未启用"}
          </Badge>
        }
        className="md:col-span-3 xl:col-span-2"
      >
        <p className="break-all font-mono text-2sm text-title">{connection.isPending ? "读取中…" : address}</p>
        <div className="flex gap-1.5">
          <Button
            variant="outline"
            size="sm"
            disabled={connection.isPending || !dataPlaneEnabled}
            onClick={() => void copyText(address, "连接地址")}
          >
            <Copy className="h-3.5 w-3.5" />
            复制
          </Button>
          <Button
            variant="ghost"
            size="sm"
            disabled={connection.isPending || !isPortEnabled(connection.data?.default_port)}
            onClick={() => void copyText(defaultBaseUrl(connection.data?.default_port), "默认地址")}
          >
            默认地址
          </Button>
        </div>
      </SettingsTile>
      <SettingsTile title="Base URL" hint="OpenAI 兼容客户端填这个地址。" className="md:col-span-3 xl:col-span-2">
        <p className="break-all font-mono text-2sm text-title">{connection.isPending ? "读取中…" : baseUrl}</p>
        <Button
          variant="outline"
          size="sm"
          disabled={connection.isPending || !dataPlaneEnabled}
          onClick={() => void copyText(baseUrl, "Base URL")}
        >
          <Copy className="h-3.5 w-3.5" />
          复制
        </Button>
      </SettingsTile>
      <SettingsTile
        title="我的密钥"
        hint={canReadKeys ? "只展示掩码；明文只在创建时返回一次。" : "当前角色没有 apikeys:read，请联系管理用户获取密钥。"}
        className="md:col-span-3 xl:col-span-2"
      >
        {!canReadKeys ? (
          <p className="text-2xs text-faint">无查看密钥权限。</p>
        ) : keys.isPending ? (
          <Skeleton className="h-6 w-full" />
        ) : keys.isError ? (
          <p className="text-2xs text-danger-text">密钥列表加载失败：{(keys.error as Error).message}</p>
        ) : (keys.data?.length ?? 0) === 0 ? (
          <p className="text-2xs text-faint">还没有连接密钥。</p>
        ) : (
          <ul className="space-y-1">
            {(keys.data ?? []).slice(0, 5).map((item) => (
              <li key={item.id} className="flex items-center gap-1.5 text-2xs">
                <span className="font-mono text-title">{item.mask}</span>
                <Badge tone={item.status === "active" ? "success" : "warning"}>
                  {item.status === "active" ? "启用" : "关闭"}
                </Badge>
              </li>
            ))}
          </ul>
        )}
        {canReadKeys && (
          <Link to="/client-keys" className="text-2xs text-primary hover:underline">
            去连接密钥页管理 →
          </Link>
        )}
      </SettingsTile>
      <SettingsTile title="接入示例" hint="把占位密钥换成你的连接密钥。" className="md:col-span-3 xl:col-span-6">
        {connection.isPending ? (
          <Skeleton className="h-16 w-full" />
        ) : dataPlaneEnabled ? (
          <>
            <pre className="overflow-x-auto rounded-md border border-border bg-surface-2 p-2 text-2xs leading-5">
              <code className="font-mono text-body">{curlSample}</code>
            </pre>
            <Button variant="outline" size="sm" className="self-start" onClick={() => void copyText(curlSample, "接入示例")}>
              <Copy className="h-3.5 w-3.5" />
              复制
            </Button>
          </>
        ) : (
          <p className="text-2xs text-faint">
            {dataPlanePortCopy("example-disabled")}
          </p>
        )}
      </SettingsTile>
    </SettingsGrid>
  );
}

/** 用户设置·我的花费：ticket 17 直接复用 /admin/bills/my-spend，和账单页同一口径。 */
function SpendSection() {
  const { can } = usePermissions();
  const spend = useQuery({
    queryKey: ["bills", "my-spend", "30d", "self"],
    queryFn: () => controlPlane.settings.mySpend({ range: "30d", scope: "self" }),
    staleTime: 30_000,
  });
  const stats = spend.data?.summary;
  const showCost = can("billing:cost") && stats?.cost_micro !== undefined;
  const showMargin = can("billing:cost") && stats?.margin_micro !== undefined;

  if (spend.isPending) {
    return <SettingsGrid>{Array.from({ length: 4 }, (_, i) => <TileSkeleton key={i} />)}</SettingsGrid>;
  }
  if (spend.isError || !stats) {
    return (
      <SettingsGrid>
        <SettingsTile title="我的花费" hint="近 30 天；数据来自用户层级账单接口。" className="md:col-span-3 xl:col-span-6">
          <p className="text-2xs text-danger-text">花费加载失败：{spend.error?.message ?? "没有账单权限"}</p>
          <Button variant="outline" size="sm" onClick={() => void spend.refetch()}>重试</Button>
        </SettingsTile>
      </SettingsGrid>
    );
  }

  return (
    <SettingsGrid>
      <SettingsTile title="请求数" hint="近 30 天">
        <p className="tnum text-metric font-semibold text-title">{fmtInt(stats.requests)}</p>
      </SettingsTile>
      <SettingsTile title="词元合计" hint="近 30 天">
        <p className="tnum text-metric font-semibold text-title">{fmtInt(stats.input_tokens + stats.output_tokens)}</p>
        <p className="text-2xs text-faint">输入 {fmtInt(stats.input_tokens)} · 输出 {fmtInt(stats.output_tokens)}</p>
      </SettingsTile>
      <SettingsTile title="我的花费" hint="近 30 天 · 营收口径">
        <p className="tnum text-metric font-semibold text-title">
          {stats.charge_micro === null ? "-" : fmtCny(stats.charge_micro)}
        </p>
      </SettingsTile>
      {showCost && (
        <SettingsTile title="成本" hint="近 30 天 · 上游成本（billing:cost）">
          <p className="tnum text-metric font-semibold text-title">
            {stats.cost_micro === null || stats.cost_micro === undefined ? "-" : fmtCny(stats.cost_micro)}
          </p>
        </SettingsTile>
      )}
      {showMargin && (
        <SettingsTile title="毛利" hint="近 30 天 · 花费 − 成本">
          <p className="tnum text-metric font-semibold text-title">
            {stats.margin_micro === null || stats.margin_micro === undefined ? "-" : fmtCny(stats.margin_micro)}
          </p>
        </SettingsTile>
      )}
      <SettingsTile title="完整账单" hint="按时间范围与子树切换查看。">
        <Link to="/users" className="text-2sm text-primary hover:underline">
          去账单页查看 →
        </Link>
      </SettingsTile>
      <SettingsTile title="口径说明" hint="只读聚合字段，不在此处改价。" className="md:col-span-3 xl:col-span-6">
        <p className="text-2xs text-faint">
          金额按整数 micro 记账（1 元 = 1,000,000 micro），界面折元保留两位小数。
          成本与毛利字段只在具备 billing:cost 时由后端返回；无权限时接口里没有这些键。
        </p>
      </SettingsTile>
    </SettingsGrid>
  );
}

/** 用户设置·通知偏好：仅存储，不实现投递（spec 明确）。 */
function NotificationsSection() {
  const prefs = usePreferencesSync();
  const save = useSavePreferences();
  const [draft, setDraft] = useState<UserPreferences | null>(null);

  useEffect(() => {
    if (prefs.preferences) setDraft(prefs.preferences);
  }, [prefs.preferences]);

  const current = draft ?? prefs.preferences;
  const dirty = draft !== null && JSON.stringify(draft) !== JSON.stringify(prefs.preferences);

  const toggle = (key: NotifyKey, value: boolean) =>
    setDraft({ ...current, [key]: value });

  return (
    <SettingsGrid>
      {NOTIFY_PREFS.map((item) => (
        <SettingsTile key={item.key} title={item.title} hint={item.hint}>
          <Switch checked={current[item.key]} onCheckedChange={(value) => toggle(item.key, value)} aria-label={item.title} />
        </SettingsTile>
      ))}
      <SettingsTile title="个人简介" hint="会随偏好一起保存，最多 500 字。" className="md:col-span-3 xl:col-span-3">
        <Textarea
          value={current.bio}
          maxLength={500}
          rows={3}
          onChange={(event) => setDraft({ ...current, bio: event.target.value })}
          placeholder="一句话介绍自己（可选）"
          aria-label="个人简介"
        />
      </SettingsTile>
      <SettingsTile title="保存" hint="通知偏好只存储、不投递；保存后本账号生效。" className="md:col-span-3 xl:col-span-6">
        <div className="flex items-center gap-2">
          <Button
            variant="primary"
            size="sm"
            disabled={!dirty || save.isPending}
            onClick={() =>
              save.mutate(current, {
                onSuccess: () => toast.success("通知偏好已保存"),
                onError: (error) => toast.error("保存失败", { description: error.message }),
              })
            }
          >
            <Save className="h-3.5 w-3.5" />
            {save.isPending ? "保存中…" : "保存通知偏好"}
          </Button>
          {dirty && <span className="text-2xs text-warning-text">有未保存的改动</span>}
        </div>
      </SettingsTile>
    </SettingsGrid>
  );
}

/** 用户设置：个人资料 / 主题 / 连接密钥 / 我的花费 / 通知偏好（ticket 16）。 */
export function SettingsPage() {
  const { section } = useParams<{ section?: string }>();
  const active = SECTIONS.find((item) => item.key === section) ?? SECTIONS[0]!;

  return (
    <div className="space-y-4">
      <PageHeader
        title="用户设置"
        description="只影响你自己的账号与浏览器；连接地址来自运营设置，所有用户共用。"
      />

      <nav aria-label="用户设置子导航" className="flex flex-wrap items-center gap-1 border-b border-border pb-2">
        {SECTIONS.map((item) => (
          <NavLink
            key={item.key}
            to={"/settings/" + item.key}
            className={({ isActive }) =>
              cn(
                "flex items-center gap-1.5 rounded-control px-2.5 py-1.5 text-2sm transition-colors",
                isActive || active.key === item.key
                  ? "bg-primary-soft font-medium text-primary"
                  : "text-body hover:bg-surface-2 hover:text-title",
              )
            }
          >
            <item.icon className="h-3.5 w-3.5" strokeWidth={1.75} />
            {item.label}
          </NavLink>
        ))}
      </nav>

      {active.key === "profile" && <ProfileSection />}
      {active.key === "theme" && <ThemeSection />}
      {active.key === "tokens" && <ConnectionKeysSection />}
      {active.key === "spend" && <SpendSection />}
      {active.key === "notifications" && <NotificationsSection />}
    </div>
  );
}
