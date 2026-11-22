import { beforeEach, describe, expect, it, vi } from "vitest";

import type { LogListQuery } from "./operations/logs";
import type { MemoryLogsModule, MemoryUsersModule } from "./test-helpers";

const baseQuery: LogListQuery = {
  query: "",
  pageSize: 50,
  offset: 0,
  sort: "started_at_ms",
  order: "desc",
};

let logs: MemoryLogsModule;
let users: MemoryUsersModule;

beforeEach(async () => {
  vi.resetModules();
  logs = (await import("./memory-logs")) as unknown as MemoryLogsModule;
  users = (await import("./memory-users")) as unknown as MemoryUsersModule;
});

describe("内存日志域", () => {
  it("空查询按时间倒序返回首页并带 next_offset", async () => {
    const page = await logs.createMemoryLogs().list({ ...baseQuery, pageSize: 10 });
    expect(page.items).toHaveLength(10);
    expect(page.total).toBeGreaterThan(10);
    expect(page.next_offset).toBe(10);
    const times = page.items.map((row) => row.started_at_ms);
    expect([...times].sort((a, b) => b - a)).toEqual(times);
  });

  it("关键词与字段过滤和 fixtures 的查询语义一致", async () => {
    const api = logs.createMemoryLogs();
    const glm = await api.list({ ...baseQuery, query: "model:glm-5.3" });
    expect(glm.items.length).toBeGreaterThan(0);
    expect(glm.items.every((row) => row.public_model === "glm-5.3" || row.requested_model === "glm-5.3")).toBe(true);

    const failed = await api.list({ ...baseQuery, hasError: true });
    expect(failed.items.length).toBeGreaterThan(0);
    expect(failed.items.every((row) => row.has_error)).toBe(true);
  });

  it("分页边界：offset 越界返回空页", async () => {
    const api = logs.createMemoryLogs();
    const page = await api.list({ ...baseQuery, offset: 10_000 });
    expect(page.items).toEqual([]);
    expect(page.next_offset).toBeNull();
  });

  it("详情不存在返回 404 ApiError", async () => {
    const api = logs.createMemoryLogs();
    await expect(api.detail("ev_missing")).rejects.toMatchObject({ status: 404, code: "not_found" });
  });

  it("正文缺失与存在两种路径", async () => {
    const api = logs.createMemoryLogs();
    const page = await api.list({ ...baseQuery, pageSize: 200 });
    const withoutPayload = page.items.find((row) => !row.has_payload);
    expect(withoutPayload).toBeDefined();
    await expect(api.payload(withoutPayload!.event_id)).rejects.toMatchObject({ status: 404 });

    const withPayload = page.items.find((row) => row.has_payload);
    expect(withPayload).toBeDefined();
    const payload = await api.payload(withPayload!.event_id);
    expect(payload.event_id).toBe(withPayload!.event_id);
    expect(typeof payload.request_prompt_json).toBe("string");
    expect(typeof payload.response_completion_json).toBe("string");
  });

  it("尝试链用 correlation_key 关联，无链时返回空数组", async () => {
    const api = logs.createMemoryLogs();
    const page = await api.list({ ...baseQuery, pageSize: 200 });
    const retried = page.items.find((row) => row.correlation_key === "cor_m5b_retry");
    expect(retried).toBeDefined();
    const chain = await api.attempts(retried!.event_id);
    expect(chain.event_id).toBe(retried!.event_id);
    expect(chain.correlation_key).toBe("cor_m5b_retry");
    expect(chain.attempts?.length).toBeGreaterThan(1);

    const plain = page.items.find((row) => row.attempts_count === 0 && !row.has_attempts);
    if (plain) {
      const empty = await api.attempts(plain.event_id);
      expect(empty.attempts).toEqual([]);
    }
  });

  it("查询语法返回契约词条（token/meaning/example）", async () => {
    const syntax = await logs.createMemoryLogs().querySyntax();
    expect(syntax.tokens.length).toBeGreaterThan(6);
    for (const token of syntax.tokens) {
      expect(token.token.length).toBeGreaterThan(0);
      expect(token.meaning.length).toBeGreaterThan(0);
      expect(token.example.length).toBeGreaterThan(0);
    }
    expect(syntax.tokens.some((token) => token.token.startsWith("model:"))).toBe(true);
  });
});

describe("内存用户域", () => {
  it("列表隐藏软删除用户，树给出可见森林根", async () => {
    const api = users.createMemoryUsers();
    const list = await api.list();
    expect(list.length).toBeGreaterThan(0);
    expect(list.every((user) => user.status !== "deleted")).toBe(true);

    const tree = await api.tree();
    expect(tree.total).toBe(list.length);
    expect(tree.nodes).toHaveLength(list.length);
    expect(tree.root_ids.length).toBeGreaterThan(0);
    expect(tree.root_id).toBe(tree.root_ids[0] ?? null);
  });
});
