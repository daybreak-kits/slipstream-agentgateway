import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { ArrowRight, Copy } from "lucide-react";
import { Link } from "react-router-dom";
import { toast } from "@/lib/notify";

import {
  useControlPlaneHealth,
  useRecentRevisions,
} from "@/components/dashboard/use-reports";
import type { RevisionLike } from "@/components/dashboard/report-types";
import {
  normalizeSettings,
  type SettingsItem,
  type SettingsPayload,
} from "@/components/governance/settings-schema";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs } from "@/components/ui/tabs";
import { api, ENDPOINTS } from "@/lib/api";
import { revisionStatusMeta } from "@/lib/revision-status";
import { usePermissions } from "@/lib/permissions";
import { effectiveBaseUrl, useConnection } from "@/lib/settings-ia";
import { useTimezone } from "@/lib/time";
import { formatIntervalDateTime } from "@/lib/time-range";
import { cn } from "@/lib/utils";

/**
 * 快速上手（ADR-023 #1）：三步上手 + 网关连接信息 + 页顶系统健康带。
 * 旧「全局概览」的今日概况指标卡与最近变更块已移除（数据看板已有）。
 */

const ENDPOINT_ROWS: Array<{ path: string; label: string }> = [
  { path: "/v1/chat/completions", label: "对话补全" },
  { path: "/v1/models", label: "公开模型列表" },
  { path: "/v1/embeddings", label: "向量" },
];

function revisionTitle(row: RevisionLike): string {
  if (row.revision) return row.revision;
  if (row.artifact_hash) return row.artifact_hash.slice(0, 10);
  return row.id ?? "未知版本";
}

async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    toast.success("已复制");
  } catch {
    toast.error("复制失败");
  }
}

/** 示例代码块：右上角图标按钮复制，成功「已复制」失败「复制失败」。 */
function CodeBlock({ code, label }: { code: string; label: string }) {
  return (
    <div className="relative">
      <pre className="overflow-x-auto rounded-md border border-border bg-surface-2 py-3 pl-3 pr-10 text-2xs leading-5">
        <code className="font-mono text-body">{code}</code>
      </pre>
      <Button
        variant="ghost"
        size="icon"
        aria-label={"复制" + label}
        title={"复制" + label}
        className="absolute right-1.5 top-1.5 h-7 w-7"
        onClick={() => void copyText(code)}
      >
        <Copy className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}

/** 页顶健康带：非卡片横条；加载失败静默降级为「健康状态未知」。 */
function HealthBand() {
  const { mode: timezone } = useTimezone();
  const health = useControlPlaneHealth();
  const revisions = useRecentRevisions(1);
  const latest = revisions.data?.[0];
  const status = latest ? revisionStatusMeta(latest.status) : undefined;
  const healthy = health.isError ? false : health.data?.status === "ok";

  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-2 border-b border-border pb-4 text-2xs">
      <div className="flex items-center gap-1.5">
        <span className="text-faint">控制面</span>
        {health.isPending ? (
          <Skeleton className="h-4 w-12" />
        ) : healthy ? (
          <Badge tone="success">正常</Badge>
        ) : (
          <Badge tone="neutral">{health.isError ? "健康状态未知" : health.data?.status ?? "健康状态未知"}</Badge>
        )}
      </div>
      <div className="flex items-center gap-1.5">
        <span className="text-faint">AG 数据面</span>
        {health.isPending ? (
          <Skeleton className="h-4 w-24" />
        ) : health.isError ? (
          <span className="text-faint">健康状态未知</span>
        ) : (
          <span className="tnum text-body">
            {health.data?.adapter ?? "—"} · 端口 {health.data?.data_plane_port ?? "—"}
          </span>
        )}
      </div>
      <div className="flex items-center gap-1.5">
        <span className="text-faint">最近下发</span>
        {revisions.isPending ? (
          <Skeleton className="h-4 w-20" />
        ) : revisions.isError ? (
          <span className="text-faint">—</span>
        ) : latest ? (
          <span className="flex items-center gap-1.5">
            <span className="tnum text-body">{revisionTitle(latest)}</span>
            {status && <Badge tone={status.tone}>{status.label}</Badge>}
          </span>
        ) : (
          <span className="text-faint">尚未下发</span>
        )}
      </div>
      <div className="flex items-center gap-1.5">
        <span className="text-faint">检查时刻</span>
        {health.isPending ? (
          <Skeleton className="h-4 w-28" />
        ) : health.data ? (
          <span className="tnum text-body">{formatIntervalDateTime(health.data.now_ms, timezone)}</span>
        ) : (
          <span className="text-faint">—</span>
        )}
      </div>
    </div>
  );
}

