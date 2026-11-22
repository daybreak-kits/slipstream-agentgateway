import { useQuery } from "@tanstack/react-query";

import { controlPlane } from "@/lib/control-plane";

/**
 * GET /admin/logs/{event_id}/attempts（ADR-028）：列表 popover 与详情抽屉共用同一
 * query key，两处路由链数据来自同一份缓存，不会互相矛盾。
 */
export function useLogAttempts(eventId: string, enabled = true) {
  return useQuery({
    queryKey: ["log-attempts", eventId],
    queryFn: ({ signal }) => controlPlane.logs.attempts(eventId, { signal }),
    enabled: enabled && eventId.length > 0,
    staleTime: 30_000,
    retry: false,
  });
}
