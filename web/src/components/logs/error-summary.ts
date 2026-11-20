/**
 * 日志错误摘要的唯一拼装入口（item 6）：服务层只回原始日志文本（error）与最近一次
 * 失败尝试的事实字段（last_failure_*），UI 在这里统一决定展示什么，避免服务层与前端
 * 各拼一份文案。纯函数模块，便于 SSR 门禁直接加载断言。
 */

/** 折叠行错误摘要的最大长度：摘要只用来扫读，全文在展开详情里。 */
const ERROR_SUMMARY_MAX_CHARS = 60;

/** 失败尝试的一行摘要：状态码 + 上游错误类型/文案，超过上限截断（全文在展开详情）。 */
export function attemptFailureSummary(
  status: number | null | undefined,
  errorType: string | null | undefined,
  errorMessage: string | null | undefined,
): string {
  const head = status === null || status === undefined ? "上游失败" : "upstream " + status;
  const message = (errorMessage ?? "").trim();
  const type = (errorType ?? "").trim();
  const detail = message || type;
  const summary = detail && detail !== String(status) ? head + ": " + detail : head;
  return summary.length > ERROR_SUMMARY_MAX_CHARS
    ? summary.slice(0, ERROR_SUMMARY_MAX_CHARS - 1) + "…"
    : summary;
}

/**
 * 列表行/详情抽屉的错误文案：原始日志文本优先；失败行（http_status>=400）缺失时用
 * 最近一次失败尝试的事实字段兜底；成功行即使首轮失败也不展示错误。
 */
export function rowErrorText(row: {
  error: string;
  http_status: number;
  has_attempts?: boolean;
  last_failure_status?: number | null;
  last_failure_error_type?: string;
  last_failure_error_message?: string;
}): string {
  if (row.error) return row.error;
  if (row.http_status < 400 || !row.has_attempts) return "";
  const status = row.last_failure_status;
  if (status === null || status === undefined) return "";
  return attemptFailureSummary(status, row.last_failure_error_type, row.last_failure_error_message);
}
