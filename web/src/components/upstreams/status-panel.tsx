import { Check, X } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { api, ENDPOINTS } from "@/lib/api";
import { formatDateTime, useTimezone } from "@/lib/time";
import type { UpstreamKeyList } from "@/types";
import {
  API_STYLE_LABELS,
  API_STYLE_SHORT,
  authStyleLabel,
  probeKindLabel,
  probeStatusView,
  urlPathOf,
  type KeyTestResult,
  type ProbeResultView,
  type ProbeStep,
  type UpstreamRow,
} from "./shared";

function StatusRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-start gap-3 border-b border-border py-2 last:border-b-0">
      <span className="w-24 shrink-0 pt-0.5 text-2xs text-faint">{label}</span>
      <div className="min-w-0 flex-1 text-2sm text-body">{children}</div>
    </div>
  );
}

/** 探测步骤人话化：每行「图标 协议 GET /v1/models · 212ms」，失败行附降级说明。 */
function ProbeStepsList({ steps }: { steps: ProbeStep[] }) {
  return (
    <ul className="space-y-1">
      {steps.map((step) => {
        const label = API_STYLE_SHORT[step.protocol] ?? step.protocol;
        return (
          <li key={step.order} className="flex items-start gap-1.5 text-2xs">
            {step.ok ? (
              <Check className="mt-0.5 h-3 w-3 shrink-0 text-success-text" strokeWidth={2.25} aria-label="通过" />
            ) : (
              <X className="mt-0.5 h-3 w-3 shrink-0 text-danger-text" strokeWidth={2.25} aria-label="未通过" />
            )}
            <span className="shrink-0 font-medium text-body">{label}</span>
            <span className="tnum min-w-0 flex-1 truncate font-mono text-faint">
              {step.method} {urlPathOf(step.url)}
            </span>
            {step.ok ? (
              <span className="tnum shrink-0 text-faint">
                {step.latency_ms > 0 ? step.latency_ms + "ms" : "HTTP " + step.http_status}
              </span>
            ) : (
              <span className="tnum shrink-0 text-danger-text">
                {step.http_status > 0 ? "HTTP " + step.http_status : "未响应"}
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** 失败步骤的降级说明逐行列出（人话，不塞单行）。 */
function StepDetailList({ steps }: { steps: ProbeStep[] }) {
  const withDetail = steps.filter((step) => !step.ok && (step.detail ?? "").trim() !== "");
  if (withDetail.length === 0) return null;
  return (
    <ul className="mt-1 space-y-0.5">
      {withDetail.map((step) => (
        <li key={step.order} className="text-2xs text-faint">
          · {(API_STYLE_SHORT[step.protocol] ?? step.protocol) + "：" + (step.detail ?? "").trim()}
        </li>
      ))}
    </ul>
  );
}

/** 右列「连接状态」卡：最近探测 + 已识别协议 + 逐把测试结果。probe 是本次会话的实测结果，
 *  没有则回退 upstream.last_probe（列表摘要，无步骤）。逐把测试（ADR-026 ③）读密钥行
 *  的 last_test 落库值。 */
export function UpstreamStatusPanel({
  upstream,
  probe,
  keyTests,
  showDraftHint,
}: {
  upstream: UpstreamRow | null;
  probe: ProbeResultView | null;
  keyTests: KeyTestResult | null;
  showDraftHint: boolean;
}) {
  const { mode: timezone } = useTimezone();
  // upstream.last_probe 是列表摘要（无协议三字段/步骤）；运行时安全，读不到即为 undefined。
  const view = (probe ?? upstream?.last_probe ?? null) as ProbeResultView | null;
  const status = probeStatusView(view?.status);
  // 探测响应没带 protocol 时回退生效风格（api_style 永不落库为 auto）。
  const protocol = view?.protocol ?? upstream?.api_style ?? null;
  const protocolSource = view?.protocol_source ?? upstream?.api_style_source ?? null;
  const hasSteps = Array.isArray(view?.probe_steps) && (view?.probe_steps?.length ?? 0) > 0;
  // 密钥行落库的逐把测试（label 用密钥行备注补齐）；runtime 响应与落库内容一致。
  const keysQ = useQuery({
    queryKey: ["upstream-keys", upstream?.id ?? ""],
    queryFn: () => api.get<UpstreamKeyList>(ENDPOINTS.upstreamKeys(upstream?.id ?? "")),
    enabled: !!upstream,
  });
  const testedRows = (keysQ.data?.items ?? []).filter((key) => key.last_test !== null);
  const keyLabelOf = (keyId: string) =>
    (keysQ.data?.items ?? []).find((key) => key.id === keyId)?.label || "";

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-2sm">连接状态</CardTitle>
      </CardHeader>
      <CardContent className="space-y-1 pt-0">
        <StatusRow label="最近探测">
          {view ? (
            <span className="flex flex-wrap items-center gap-2">
              <Badge tone={status.tone}>{status.label}</Badge>
              <span className="text-2xs text-faint">{probeKindLabel(view.kind)}</span>
            </span>
          ) : (
            <span className="text-faint">—</span>
          )}
        </StatusRow>
        <StatusRow label="耗时">
          {view ? <span className="tnum">{view.latency_ms} ms</span> : <span className="text-faint">—</span>}
        </StatusRow>
        <StatusRow label="最近测试">
          {view?.tested_at_ms ? (
            <span className="tnum">{formatDateTime(view.tested_at_ms, timezone)}</span>
          ) : (
            <span className="text-faint">—</span>
          )}
        </StatusRow>
        <StatusRow label="已识别协议">
          {protocol ? (
            <span className="flex flex-wrap items-center gap-2">
              <Badge tone="info">{API_STYLE_LABELS[protocol] ?? protocol}</Badge>
              {protocolSource === "auto" ? (
                <Badge tone="neutral">自动探测</Badge>
              ) : (
                <Badge tone="neutral">手动指定</Badge>
              )}
            </span>
          ) : (
            <span className="text-faint">—</span>
          )}
        </StatusRow>
        <StatusRow label="鉴权方式">
          <span>{authStyleLabel(protocol)}</span>
        </StatusRow>
        <StatusRow label="逐把测试">
          {keyTests && keyTests.items.length === 0 ? (
            <span className="text-faint">没有可测试的密钥</span>
          ) : testedRows.length > 0 ? (
            <ul className="space-y-1">
              {testedRows.map((row) => {
                const result = row.last_test!;
                const label = keyLabelOf(result.key_id) || row.masked;
                return (
                  <li key={row.id} className="flex flex-wrap items-center gap-2 text-2xs">
                    <span className="min-w-0 max-w-40 truncate font-medium text-body">{label}</span>
                    {result.ok ? (
                      <Badge tone="success">HTTP {result.status_code} · {result.latency_ms} ms</Badge>
                    ) : (
                      <Badge tone="danger">{result.error || "HTTP " + result.status_code}</Badge>
                    )}
                    {row.last_test_at_ms > 0 ? (
                      <span className="tnum text-2xs text-faint">{formatDateTime(row.last_test_at_ms, timezone)}</span>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          ) : (
            <span className="text-faint">—</span>
          )}
        </StatusRow>
        {hasSteps ? (
          <StatusRow label="探测步骤">
            <div>
              <ProbeStepsList steps={view?.probe_steps ?? []} />
              <StepDetailList steps={view?.probe_steps ?? []} />
            </div>
          </StatusRow>
        ) : null}
        {view?.message ? (
          <StatusRow label="结果说明">
            <span className={view.status === "ok" ? "text-body" : "text-danger-text"}>{view.message}</span>
          </StatusRow>
        ) : null}
        {showDraftHint ? (
          <p className="pt-1 text-2xs text-warning-text">
            连接地址已修改未保存；测试连接与获取模型使用已保存的地址执行。
          </p>
        ) : null}
        {!view && testedRows.length === 0 ? (
          <p className="py-2 text-2xs text-faint">
            还没有探测记录；用页头「测试连接」逐把验证密钥连通性，结果会写库并在这里展示。
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
