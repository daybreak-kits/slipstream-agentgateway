/** 控制面 typed operations 的公共类型。 */

/** 单次操作的调用选项：signal 透传（react-query 换 key 自动取消旧请求）；timeoutMs=0 表示不设超时（流式用）。 */
export interface OperationOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
}

/** 列表信封：后端有的接口回裸数组，有的回 {items,total}；适配层统一归一化。 */
export interface ListEnvelope<T> {
  items: T[];
  total: number;
}

/** 裸数组 → {items,total}；已是信封则原样返回。 */
export function unwrapList<T>(payload: T[] | ListEnvelope<T>): ListEnvelope<T> {
  if (Array.isArray(payload)) return { items: payload, total: payload.length };
  return { items: payload.items, total: payload.total };
}
