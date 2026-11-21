import { useQuery } from "@tanstack/react-query";
import { ChevronDown, Copy, RefreshCw } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { toast } from "@/lib/notify";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { api, ApiError } from "@/lib/api";
import { fmtInt, fmtMoneyAvg, fmtPctPoint, fmtSeconds, fmtThroughput } from "@/lib/format";
import { usePermissions } from "@/lib/permissions";
import { formatDateTime } from "@/lib/time";
import type { IntervalTimezone } from "@/lib/time-range";

import { statusLabel, statusTone, upstreamLabel } from "./format";
import { rowErrorText } from "./error-summary";
import { NoChainRecord, RequestAttemptChain } from "./request-attempt-chain";
import type { LogDetail, LogPayload, LogRow } from "./types";
import { useLogAttempts } from "./use-log-attempts";

interface LogDetailDrawerProps {
  open: boolean;
  row: LogRow | null;
  timezone: IntervalTimezone;
  onOpenChange: (open: boolean) => void;
}

/** 正文展示截断阈值：超过 200 KB 只渲染前 200 KB，防大 payload 卡主线程。 */
const PAYLOAD_DISPLAY_LIMIT = 200 * 1024;

interface PrettyPayload {
  text: string;
  truncated: boolean;
  empty: boolean;
}

/** JSON 美化 + 截断：只在 payload 变化时算一次（useMemo 懒序列化，不整包反复 stringify）。 */
function prettyPayload(raw: string | undefined): PrettyPayload {
  if (!raw || !raw.trim()) return { text: "", truncated: false, empty: true };
  let pretty = raw;
  try {
    pretty = JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    // 非合法 JSON 原样展示
  }
  if (pretty.length > PAYLOAD_DISPLAY_LIMIT) {
    return { text: pretty.slice(0, PAYLOAD_DISPLAY_LIMIT), truncated: true, empty: false };
  }
  return { text: pretty, truncated: false, empty: false };
}

