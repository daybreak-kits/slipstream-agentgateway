import { ChevronDown, GitBranch } from "lucide-react";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Spinner } from "@/components/ui/spinner";
import type { LogAttemptOut } from "@/generated/contract";
import { fmtSeconds } from "@/lib/format";
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

/** 上游密钥序号来自 provider ref 的 #N 后缀；显示为「上游标志#N」，与源密钥编号一致。 */
function attemptUpstreamLabel(attempt: LogAttemptOut): string {
  const ref = attempt.upstream_ref || "";
  const hash = ref.lastIndexOf("#");
  const seq = hash >= 0 ? ref.slice(hash + 1) : "";
  const name = attempt.upstream_name || ref || "-";
  if (!seq) return name;
  return name.endsWith("#" + seq) ? name : name + "#" + seq;
}

/** 无尝试记录：明确告诉运营者这是数据缺失，不是「没有重试」。 */
export function NoChainRecord() {
  return <p className="text-2xs text-faint">{NO_CHAIN_RECORD_TEXT}</p>;
}

/**
 * 请求尝试链展示（ticket 04 / ADR-028；W7-D6 收进模型格）：列表 popover 与日志详情
 * 抽屉共用本组件，两处数据都来自 GET /admin/logs/{id}/attempts，不各自拼一份。
 * 折叠行给「轮次 · 上游渠道 · 实际模型 · 状态码 · 耗时 · 错误摘要」，整行可点/可键盘
 * 展开——详情（上游地址、错误类型、开始时间与错误全文）收在展开区，长错误不塞折叠行。
 */
export function RequestAttemptChain({
  attempts,
  totalDurationMs,
}: {
  attempts: LogAttemptOut[];
  /** 行总耗时；缺省时用各次尝试耗时之和。 */
  totalDurationMs?: number;
}) {
  if (attempts.length === 0) return <NoChainRecord />;
  const totalMs =
    totalDurationMs ?? attempts.reduce((sum, attempt) => sum + (attempt.duration_ms ?? 0), 0);
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <p className="text-2xs font-medium text-title">路由链</p>
        <p className="text-2xs text-faint">
          总耗时 <span className="tnum text-body">{fmtSeconds(totalMs)}</span>
        </p>
      </div>
      <ol className="space-y-1">
        {attempts.map((attempt) => {
          const failed = attemptFailed(attempt);
          const upstreamLabel = attemptUpstreamLabel(attempt);
          const row = (
            <>
              <span
                aria-hidden="true"
                className={cn(
                  "absolute -left-[3px] top-2 h-1.5 w-1.5 rounded-full",
                  attemptDotClass(attempt.status_code),
                )}
              />
              <span className="font-medium text-title">第 {attempt.attempt} 轮：</span>
              <Badge tone={attemptTone(attempt.status_code)}>
                {attempt.status_code === null || attempt.status_code === undefined
                  ? "无状态"
                  : attempt.status_code}
              </Badge>
              <span className="text-faint">·</span>
              <span className="text-body" title={attempt.upstream_ref || undefined}>
                {upstreamLabel}
              </span>
              {attempt.model ? (
                <>
                  <span className="text-faint">/</span>
                  <span className="font-mono text-body">{attempt.model}</span>
                </>
              ) : null}
              <span className="ml-auto tnum text-body">{fmtSeconds(attempt.duration_ms ?? 0)}</span>
              {failed ? (
                <ChevronDown
                  className="h-3 w-3 shrink-0 text-faint transition-transform group-open:rotate-180"
                  aria-hidden="true"
                />
              ) : null}
            </>
          );
          return (
            <li
              key={attempt.attempt + "-" + (attempt.started_at_ms ?? 0)}
              data-slot="attempt-row"
              data-attempt-no={attempt.attempt}
              className="relative border-l border-border pl-3"
            >
              {failed ? (
                <details data-slot="attempt-detail" data-attempt-no={attempt.attempt} className="group">
                  <summary className="flex w-full cursor-pointer list-none flex-wrap items-center gap-x-2 gap-y-1 rounded text-2xs marker:hidden hover:bg-surface-2/60">
                    {row}
                  </summary>
                  <div
                    data-slot="attempt-detail-body"
                    className="mt-1 rounded-md border border-border bg-surface-2/60 px-2 py-1.5"
                  >
                    <p className="whitespace-pre-wrap break-all text-2xs text-danger-text">
                      {"错误：" + (attempt.error_message || attemptErrorSummary(attempt) || "未记录错误详情")}
                    </p>
                    <p className="mt-1 break-all font-mono text-2xs text-faint">
                      {"上游地址：" + (attempt.upstream_ref || "-")}
                    </p>
                  </div>
                </details>
              ) : (
                <div className="flex w-full flex-wrap items-center gap-x-2 gap-y-1 rounded text-2xs">
                  {row}
                </div>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

/**
 * 日志模型格旁的分叉图标（W7-D6）：只有存在尝试的行才渲染；图标 + aria-label（纯图标
 * 按钮惯例），点开才请求路由链（懒加载），数据与详情抽屉共用同一 query key。
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
  const label = "查看 " + attemptsCount + " 次尝试的路由链";
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="dense"
          className="h-6 w-auto shrink-0 gap-1 px-1.5 text-info-text"
          data-slot="log-attempts-trigger"
          data-event-id={eventId}
          aria-label={label}
          title={label}
        >
          <GitBranch className="h-3.5 w-3.5" aria-hidden="true" />
          <span className="text-faint" aria-hidden="true">
            ·
          </span>
          <span className="text-2xs">尝试 {attemptsCount} 次</span>
        </Button>
      </PopoverTrigger>
      {/* 展开错误全文会把内容撑高：限高在可用空间内滚动，长错误不被裁掉（W7 US 32）。 */}
      <PopoverContent
        align="start"
        className="max-h-[min(70vh,var(--radix-popover-content-available-height))] w-[min(92vw,480px)] overflow-y-auto p-3"
        data-slot="log-attempts-popover"
      >
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
