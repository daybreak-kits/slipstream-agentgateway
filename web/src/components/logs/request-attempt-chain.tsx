import { ChevronDown, GitBranch } from "lucide-react";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Spinner } from "@/components/ui/spinner";
import type { LogAttemptOut } from "@/generated/contract";
import { fmtInt, fmtSeconds } from "@/lib/format";
import { formatDateTime, useTimezone } from "@/lib/time";
import { cn } from "@/lib/utils";

import { attemptFailureSummary } from "./error-summary";
import { statusTone } from "./format";
import { useLogAttempts } from "./use-log-attempts";

/** 无尝试记录时的统一降级文案（列表、popover、抽屉三处一致）。 */
const NO_CHAIN_RECORD_TEXT = "无链路记录";

function attemptTone(status: number | null | undefined): ReturnType<typeof statusTone> {
  return status === null || status === undefined ? "neutral" : statusTone(status);
}

function attemptDotClass(status: number | null | undefined): string {
  const tone = attemptTone(status);
  if (tone === "success") return "bg-success";
  if (tone === "warning") return "bg-warning";
  if (tone === "danger") return "bg-danger";
  return "bg-border-strong";
}

function attemptFailed(attempt: LogAttemptOut): boolean {
  return attempt.outcome === "error" || (attempt.status_code ?? 0) >= 400;
}

/** 折叠行错误摘要：最后一次尝试的错误类型/文案压成一行（拼装规则见 error-summary）。 */
function attemptErrorSummary(attempt: LogAttemptOut): string {
  return attemptFailureSummary(attempt.status_code, attempt.error_type, attempt.error_message);
}

function outcomeLabel(outcome: string | undefined): string {
  if (outcome === "ok") return "成功";
  if (outcome === "error") return "失败";
  return "";
}

/** 无尝试记录：明确告诉运营者这是数据缺失，不是「没有重试」。 */
export function NoChainRecord() {
  return <p className="text-2xs text-faint">{NO_CHAIN_RECORD_TEXT}</p>;
}

/**
 * 请求尝试链展示（ticket 04 / ADR-028）：列表 popover 与日志详情抽屉共用本组件，
 * 两处数据都来自 GET /admin/logs/{id}/attempts，不各自拼一份。
 * 折叠行给「上游渠道 · 实际模型 · 状态码 · 耗时 · 错误摘要」；展开详情给状态码、
 * 耗时、上游地址、错误类型、开始时间与错误全文。
 */