export function LogDetailDrawer({ open, row, timezone, onOpenChange }: LogDetailDrawerProps) {
  const detailQuery = useQuery({
    queryKey: ["log-detail", row?.event_id ?? ""],
    queryFn: ({ signal }) => {
      if (!row) throw new Error("缺少日志行");
      return api.get<LogDetail>(
        "/admin/logs/" + encodeURIComponent(row.event_id) + "?include_payload=true",
        { signal },
      );
    },
    enabled: open && row !== null,
    staleTime: 30_000,
  });

  const detail = detailQuery.data;
  const raw = useMemo(() => parseRawRecord(detail?.raw_json), [detail?.raw_json]);
  // 整包 pretty-print 很贵：只在 raw 变化时算一次，别在每次抽屉渲染都 stringify。
  const rawPretty = useMemo(() => (raw ? JSON.stringify(raw, null, 2) : null), [raw]);
  const { can } = usePermissions();
  const canCost = can("billing:cost");
  const canSpend = can("billing:spend");

  if (!row) return null;

  // 详情还在加载时先显示列表行，字段与后端最终数据保持一致。
  const view: LogDetail = detail ?? row;
  const currency = view.currency || row.currency;
  const copyId = async () => {
    try {
      await navigator.clipboard.writeText(row.event_id);
      toast.success("请求 ID 已复制", { description: row.event_id });
    } catch {
      toast.error("复制失败", { description: "浏览器可能未授权剪贴板访问" });
    }
  };

  const targetFields: Array<[string, ReactNode]> = [
    ["请求模型", view.requested_model || "—"],
    ["上游模型", view.upstream_model || "—"],
    ["目标层级", view.target_priority === null ? "—" : "P" + view.target_priority],
    ["厂商", view.provider || "—"],
    ["操作", rawValue(raw, "gen_ai_operation_name")],
    ["请求 ID", <span className="font-mono text-2xs">{view.event_id}</span>],
  ];

  const identityFields: Array<[string, ReactNode]> = [
    ["用户", view.user_name || "—"],
    ["用户 ID", <span className="font-mono text-2xs">{view.user_id || "—"}</span>],
    ["密钥", <span className="font-mono text-2xs">{view.api_key_label || "—"}</span>],
    ["密钥 ID", <span className="font-mono text-2xs">{view.api_key_id || "—"}</span>],
    ["用户组", rawValue(raw, "agentgateway_group")],
  ];

  const timingFields: Array<[string, ReactNode]> = [
    ["开始时间", formatDateTime(view.started_at_ms, timezone)],
    ["完成时间", formatDateTime(view.completed_at_ms, timezone)],
    ["总耗时", fmtSeconds(view.duration_ms)],
    ["首字（TTFT）", fmtSeconds(view.time_to_first_token_ms)],
    ["吞吐", view.throughput_tps ? fmtThroughput(view.throughput_tps) + " 词元/s" : "—"],
    ["流式", view.is_stream ? "是" : "否"],
    ["状态码", <Badge tone={statusTone(view.http_status)}>{statusLabel(view.http_status)}</Badge>],
  ];

  const usageFields: Array<[string, ReactNode]> = [
    ["输入词元", fmtInt(view.input_tokens)],
    ["输出词元", fmtInt(view.output_tokens)],
    ["总词元", fmtInt(view.total_tokens)],
    ["缓存读词元", fmtInt(view.cache_read_tokens)],
    ["缓存写词元", fmtInt(view.cache_write_tokens)],
    ["缓存命中比例", fmtPctPoint(view.cache_ratio)],
  ];

  const traceFields: Array<[string, ReactNode]> = [
    ["操作", rawValue(raw, "gen_ai_operation_name")],
    ["请求模型（原始）", rawValue(raw, "gen_ai_request_model")],
    ["响应模型（原始）", rawValue(raw, "gen_ai_response_model")],
    ["Trace", rawValue(raw, "trace_id")],
    ["Span", rawValue(raw, "span_id")],
    ["数据面用户", rawValue(raw, "agentgateway_user")],
    ["含载荷", view.has_payload ? "是" : "否"],
  ];

  const margin = view.margin_micro;
  const showMoney = canCost || canSpend;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        size="xl"
        className="gap-0 overflow-y-auto p-0"
      >
        <SheetHeader className="sticky top-0 z-10 border-b border-border bg-surface p-4 pr-12">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <SheetTitle className="text-base">请求详情</SheetTitle>
              <SheetDescription className="mt-1 truncate font-mono text-2xs">
                {row.event_id}
              </SheetDescription>
            </div>
            <Button variant="outline" size="sm" onClick={() => void copyId()}>
              <Copy className="h-3.5 w-3.5" />
              复制 ID
            </Button>
          </div>
        </SheetHeader>

        <div className="space-y-4 p-4">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={statusTone(view.http_status)}>{statusLabel(view.http_status)}</Badge>
            <span className="text-sm font-medium text-title">{view.requested_model || "—"}</span>
            <span className="text-faint">→</span>
            <span className="text-sm text-body">{upstreamLabel(view)}</span>
            {view.is_stream ? <Badge tone="info">流式</Badge> : null}
            {view.cache_ratio ? <Badge tone="info">缓存 {fmtPctPoint(view.cache_ratio)}</Badge> : null}
            <span className="ml-auto text-2xs text-faint">{formatDateTime(view.started_at_ms, timezone)}</span>
          </div>

          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-2xs text-faint">
            <span>
              用户 <span className="text-body">{view.user_name || "—"}</span>
            </span>
            <span>
              密钥 <span className="font-mono text-body">{view.api_key_label || "—"}</span>
            </span>
            <span>
              吞吐 <span className="text-body">{view.throughput_tps ? fmtThroughput(view.throughput_tps) + " 词元/s" : "—"}</span>
            </span>
          </div>

          {rowErrorText(view) ? (
            <Alert variant="destructive">
              <AlertTitle>请求失败</AlertTitle>
              <AlertDescription className="break-all font-mono text-2xs">{rowErrorText(view)}</AlertDescription>
            </Alert>
          ) : null}

          <TraceChainSection
            eventId={view.event_id}
            hasAttempts={row.has_attempts}
            totalDurationMs={view.duration_ms}
          />

          {showMoney ? (
            <div className="space-y-2">
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {canSpend ? (
                  <MoneyCard
                    label="花费（向用户）"
                    hint="按下游价目表计算，改价不重算历史"
                    micro={view.charge_micro}
                    currency={currency}
                    estimate={view.estimate}
                  />
                ) : null}
                {canCost ? (
                  <MoneyCard
                    label="成本（付上游）"
                    hint="按上游价目表计算，与花费是两本账"
                    micro={view.cost_micro}
                    currency={currency}
                    estimate={view.estimate}
                  />
                ) : null}
              </div>
              {canCost ? (
                <p className="text-2xs text-faint">
                  毛利{" "}
                  <span className="tnum text-body">
                    {margin === undefined || margin === null ? "—" : fmtMoneyAvg(margin, currency)}
                  </span>{" "}
                  · 花费 − 成本
                </p>
              ) : null}
            </div>
          ) : null}

          {detailQuery.isPending ? (
            <div className="space-y-2">
              <Skeleton className="h-5 w-40" />
              <div className="grid grid-cols-2 gap-2">
                <Skeleton className="h-12 w-full" />
                <Skeleton className="h-12 w-full" />
                <Skeleton className="h-12 w-full" />
                <Skeleton className="h-12 w-full" />
              </div>
            </div>
          ) : detailQuery.isError ? (
            <Alert variant="destructive">
              <AlertTitle>详情加载失败</AlertTitle>
              <AlertDescription className="space-y-2">
                <p>{detailQuery.error instanceof Error ? detailQuery.error.message : "未知错误"}</p>
                <Button variant="outline" size="sm" onClick={() => void detailQuery.refetch()}>
                  <RefreshCw className="h-3.5 w-3.5" />
                  重试
                </Button>
              </AlertDescription>
            </Alert>
          ) : detail ? (
            <div className="space-y-3">
              <CollapsibleSection title="耗时与状态" defaultOpen>
                <FieldGrid items={timingFields} />
              </CollapsibleSection>

              <CollapsibleSection title="词元用量" defaultOpen>
                <FieldGrid items={usageFields} />
              </CollapsibleSection>

              <CollapsibleSection title="模型与路由" defaultOpen>
                <FieldGrid items={targetFields} />
              </CollapsibleSection>

              <CollapsibleSection title="用户与密钥" defaultOpen>
                <FieldGrid items={identityFields} />
              </CollapsibleSection>

              <CollapsibleSection title="请求与响应">
                <FieldGrid items={traceFields} />
              </CollapsibleSection>

              <PayloadSection key={view.event_id} eventId={view.event_id} />

              <CollapsibleSection title="原始载荷（raw JSON）">
                {rawPretty ? (
                  <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-all rounded-md bg-surface-2 p-3 font-mono text-2xs text-body">
                    {rawPretty}
                  </pre>
                ) : (
                  <p className="text-2sm text-faint">
                    该记录没有可解析的原始载荷（has_payload=false 或详情接口未返回 raw_json）。
                  </p>
                )}
              </CollapsibleSection>
            </div>
          ) : (
            <p className="text-2sm text-faint">暂无详情字段。点击重试重新拉取。</p>
          )}

          {detailQuery.isFetching && !detailQuery.isPending ? (
            <div className="flex items-center gap-2 text-2xs text-faint">
              <Spinner size="sm" />
              正在刷新详情
            </div>
          ) : null}
        </div>
      </SheetContent>
    </Sheet>
  );
}

