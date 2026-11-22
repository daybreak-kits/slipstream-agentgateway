import { describe, expect, it, vi } from "vitest";

describe("日志域两适配器同形", () => {
  it("HTTP 与内存实现暴露同一组操作", async () => {
    vi.resetModules();
    const { createHttpLogs } = await import("./http-adapter");
    const { createMemoryLogs } = await import("./memory-logs");
    const { controlPlane } = await import("./index");
    const http = createHttpLogs(async <T,>() => ({}) as T);
    const memory = createMemoryLogs();
    expect(Object.keys(http).sort()).toEqual(Object.keys(memory).sort());
    expect(Object.keys(controlPlane.logs).sort()).toEqual(Object.keys(memory).sort());
  });
});

describe("用户域两适配器同形", () => {
  it("HTTP 与内存实现暴露同一组操作", async () => {
    vi.resetModules();
    const { createHttpUsers } = await import("./http-adapter");
    const { createMemoryUsers } = await import("./memory-users");
    const { controlPlane } = await import("./index");
    const http = createHttpUsers(async <T,>() => ({}) as T);
    const memory = createMemoryUsers();
    expect(Object.keys(http).sort()).toEqual(Object.keys(memory).sort());
    expect(Object.keys(controlPlane.users).sort()).toEqual(Object.keys(memory).sort());
  });
});
