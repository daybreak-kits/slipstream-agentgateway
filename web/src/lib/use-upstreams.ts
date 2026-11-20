import { useQuery } from "@tanstack/react-query";

import { apiList, ENDPOINTS } from "@/lib/api";
import type { Upstream } from "@/types";

/** 上游列表（复用页面级 ["upstreams"] 缓存）：key_count 是 E20 提示的判断依据。 */
export function useUpstreams(): Upstream[] {
  const query = useQuery({ queryKey: ["upstreams"], queryFn: () => apiList<Upstream>(ENDPOINTS.upstreams) });
  return query.data?.items ?? [];
}