/** 步骤卡：编号 + 标题 + 一句说明 + 主操作 + 完成判据小字。 */
function StepCard({
  index,
  title,
  description,
  actions,
  criteria,
  children,
}: {
  index: number;
  title: string;
  description: string;
  actions: ReactNode;
  criteria: ReactNode;
  children?: ReactNode;
}) {
  return (
    <Card>
      <CardContent className="space-y-3 p-6">
        <div className="flex items-center gap-2.5">
          <span className="tnum grid h-6 w-6 shrink-0 place-items-center rounded-full border border-border font-mono text-2xs text-body">
            {index}
          </span>
          <h3 className="text-sm font-semibold text-title">{title}</h3>
        </div>
        <p className="text-2sm text-faint">{description}</p>
        {children}
        <div className="flex flex-wrap items-center gap-2">{actions}</div>
        <p className="text-2xs text-faint">完成判据：{criteria}</p>
      </CardContent>
    </Card>
  );
}

function StepLink({ to, label, primary }: { to: string; label: string; primary?: boolean }) {
  return (
    <Link to={to} className={cn(buttonVariants({ variant: primary ? "primary" : "outline", size: "sm" }))}>
      {label}
      <ArrowRight className="h-3.5 w-3.5" />
    </Link>
  );
}

function DeniedHint({ permission }: { permission: string }) {
  return <span className="text-2xs text-faint">当前角色无 {permission} 权限，联系管理用户开通</span>;
}