export function RequestAttemptChain({
  attempts,
  totalDurationMs,
}: {
  attempts: LogAttemptOut[];
  /** 行总耗时；缺省时用各次尝试耗时之和。 */
  totalDurationMs?: number;
}) {
  const { mode } = useTimezone();
  if (attempts.length === 0) return <NoChainRecord />;
  const totalMs =
    totalDurationMs ?? attempts.reduce((sum, attempt) => sum + (attempt.duration_ms ?? 0), 0);
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <p className="text-2xs font-medium text-title">
          {"路由链 · " + fmtInt(attempts.length) + " 次尝试"}
        </p>
        <p className="text-2xs text-faint">
          总耗时 <span className="tnum text-body">{fmtSeconds(totalMs)}</span>
        </p>
      </div>
      <ol className="space-y-2">
        {attempts.map((attempt) => {
          const failed = attemptFailed(attempt);
          return (
            <li
              key={attempt.attempt + "-" + (attempt.started_at_ms ?? 0)}
              className="relative border-l border-border pl-3"
            >
              <span
                aria-hidden="true"
                className={cn(
                  "absolute -left-[3px] top-1.5 h-1.5 w-1.5 rounded-full",
                  attemptDotClass(attempt.status_code),
                )}
              />
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-2xs">
                <span className="font-medium text-title">第 {attempt.attempt} 轮</span>
                <span className="text-faint">→</span>
                <span className="text-body" title={attempt.upstream_ref || undefined}>
                  {attempt.upstream_name || attempt.upstream_ref || "—"}
                </span>
                {attempt.model ? (
                  <>
                    <span className="text-faint">·</span>
                    <span className="font-mono text-body">{attempt.model}</span>
                  </>
                ) : null}
                <span className="text-faint">·</span>
                <Badge tone={attemptTone(attempt.status_code)}>
                  {attempt.status_code === null || attempt.status_code === undefined
                    ? "无状态"
                    : attempt.status_code}
                </Badge>
                <span className="text-faint">·</span>
                <span className="tnum text-body">{fmtSeconds(attempt.duration_ms ?? 0)}</span>
                {failed ? (
                  <>
                    <span className="text-faint">·</span>
                    <span
                      className="max-w-[22rem] truncate text-danger-text"
                      title={attempt.error_message || attempt.error_type || attemptErrorSummary(attempt)}
                    >
                      {attemptErrorSummary(attempt)}
                    </span>
                  </>
                ) : null}
              </div>
              <details className="group mt-1">
                <summary className="flex w-fit cursor-pointer list-none items-center gap-1 rounded text-2xs text-faint hover:text-body">
                  <ChevronDown className="h-3 w-3 transition-transform group-open:rotate-180" />
                  详情
                </summary>
                <dl className="mt-1 grid grid-cols-1 gap-x-4 gap-y-1 rounded-md border border-border bg-surface-2/60 px-2 py-1.5 text-2xs sm:grid-cols-2">
                  <div className="min-w-0">
                    <dt className="text-faint">状态码</dt>
                    <dd className="text-body">
                      {attempt.status_code === null || attempt.status_code === undefined
                        ? "无状态"
                        : attempt.status_code}
                    </dd>
                  </div>
                  <div className="min-w-0">
                    <dt className="text-faint">耗时</dt>
                    <dd className="tnum text-body">{fmtSeconds(attempt.duration_ms ?? 0)}</dd>
                  </div>
                  <div className="min-w-0">
                    <dt className="text-faint">上游地址</dt>
                    <dd className="break-all font-mono text-body">
                      {attempt.upstream_ref || "—"}
                    </dd>
                  </div>
                  <div className="min-w-0">
                    <dt className="text-faint">错误类型</dt>
                    <dd className="break-all font-mono text-body">
                      {attempt.error_type || "—"}
                    </dd>
                  </div>
                  <div className="min-w-0">
                    <dt className="text-faint">开始时间</dt>
                    <dd className="tnum text-body">
                      {formatDateTime(attempt.started_at_ms, mode)}
                    </dd>
                  </div>
                  <div className="min-w-0">
                    <dt className="text-faint">结果</dt>
                    <dd className="text-body">{outcomeLabel(attempt.outcome) || "—"}</dd>
                  </div>
                </dl>
                {attempt.error_message ? (
                  <p className="mt-1 whitespace-pre-wrap break-all rounded-md bg-surface-2/60 px-2 py-1.5 text-2xs text-danger-text">
                    {"错误全文：" + attempt.error_message}
                  </p>
                ) : null}
              </details>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

/**
 * 日志列表「N 次尝试」按钮：只有存在尝试的行才渲染；点开才请求路由链（懒加载），
 * 数据与详情抽屉共用同一 query key，两处不会互相矛盾。
 */
export function RequestAttemptChainPopover({
  eventId,
  attemptsCount,
  totalDurationMs,
}: {
  eventId: string;
  attemptsCount: number;
  totalDurationMs?: number;
}) {
  const [open, setOpen] = useState(false);
  const attemptsQuery = useLogAttempts(eventId, open);
  const attempts = attemptsQuery.data?.attempts ?? [];
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="dense"
          className="h-6 gap-1 px-1.5 text-2xs text-info-text"
          aria-label={"查看 " + attemptsCount + " 次尝试的路由链"}
        >
          <GitBranch className="h-3 w-3" aria-hidden="true" />
          {fmtInt(attemptsCount) + " 次尝试"}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[min(92vw,480px)] p-3">
        {attemptsQuery.isPending ? (
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
      </PopoverContent>
    </Popover>
  );
}
