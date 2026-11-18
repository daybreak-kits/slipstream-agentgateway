import { useQuery } from "@tanstack/react-query";
import type { QueryClient } from "@tanstack/react-query";

import { apiList, ENDPOINTS } from "@/lib/api";
import type { PublicModel, PublicModelPrice, Upstream, UpstreamModel, Vendor } from "@/types";

/**
 * 价目页共享 query key：改价/导入后统一失效。key 与模型管理、日志等页面保持同源，
 * 让价目变化直接刷掉它们的缓存（价目是派生值的单一真相源，ADR-020）。
 */
export const pricingKeys = {
  upstreamModels: ["upstream-models"] as const,
  upstreams: ["upstreams"] as const,
  vendors: ["vendors"] as const,
  cachePrices: ["prices-upstream"] as const,
  publicPrices: ["public-model-prices"] as const,
  publicModels: ["public-models"] as const,
};

/** 价目写路径（行内保存 / 批量改价 / JSON 导入 / 缓存价新版本）成功后统一失效。 */
export async function invalidatePricing(queryClient: QueryClient): Promise<void> {
  await Promise.all(
    Object.values(pricingKeys).map((key) => queryClient.invalidateQueries({ queryKey: key })),
  );
}

export function useUpstreamModels(enabled: boolean) {
  return useQuery({
    queryKey: pricingKeys.upstreamModels,
    queryFn: () => apiList<UpstreamModel>(ENDPOINTS.upstreamModels),
    enabled,
  });
}

export function useUpstreams(enabled: boolean) {
  return useQuery({
    queryKey: pricingKeys.upstreams,
    queryFn: () => apiList<Upstream>(ENDPOINTS.upstreams),
    enabled,
  });
}

export function useVendors(enabled: boolean) {
  return useQuery({
    queryKey: pricingKeys.vendors,
    queryFn: () => apiList<Vendor>(ENDPOINTS.vendors),
    enabled,
  });
}

export function usePublicModels(enabled: boolean) {
  return useQuery({
    queryKey: pricingKeys.publicModels,
    queryFn: () => apiList<PublicModel>(ENDPOINTS.publicModels),
    enabled,
  });
}

export function usePublicPrices(enabled: boolean) {
  return useQuery({
    queryKey: pricingKeys.publicPrices,
    queryFn: () => apiList<PublicModelPrice>(ENDPOINTS.pricesPublicModels),
    enabled,
  });
}
