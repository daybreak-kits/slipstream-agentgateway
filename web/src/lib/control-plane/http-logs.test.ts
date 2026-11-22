import { describe, expect, it } from "vitest";

import { ApiError } from "./errors";
import { createHttpLogs } from "./http-adapter";
import type { HttpRequest, HttpRequester } from "./http-adapter";
import { createHttpUsers } from "./http-adapter";

function capture() {
  const calls: HttpRequest[] = [];
  const request: HttpRequester = async <T,>(req: HttpRequest) => {
    calls.push(req);
    return {} as T;
  };
  return { calls, request };
}

describe("createHttpLogs", () => {
  it("列表把查询映射成 URLSearchParams，不把 URL 细节留给页面", async () => {
    const { calls, request } = capture();
    const logs = createHttpLogs(request);
    await logs.list({
      query: "model:glm-5.3 status>=400",
      pageSize: 50,
      offset: 100,
      sort: "started_at_ms",
      order: "desc",
      fromMs: 1_700_000_000_000,
      toMs: 1_700_000_360_000,
      hasError: true,
    });
    const req = calls[0]!;
    expect(req.method).toBe("GET");
    expect(req.path).toContain("/admin/logs?");
    const params = new URLSearchParams(req.path.split("?")[1]);
    expect(params.get("query")).toBe("model:glm-5.3 status>=400");
    expect(params.get("page_size")).toBe("50");
    expect(params.get("offset")).toBe("100");
    expect(params.get("sort")).toBe("started_at_ms");
    expect(params.get("order")).toBe("desc");
    expect(params.get("from_ms")).toBe("1700000000000");
    expect(params.get("to_ms")).toBe("1700000360000");
    expect(params.get("has_error")).toBe("true");
  });

  it("缺省的可选过滤不写进查询串", async () => {
    const { calls, request } = capture();
    await createHttpLogs(request).list({
      query: "",
      pageSize: 20,
      offset: 0,
      sort: "started_at_ms",
      order: "desc",
    });
    const params = new URLSearchParams(calls[0]!.path.split("?")[1]);
    expect(params.has("from_ms")).toBe(false);
    expect(params.has("to_ms")).toBe(false);
    expect(params.has("has_error")).toBe(false);
  });

  it("详情/正文/尝试链/语法都走事件 id 编码后的路径", async () => {
    const { calls, request } = capture();
    const logs = createHttpLogs(request);
    await logs.detail("ev/1", { timeoutMs: 5000 });
    await logs.payload("ev/1");
    await logs.attempts("ev/1");
    await logs.querySyntax();
    expect(calls.map((call) => call.path)).toEqual([
      "/admin/logs/ev%2F1",
      "/admin/logs/ev%2F1/payload",
      "/admin/logs/ev%2F1/attempts",
      "/admin/logs/query-syntax",
    ]);
    expect(calls[0]!.options?.timeoutMs).toBe(5000);
  });

  it("透传 signal，取消由请求层统一处理", async () => {
    const { calls, request } = capture();
    const controller = new AbortController();
    await createHttpLogs(request).list(
      { query: "", pageSize: 10, offset: 0, sort: "started_at_ms", order: "desc" },
      { signal: controller.signal },
    );
    expect(calls[0]!.options?.signal).toBe(controller.signal);
  });
});

describe("createHttpUsers", () => {
  it("用户列表与树是两条只读路径", async () => {
    const { calls, request } = capture();
    const users = createHttpUsers(request);
    await users.list();
    await users.tree();
    expect(calls.map((call) => call.path)).toEqual(["/admin/users", "/admin/users/tree"]);
  });
});

describe("日志错误映射", () => {
  it("正文不存在时的 404 仍是 ApiError，页面可据此展示空态", () => {
    const error = new ApiError(404, "not_found", "该请求未记录正文", "rid-1");
    expect(error.status).toBe(404);
    expect(error.code).toBe("not_found");
    expect(error.message).toContain("该请求未记录正文");
  });
});
