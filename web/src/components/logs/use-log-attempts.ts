import { useQuery } from "@tanstack/react-query";

import type { LogAttemptsOut } from "@/generated/contract";
import { api, ENDPOINTS } from "@/lib/api";

/**
 * GET /admin/logs/{event_id}/attempts（ADR-028）：列表 popover 与详情抽屉共用同一
 * query key，两处路由链数据来自同一份缓存，不会互相矛盾。
 */
export function useLogAttempts(eventId: string, enabled = true) {
  return useQuery({
    queryKey: ["log-attempts", eventId],
    queryFn: ({ signal }) =>
      api.get<LogAttemptsOut>(ENDPOINTS.logAttempts(eventId), { signal }),
    enabled: enabled && eventId.length > 0,
    staleTime: 30_000,
    retry: false,
  });
}
