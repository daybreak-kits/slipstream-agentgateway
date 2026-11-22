import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/notify", () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn(), warning: vi.fn() } }));
vi.mock("@/lib/notification-store", () => ({ pushErrorNotificationOnce: vi.fn() }));

import { createHttpModels } from "./http-adapter";
import { controlPlane } from "./index";
import { createMemoryModels } from "./memory-adapter";

const noopRequest = async <T,>(_request: unknown): Promise<T> => ({}) as T;

describe("模型域两套适配器接口一致", () => {
  it("方法名集合一致（防止 mock 与真实实现漂移）", () => {
    const httpKeys = Object.keys(createHttpModels(noopRequest)).sort();
    expect(Object.keys(createMemoryModels()).sort()).toEqual(httpKeys);
    expect(Object.keys(controlPlane.models).sort()).toEqual(httpKeys);
  });
});