/**
 * 日志详情「路由链」区（ADR-028 / ticket 04）：与列表 popover 共用
 * request-attempt-chain 的查询与展示组件，两处数据一致；没有尝试记录时明确
 * 显示「无链路记录」而不是留空。
 */
function TraceChainSection({
  eventId,
  hasAttempts,
  totalDurationMs,
}: {
  eventId: string;
  /** 列表行的 has_attempts：false 时无需再请求，直接给出降级文案。 */
  hasAttempts?: boolean;
  totalDurationMs?: number;
}) {
  const attemptsQuery = useLogAttempts(eventId, hasAttempts !== false);
  const attempts = attemptsQuery.data?.attempts ?? [];
  return (
    <CollapsibleSection title="路由链" defaultOpen>
      {hasAttempts === false ? (
        <NoChainRecord />
      ) : attemptsQuery.isPending ? (
        <p className="flex items-center gap-2 text-2xs text-faint">
          <Spinner size="sm" />
          正在加载路由链
        </p>
      ) : attemptsQuery.isError ? (
        <p className="text-2xs text-danger-text">
          路由链加载失败：
          {attemptsQuery.error instanceof Error ? attemptsQuery.error.message : "未知错误"}
        </p>
      ) : (
        <RequestAttemptChain attempts={attempts} totalDurationMs={totalDurationMs} />
      )}
    </CollapsibleSection>
  );
}

/**
 * 请求与响应正文节（ADR-021）：展开该节才请求 GET /admin/logs/{id}/payload；
 * 两个折叠块分别展示请求 prompt 与响应 completion，超出 200 KB 截断展示。
 */
