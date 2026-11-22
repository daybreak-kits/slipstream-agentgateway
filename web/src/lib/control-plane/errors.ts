/**
 * 控制面统一错误类型（W4 票04「Web typed operations」）。
 *
 * 页面只消费 typed operations，不再自己拼 URL/解析 HTTP 错误：所有失败都在
 * 适配层归一为 ApiError —— HTTP 非 2xx（带后端 {code, message, request_id,
 * details} 形状）、网络不可达、超时。status=0 表示没有拿到 HTTP 响应。
 *
 * 本文件保持纯函数（不碰 window/fetch/toast），便于 node 环境直接单测。
 */

/** 没有 HTTP 响应时的 status（网络错误/超时）。 */
export const NO_HTTP_STATUS = 0;

/** 统一错误载荷：后端 FastAPI 错误中间件输出的 {code, message, request_id, details}。 */
export interface ApiErrorPayload {
  code?: string;
  message?: string;
  request_id?: string;
  details?: Record<string, unknown>;
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly requestId: string;
  readonly details: Record<string, unknown>;

  constructor(
    status: number,
    code: string,
    message: string,
    requestId = "",
    details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.requestId = requestId;
    this.details = details;
  }

  /** 后端校验错误在 details.errors（字符串数组）；拼成可展示的多行文案。 */
  errorLines(): string[] {
    const errors = this.details.errors;
    if (Array.isArray(errors)) return errors.map((item) => String(item));
    return [];
  }
}

/** 从原始响应体解析 ApiError：JSON 契约错误优先，纯文本（如 401 认证）原样展示。 */
export function parseErrorBody(status: number, statusText: string, raw: string): ApiError {
  let code = "http_" + status;
  let message = statusText || "请求失败";
  let requestId = "";
  let details: Record<string, unknown> = {};
  try {
    const body = JSON.parse(raw) as ApiErrorPayload;
    if (typeof body.code === "string" && body.code !== "") code = body.code;
    if (typeof body.message === "string" && body.message !== "") message = body.message;
    if (typeof body.request_id === "string") requestId = body.request_id;
    if (body.details && typeof body.details === "object") details = body.details;
  } catch {
    // 认证失败等返回纯文本（如 401 Unauthorized，text/plain）：原样展示，不硬套 JSON 形状。
    if (raw.trim() !== "") message = raw.trim().slice(0, 200);
  }
  return new ApiError(status, code, message, requestId, details);
}

/** 把 fetch 的 Response 归一为 ApiError（只用于非 2xx 分支）。 */
export async function apiErrorFromResponse(response: Response): Promise<ApiError> {
  return parseErrorBody(response.status, response.statusText, await response.text());
}

/** 网络不可达：ApiError(status=0, code="network_error")。 */
export function networkError(message: string): ApiError {
  return new ApiError(NO_HTTP_STATUS, "network_error", message);
}

/** 请求超时：ApiError(status=0, code="timeout")。 */
export function timeoutError(path: string, timeoutMs: number): ApiError {
  return new ApiError(
    NO_HTTP_STATUS,
    "timeout",
    path + " 超过 " + Math.round(timeoutMs / 1000) + "s 未响应",
  );
}

/** AbortError 判定：外部取消（切区间/换页/组件卸载）是控制流，不是业务错误。 */
export function isAbortError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const name = (error as { name?: unknown }).name;
  return name === "AbortError" || name === "TimeoutError";
}

/** 面向用户的错误文案：ApiError 用 message，其余兜底 String(error)。 */
export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error) return error.message;
  return String(error);
}
