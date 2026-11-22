import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/notify", () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn(), warning: vi.fn() } }));
vi.mock("@/lib/notification-store", () => ({ pushErrorNotificationOnce: vi.fn() }));

import { createHttpControlPlane, createHttpUpstreams } from "./http-adapter";
import { controlPlane, isMockMode } from "./index";
import { createMemoryControlPlane, createMemoryUpstreams } from "./memory-adapter";

/** 任意载荷的假 transport：只用于接口形状对比，不关心返回值。 */
const noopRequest = async <T,>(_request: unknown): Promise<T> => ({}) as T;

const httpPlane = createHttpControlPlane({ request: noopRequest });
const memoryPlane = createMemoryControlPlane();

describe("两个适配器接口契约一致（同一组 vitest 跑两套实现，防 mock/真实漂移）", () => {
  it("上游域方法名集合一致", () => {
    const http = createHttpUpstreams(noopRequest);
    const memory = createMemoryUpstreams();
    const httpKeys = Object.keys(http).sort();
    expect(Object.keys(memory).sort()).toEqual(httpKeys);
    expect(Object.keys(controlPlane.upstreams).sort()).toEqual(httpKeys);
  });

  it("组合根默认走 HTTP（未设置 VITE_MOCK）", () => {
    expect(isMockMode).toBe(false);
  });

  it("全部领域：HTTP 与内存适配器的域集合一致", () => {
    const httpDomains = Object.keys(httpPlane).sort();
    expect(Object.keys(memoryPlane).sort()).toEqual(httpDomains);
    expect(Object.keys(controlPlane).sort()).toEqual(httpDomains);
  });

  it("全部领域：每个域的方法名集合一致", () => {
    for (const domain of Object.keys(httpPlane) as Array<keyof typeof httpPlane>) {
      expect(
        Object.keys(memoryPlane[domain]).sort(),
        "领域 " + String(domain) + " 的方法集合漂移",
      ).toEqual(Object.keys(httpPlane[domain]).sort());
    }
  });
});
