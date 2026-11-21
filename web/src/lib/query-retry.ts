/**
 * react-query 全局 retry 策略（W6 票07 错误治理）：查询 4xx 不自动重试，一次
 * 错误只出现一次；5xx 与网络类错误（无状态码）保留有限重试。
 *
 * 独立成模块是因为它是一个纯策略函数：main.tsx 的 QueryClient 配置与
 * scripts/check-ui-foundation.mjs 的 SSR 门禁都从这里取，不复制逻辑。
 */

/** 5xx/网络类错误的最大重试次数（4xx 永不重试）。 */
export const QUERY_RETRY_MAX = 1;

/** 4xx 是用户/资源错误（参数、权限、不存在）：重试只会原样再失败。 */
export function isClientErrorStatus(status: number): boolean {
  return status >= 400 && status < 500;
}

/** 从未知错误形状里读 HTTP 状态码：ApiError 有 status，超时/网络错误没有。 */
function statusOf(error: unknown): number | null {
  if (error && typeof error === "object" && "status" in error) {
    const status = (error as { status?: unknown }).status;
    if (typeof status === "number") return status;
  }
  return null;
}

/** QueryClient queries.retry：4xx 直接放弃，其余按 QUERY_RETRY_MAX 有限重试。 */
export function queryRetry(failureCount: number, error: unknown): boolean {
  const status = statusOf(error);
  if (status !== null && isClientErrorStatus(status)) return false;
  return failureCount < QUERY_RETRY_MAX;
}
