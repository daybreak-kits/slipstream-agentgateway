import { describe, expect, it } from "vitest";

import {
  ApiError,
  NO_HTTP_STATUS,
  apiErrorFromResponse,
  errorMessage,
  isAbortError,
  networkError,
  parseErrorBody,
  timeoutError,
} from "./errors";

describe("parseErrorBody", () => {
  it("解析后端统一错误信封 {code,message,request_id,details}", () => {
    const raw = JSON.stringify({
      code: "UPSTREAM_NOT_FOUND",
      message: "上游不存在",
      request_id: "req_01HXYZ",
      details: { id: "up_99" },
    });
    const err = parseErrorBody(404, "Not Found", raw);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(404);
    expect(err.code).toBe("UPSTREAM_NOT_FOUND");
    expect(err.message).toBe("上游不存在");
    expect(err.requestId).toBe("req_01HXYZ");
    expect(err.details).toEqual({ id: "up_99" });
  });

  it("details.errors 字符串数组拼成可展示的多行文案", () => {
    const err = parseErrorBody(
      422,
      "Unprocessable Entity",
      JSON.stringify({ code: "validation_error", message: "参数不合法", details: { errors: ["base_url 必填"] } }),
    );
    expect(err.errorLines()).toEqual(["base_url 必填"]);
  });

  it("没有 details.errors 时 errorLines 为空数组", () => {
    expect(parseErrorBody(500, "Internal Server Error", "").errorLines()).toEqual([]);
  });

  it("纯文本错误体（401 等）原样展示并截到 200 字", () => {
    const err = parseErrorBody(401, "Unauthorized", "x".repeat(500));
    expect(err.status).toBe(401);
    expect(err.code).toBe("http_401");
    expect(err.message).toHaveLength(200);
  });

  it("空响应体回退到 statusText 与 http_<status>", () => {
    const err = parseErrorBody(503, "Service Unavailable", "");
    expect(err.code).toBe("http_503");
    expect(err.message).toBe("Service Unavailable");
    expect(err.requestId).toBe("");
    expect(err.details).toEqual({});
  });

  it("JSON 字段类型不对时逐字段回退，不整体丢弃", () => {
    const raw = JSON.stringify({ code: 42, message: "", request_id: null, details: "nope" });
    const err = parseErrorBody(400, "Bad Request", raw);
    expect(err.code).toBe("http_400");
    expect(err.message).toBe("Bad Request");
    expect(err.requestId).toBe("");
    expect(err.details).toEqual({});
  });
});

describe("apiErrorFromResponse", () => {
  it("读取 fetch Response 的状态码与 JSON 错误体", async () => {
    const response = new Response(JSON.stringify({ code: "KEY_LIMIT", message: "最多 20 把密钥" }), {
      status: 409,
      statusText: "Conflict",
    });
    const err = await apiErrorFromResponse(response);
    expect(err.status).toBe(409);
    expect(err.code).toBe("KEY_LIMIT");
  });
});

describe("网络/超时错误", () => {
  it("networkError 用 status=0 标出没有 HTTP 响应", () => {
    const err = networkError("无法连接控制面 API");
    expect(err.status).toBe(NO_HTTP_STATUS);
    expect(err.code).toBe("network_error");
  });

  it("timeoutError 带路径与秒数文案", () => {
    const err = timeoutError("/admin/logs", 25_000);
    expect(err.code).toBe("timeout");
    expect(err.message).toContain("/admin/logs");
    expect(err.message).toContain("25s");
  });

  it("isAbortError 只认 AbortError/TimeoutError 两种 name", () => {
    expect(isAbortError(new DOMException("aborted", "AbortError"))).toBe(true);
    expect(isAbortError(new DOMException("timeout", "TimeoutError"))).toBe(true);
    expect(isAbortError(new ApiError(500, "internal", "boom"))).toBe(false);
    expect(isAbortError("AbortError")).toBe(false);
    expect(isAbortError(null)).toBe(false);
  });

  it("errorMessage 统一取可展示文案", () => {
    expect(errorMessage(new ApiError(500, "internal", "服务异常"))).toBe("服务异常");
    expect(errorMessage(new Error("普通错误"))).toBe("普通错误");
    expect(errorMessage("字符串错误")).toBe("字符串错误");
  });
});