/** 连接信息卡：地址来自 GET /admin/connection 与运营设置 gateway_base_url；端点清单只列数据面实测存在的常用面。 */
function ConnectionInfoCard({ canSettings }: { canSettings: boolean }) {
  const connection = useConnection();
  const settings = useQuery({
    queryKey: ["settings", "quick-start"],
    queryFn: () => api.get<SettingsPayload | SettingsItem[]>(ENDPOINTS.settings),
    enabled: canSettings,
    retry: false,
    staleTime: 60_000,
  });
  // 运营设置显式配置的公网地址；无权限或未配置都显示「—」
  const configuredUrl = canSettings
    ? normalizeSettings(settings.data).find((row) => row.key === "gateway_base_url")?.value?.trim() || "—"
    : "—";
  const address = effectiveBaseUrl(connection.data);

  return (
    <Card>
      <CardHeader>
        <CardTitle>网关连接信息</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-x-8 gap-y-4 md:grid-cols-2">
        <div className="space-y-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-2xs text-faint">数据面地址（客户端调用的 base）</div>
              <div className="tnum break-all font-mono text-2sm text-title">{address}/v1</div>
              <div className="text-2xs text-faint">
                {connection.isPending
                  ? "读取中"
                  : connection.data?.configured
                    ? "来自运营设置"
                    : "未配置，默认浏览器 host + " + (connection.data?.default_port ?? 3600) + " 端口"}
              </div>
            </div>
            <Button
              variant="ghost"
              size="icon"
              aria-label="复制数据面地址"
              title="复制数据面地址"
              className="h-7 w-7 shrink-0"
              onClick={() => void copyText(address + "/v1")}
            >
              <Copy className="h-3.5 w-3.5" />
            </Button>
          </div>
          <div>
            <div className="text-2xs text-faint">管理台地址（当前 origin）</div>
            <div className="tnum break-all font-mono text-2sm text-body">{window.location.origin}</div>
          </div>
          <div>
            <div className="text-2xs text-faint">公网地址 gateway_base_url（运营设置）</div>
            <div className="tnum break-all font-mono text-2sm text-body">
              {canSettings && settings.isPending ? "读取中" : configuredUrl}
            </div>
          </div>
        </div>
        <div className="space-y-2">
          <div className="text-2xs text-faint">常用端点</div>
          <ul className="space-y-1.5">
            {ENDPOINT_ROWS.map((row) => (
              <li key={row.path} className="flex items-baseline justify-between gap-3">
                <span className="font-mono text-2sm text-title">{row.path}</span>
                <span className="text-2xs text-faint">{row.label}</span>
              </li>
            ))}
          </ul>
          <p className="text-2xs text-faint">
            请求需带 <span className="font-mono">Authorization: Bearer sk-ss-…</span>，
            model 填公开模型名，数据面按优先级选路
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

/** 路由 /：快速上手页。 */
export function OverviewPage() {
  const { can } = usePermissions();
  const canKeys = can("apikeys:read");
  const canUpstreams = can("upstreams:read");
  const canModels = can("upstream_models:read");
  const canPlayground = can("playground:use");
  const connection = useConnection();
  const address = effectiveBaseUrl(connection.data) + "/v1";

  const curlSample = [
    "curl " + address + "/chat/completions \\",
    '  -H "Authorization: Bearer sk-ss-你的连接密钥" \\',
    '  -H "Content-Type: application/json" \\',
    '  -d \'{"model":"your-public-model","messages":[{"role":"user","content":"你好"}],"stream":true}\'',
  ].join("\n");
  const pythonSample = [
    "from openai import OpenAI",
    "",
    "client = OpenAI(",
    '    base_url="' + address + '",',
    '    api_key="sk-ss-你的连接密钥",',
    ")",
    "",
    "stream = client.chat.completions.create(",
    '    model="your-public-model",',
    '    messages=[{"role": "user", "content": "你好"}],',
    "    stream=True,",
    ")",
    "for chunk in stream:",
    "    print(chunk.choices[0].delta.content or \"\", end=\"\")",
  ].join("\n");

  return (
    <div className="space-y-6">
      <HealthBand />

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-title">三步上手</h2>
        <div className="space-y-3">
          <StepCard
            index={1}
            title="签发连接密钥"
            description="sk- 开头的连接密钥是调用网关的凭据，明文只在签发时展示一次"
            criteria={
              <>
                至少一把 <span className="font-mono">active</span> 密钥
              </>
            }
            actions={
              canKeys ? (
                <StepLink to="/client-keys" label="去连接密钥" primary />
              ) : (
                <DeniedHint permission="apikeys:read" />
              )
            }
          />
          <StepCard
            index={2}
            title="配置上游渠道与公开模型"
            description="先接上游渠道（协议自动探测），再到模型管理建公开模型并绑定上游目标"
            criteria="≥1 个启用上游 + ≥1 个公开模型"
            actions={
              <>
                {canUpstreams ? (
                  <StepLink to="/upstreams" label="去上游渠道" primary />
                ) : (
                  <DeniedHint permission="upstreams:read" />
                )}
                {canModels ? (
                  <StepLink to="/models" label="去模型管理" />
                ) : (
                  <DeniedHint permission="upstream_models:read" />
                )}
              </>
            }
          />
          <StepCard
            index={3}
            title="调用网关"
            description="OpenAI 兼容协议，base 地址取数据面地址，model 填公开模型名"
            criteria="示例请求返回 2xx"
            actions={canPlayground ? <StepLink to="/playground" label="在模型试验里试一把" /> : undefined}
          >
            <Tabs
              items={[
                { key: "curl", label: "curl", content: <CodeBlock code={curlSample} label="curl 示例" /> },
                { key: "python", label: "Python", content: <CodeBlock code={pythonSample} label="Python 示例" /> },
              ]}
            />
          </StepCard>
        </div>
      </section>

      <ConnectionInfoCard canSettings={can("settings:read")} />
    </div>
  );
}