function PayloadSection({ eventId }: { eventId: string }) {
  const [open, setOpen] = useState(false);
  const payloadQuery = useQuery({
    queryKey: ["log-payload", eventId],
    queryFn: ({ signal }) =>
      api.get<LogPayload>("/admin/logs/" + encodeURIComponent(eventId) + "/payload", { signal }),
    enabled: open,
    staleTime: 30_000,
    retry: false,
  });

  const payload = payloadQuery.data;
  // 懒序列化：展开后拿到数据才算一次，不在每次渲染重复 stringify 大正文。
  const prompt = useMemo(() => prettyPayload(payload?.request_prompt_json), [payload?.request_prompt_json]);
  const completion = useMemo(
    () => prettyPayload(payload?.response_completion_json),
    [payload?.response_completion_json],
  );

  const isNotFound = payloadQuery.error instanceof ApiError && payloadQuery.error.status === 404;

  return (
    <CollapsibleSection title="请求与响应正文" open={open} onOpenChange={setOpen}>
      {payloadQuery.isPending ? (
        <div className="space-y-2">
          <Skeleton className="h-6 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      ) : payloadQuery.isError ? (
        isNotFound ? (
          <div className="rounded-md border border-border bg-surface-2 p-3 text-2sm text-body">
            未记录正文：需在 运营设置 开启请求/响应正文记录（ag_access_log_llm=full）。
            <Link
              to="/ops-settings/system"
              className="ml-1 text-primary hover:underline"
            >
              前往运营设置
            </Link>
          </div>
        ) : (
          <div className="space-y-2">
            <p className="text-2sm text-danger-text">
              正文加载失败：{payloadQuery.error instanceof Error ? payloadQuery.error.message : "未知错误"}
            </p>
            <Button variant="outline" size="sm" onClick={() => void payloadQuery.refetch()}>
              <RefreshCw className="h-3.5 w-3.5" />
              重试
            </Button>
          </div>
        )
      ) : payload ? (
        <div className="space-y-2">
          <PayloadBlock title="请求 prompt" content={prompt} />
          <PayloadBlock title="响应 completion" content={completion} />
        </div>
      ) : null}
    </CollapsibleSection>
  );
}

function PayloadBlock({ title, content }: { title: string; content: PrettyPayload }) {
  return (
    <Collapsible defaultOpen className="rounded-md border border-border">
      <CollapsibleTrigger className="group flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-2sm font-medium text-title hover:bg-surface-2">
        {title}
        <ChevronDown className="h-3.5 w-3.5 shrink-0 text-faint transition-transform group-data-[state=open]:rotate-180" />
      </CollapsibleTrigger>
      <CollapsibleContent className="border-t border-border">
        {content.empty ? (
          <p className="p-3 text-2sm text-faint">（空）</p>
        ) : (
          <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-all p-3 font-mono text-2xs text-body">
            {content.text}
          </pre>
        )}
        {content.truncated ? (
          <p className="border-t border-border px-3 py-2 text-2xs text-warning-text">
            已截断：正文超过 200 KB，仅展示前 200 KB。
          </p>
        ) : null}
      </CollapsibleContent>
    </Collapsible>
  );
}

function MoneyCard({
  label,
  hint,
  micro,
  currency,
  estimate,
}: {
  label: string;
  hint: string;
  micro: number | null | undefined;
  currency: string;
  estimate: boolean;
}) {
  // W5-D2：单请求金额 4 位小数（表格/汇总才是 2 位，见 fmtMoney）。
  return (
    <div className="rounded-lg border border-border bg-surface-2 p-3">
      <p className="text-2xs text-faint">{label}</p>
      {micro === null || micro === undefined ? (
        <div className="mt-1">
          <Badge tone="warning">待补价</Badge>
        </div>
      ) : (
        <p className="mt-1 text-lg font-semibold tabular-nums text-title">
          {fmtMoneyAvg(micro, currency)}
        </p>
      )}
      <p className="mt-1 text-2xs text-faint">
        {hint}
        {estimate ? " · 估算值，以后端账本为准" : ""}
      </p>
    </div>
  );
}

function CollapsibleSection({
  title,
  defaultOpen = false,
  open,
  onOpenChange,
  children,
}: {
  title: string;
  defaultOpen?: boolean;
  /** 传入即受控（正文节用它做懒加载开关）；不传保持原非受控行为。 */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  children: ReactNode;
}) {
  const controlled = open !== undefined ? { open, onOpenChange } : {};
  return (
    <Collapsible defaultOpen={defaultOpen} {...controlled} className="rounded-lg border border-border">
      <CollapsibleTrigger className="group flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-2sm font-medium text-title hover:bg-surface-2">
        {title}
        <ChevronDown className="h-3.5 w-3.5 shrink-0 text-faint transition-transform group-data-[state=open]:rotate-180" />
      </CollapsibleTrigger>
      <CollapsibleContent className="border-t border-border px-3 py-3">
        {children}
      </CollapsibleContent>
    </Collapsible>
  );
}

function FieldGrid({ items }: { items: Array<[string, ReactNode]> }) {
  return (
    <dl className="grid grid-cols-1 gap-x-4 gap-y-2 sm:grid-cols-2">
      {items.map(([label, value]) => (
        <div key={label} className="min-w-0">
          <dt className="text-2xs text-faint">{label}</dt>
          <dd className="mt-0.5 break-all text-2sm text-body">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function parseRawRecord(raw: string | undefined): Record<string, unknown> | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    return null;
  }
  return null;
}

function rawValue(record: Record<string, unknown> | null, key: string): string {
  if (!record) return "—";
  const value = record[key];
  if (value === null || value === undefined) return "—";
  if (typeof value === "string") return value || "—";
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
