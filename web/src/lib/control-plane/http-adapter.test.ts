import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/notify", () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn(), warning: vi.fn() } }));
vi.mock("@/lib/notification-store", () => ({ pushErrorNotificationOnce: vi.fn() }));

import { toast } from "@/lib/notify";
import { pushErrorNotificationOnce } from "@/lib/notification-store";

import { ApiError } from "./errors";
import { createHttpRequester, createHttpUpstreams, type HttpRequest, type HttpRequester } from "./http-adapter";

/** 捕获 requester：记录操作层拼出的 method/path/body/options，并返回给定载荷。 */
function capture(payload: unknown = {}): { calls: HttpRequest[]; request: HttpRequester } {
  const calls: HttpRequest[] = [];
  const request: HttpRequester = async <T,>(req: HttpRequest) => {
    calls.push(req);
    return payload as T;
  };
  return { calls, request };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("上游域 HTTP adapter 的路径与载荷", () => {
  it("list 把裸数组/信封都归一成数组", async () => {
    const bare = capture([{ id: "up_01" }]);
    await expect(createHttpUpstreams(bare.request).list()).resolves.toEqual([{ id: "up_01" }]);
    expect(bare.calls[0]).toMatchObject({ method: "GET", path: "/admin/upstreams" });

    const enveloped = capture({ items: [{ id: "up_02" }], total: 1 });
    await expect(createHttpUpstreams(enveloped.request).list()).resolves.toEqual([{ id: "up_02" }]);
  });

  it("单条 CRUD 用 encodeURIComponent 后的 id", async () => {
    const { calls, request } = capture({ id: "up_01" });
    const ops = createHttpUpstreams(request);
    await ops.get("up 01/x");
    await ops.remove("up 01/x");
    expect(calls[0]).toMatchObject({ method: "GET", path: "/admin/upstreams/up%2001%2Fx" });
    expect(calls[1]).toMatchObject({ method: "DELETE", path: "/admin/upstreams/up%2001%2Fx" });
  });

  it("create/update/batch 把请求体原样交给 transport", async () => {
    const { calls, request } = capture({});
    const ops = createHttpUpstreams(request);
    const create = { name: "", alias: "主站", base_url: "https://api.example.com", api_style: "auto", api_key: "sk-123456" };
    await ops.create(create);
    await ops.update("up_01", { enabled: false, name: "" });
    await ops.batch({ ids: ["up_01"], action: "enable" } as never);
    expect(calls[0]).toMatchObject({ method: "POST", path: "/admin/upstreams", body: create });
    expect(calls[1]).toMatchObject({ method: "PATCH", path: "/admin/upstreams/up_01", body: { enabled: false, name: "" } });
    expect(calls[2]).toMatchObject({ method: "PATCH", path: "/admin/upstreams/batch", body: { ids: ["up_01"], action: "enable" } });
  });

  it("discover/import/probe 走各自子路径并保留 options", async () => {
    const { calls, request } = capture({ items: [] });
    const ops = createHttpUpstreams(request);
    const signal = new AbortController().signal;
    await ops.discoverModels("up_01", { api_style: "openai_responses" });
    await ops.importModels("up_01", { names: ["glm-5.3"], model_type: "chat" });
    await ops.probeModels("up_01", { model_ids: ["um_01"], key_id: "uk_01" }, { signal, timeoutMs: 25_000 });
    expect(calls[0]).toMatchObject({ method: "POST", path: "/admin/upstreams/up_01/discover-models", body: { api_style: "openai_responses" } });
    expect(calls[1]).toMatchObject({ method: "POST", path: "/admin/upstreams/up_01/import-models" });
    expect(calls[2]).toMatchObject({
      method: "POST",
      path: "/admin/upstreams/up_01/models/probe",
      body: { model_ids: ["um_01"], key_id: "uk_01" },
      options: { signal, timeoutMs: 25_000 },
    });
  });

  it("密钥组操作路径", async () => {
    const { calls, request } = capture({ items: [], limit: 20 });
    const ops = createHttpUpstreams(request);
    await ops.listKeys("up_01");
    await ops.createKey("up_01", { label: "主", api_key: "sk-abc" });
    await ops.updateKey("up_01", "uk_01", { label: "备" });
    await ops.removeKey("up_01", "uk_01");
    await ops.batchDeleteKeys("up_01", { ids: ["uk_01", "uk_02"] });
    await ops.testKeys("up_01", { api_style: "auto" });
    expect(calls.map((call) => call.method + " " + call.path)).toEqual([
      "GET /admin/upstreams/up_01/keys",
      "POST /admin/upstreams/up_01/keys",
      "PATCH /admin/upstreams/up_01/keys/uk_01",
      "DELETE /admin/upstreams/up_01/keys/uk_01",
      "POST /admin/upstreams/up_01/keys/batch-delete",
      "POST /admin/upstreams/up_01/keys/test",
    ]);
  });

  it("改写规则 GET/PUT/preview", async () => {
    const { calls, request } = capture({ upstream_id: "up_01", transforms: {} });
    const ops = createHttpUpstreams(request);
    await ops.getTransforms("up_01");
    const empty = { request_headers: [], request_body: [], response_headers: [], response_body: [] };
    await ops.saveTransforms("up_01", empty);
    await ops.previewTransforms("up_01", empty);
    expect(calls.map((call) => call.method + " " + call.path)).toEqual([
      "GET /admin/upstreams/up_01/transforms",
      "PUT /admin/upstreams/up_01/transforms",
      "POST /admin/upstreams/up_01/transforms/preview",
    ]);
  });
});

describe("createHttpRequester", () => {
  it("2xx 返回 JSON，并带上同源 cookie 与 JSON 头", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: 1 }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const request = createHttpRequester({ baseUrl: "" });
    await expect(request({ method: "GET", path: "/admin/auth/me" })).resolves.toEqual({ ok: 1 });
    expect(fetchMock).toHaveBeenCalledWith(
      "/admin/auth/me",
      expect.objectContaining({ method: "GET", credentials: "include", headers: { "Content-Type": "application/json" } }),
    );
  });

  it("204 返回 undefined", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 204 })));
    await expect(createHttpRequester()({ method: "DELETE", path: "/admin/x" })).resolves.toBeUndefined();
  });

  it("401 抛 ApiError 且不上报（统一跳登录由 transport 处理）", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ code: "UNAUTHORIZED", message: "会话失效" }), { status: 401 })),
    );
    const error = await createHttpRequester()({ method: "GET", path: "/admin/logs" }).catch((err: unknown) => err);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(401);
    expect(toast.error).not.toHaveBeenCalled();
    expect(pushErrorNotificationOnce).not.toHaveBeenCalled();
  });

  it("GET 失败进通知中心（同因去重），写操作失败弹 toast", async () => {
    const body = JSON.stringify({ code: "INTERNAL", message: "服务器异常", request_id: "req_1" });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(body, { status: 500 })));
    await expect(createHttpRequester()({ method: "GET", path: "/admin/logs" })).rejects.toBeInstanceOf(ApiError);
    expect(pushErrorNotificationOnce).toHaveBeenCalledWith({
      title: "查询失败",
      description: "INTERNAL：服务器异常（request_id req_1）",
      dedupeKey: "INTERNAL|服务器异常",
    });
    expect(toast.error).not.toHaveBeenCalled();

    await expect(createHttpRequester()({ method: "POST", path: "/admin/x", body: {} })).rejects.toBeInstanceOf(ApiError);
    expect(toast.error).toHaveBeenCalledWith("请求失败", { description: "INTERNAL：服务器异常（request_id req_1）" });
  });

  it("网络不可达归一为 network_error 并上报", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new TypeError("Failed to fetch"))));
    const error = await createHttpRequester()({ method: "GET", path: "/admin/logs" }).catch((err: unknown) => err);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).code).toBe("network_error");
    expect(pushErrorNotificationOnce).toHaveBeenCalledWith(
      expect.objectContaining({ title: "无法连接控制面 API", dedupeKey: "network|无法连接控制面 API" }),
    );
  });

  it("超时归一为 timeout 并上报", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_url: string, init?: RequestInit) =>
          new Promise((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
          }),
      ),
    );
    const error = await createHttpRequester()({ method: "GET", path: "/admin/logs", options: { timeoutMs: 10 } }).catch(
      (err: unknown) => err,
    );
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).code).toBe("timeout");
    expect(pushErrorNotificationOnce).toHaveBeenCalledWith(expect.objectContaining({ title: "请求超时" }));
  });

  it("外部取消原样抛出、不归为网络错误", async () => {
    const controller = new AbortController();
    controller.abort();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        throw init?.signal?.reason ?? new DOMException("aborted", "AbortError");
      }),
    );
    const error = await createHttpRequester()({ method: "GET", path: "/admin/logs", options: { signal: controller.signal } }).catch(
      (err: unknown) => err,
    );
    expect((error as Error).name).toBe("AbortError");
    expect(pushErrorNotificationOnce).not.toHaveBeenCalled();
    expect(toast.error).not.toHaveBeenCalled();
  });

  // 注：redirectToLogin 在 node 环境（无 window）直接 return，401 跳转由页面冒烟覆盖。
});
