import { beforeEach, describe, expect, it, vi } from "vitest";

import type * as FixturesModule from "./memory/fixtures";
import type * as MemoryModule from "./memory-adapter";

/**
 * 内存适配器行为套件：每个用例前重置模块，fixtures 回到初始状态，
 * 保证写操作不会在用例之间串味（与真实后端每次请求独立一致）。
 */
let memory: typeof MemoryModule;
let fixtures: typeof FixturesModule;

beforeEach(async () => {
  vi.resetModules();
  memory = await import("./memory-adapter");
  fixtures = await import("./memory/fixtures");
});

describe("上游读取", () => {
  it("list 返回 fixtures 全量并派生 model_count", async () => {
    const ops = memory.createMemoryUpstreams();
    const rows = await ops.list();
    expect(rows).toHaveLength(fixtures.upstreams.length);
    const row = rows.find((item) => item.id === "up_01");
    expect(row).toBeDefined();
    expect(row?.model_count).toBe(fixtures.upstreamModels.filter((model) => model.upstream_id === "up_01").length);
  });

  it("get 不存在的上游抛 ApiError 404 not_found", async () => {
    const ops = memory.createMemoryUpstreams();
    await expect(ops.get("up_zz")).rejects.toMatchObject({ name: "ApiError", status: 404, code: "not_found" });
  });

  it("读操作返回克隆：改返回值不会污染 fixtures", async () => {
    const ops = memory.createMemoryUpstreams();
    const first = await ops.get("up_01");
    first.name = "被页面改掉的名字";
    await expect(ops.get("up_01")).resolves.not.toHaveProperty("name", "被页面改掉的名字");
  });
});

describe("上游写入", () => {
  it("create 自动生成名称、归一 auto api_style、首把密钥可直接测试", async () => {
    const ops = memory.createMemoryUpstreams();
    const before = [...fixtures.upstreams];
    const created = await ops.create({
      name: "",
      alias: "",
      base_url: "https://api.newco.example/v1",
      api_style: "auto",
      api_key: "sk-test-123456",
      max_buffer_bytes: 1048576,
    });
    expect(created.name).toBe(fixtures.upstreamNameFromBaseUrl("https://api.newco.example/v1", before));
    expect(created.api_style).toBe("openai_chat");
    expect(created.enabled).toBe(true);
    const keys = await ops.listKeys(created.id);
    expect(keys.items).toHaveLength(1);
    expect(keys.items[0]).toMatchObject({ masked: "…3456", key_suffix: "3456" });
  });

  it("create 空连接地址抛 422", async () => {
    const ops = memory.createMemoryUpstreams();
    await expect(
      ops.create({ name: "", alias: "", base_url: "  ", api_style: "auto", api_key: "" }),
    ).rejects.toMatchObject({ status: 422, code: "validation_error" });
  });

  it("update 留空名称保持原名；enabled 与 transforms 落库", async () => {
    const ops = memory.createMemoryUpstreams();
    const original = await ops.get("up_01");
    const updated = await ops.update("up_01", { name: "  ", enabled: false, transforms: { request: [] } });
    expect(updated.name).toBe(original.name);
    expect(updated.enabled).toBe(false);
    expect(JSON.parse(updated.transforms ?? "null")).toEqual({ request: [] });
  });

  it("batch enable/disable/delete 与 missing 汇总", async () => {
    const ops = memory.createMemoryUpstreams();
    const batch = await ops.batch({ ids: ["up_01", "up_02", "up_zz"], action: "disable" });
    expect(batch.changed).toEqual(["up_01", "up_02"]);
    expect(batch.missing).toEqual(["up_zz"]);
    expect(batch.action).toBe("disable");
    const rows = await ops.list();
    expect(rows.find((row) => row.id === "up_01")?.enabled).toBe(false);

    const deleted = await ops.batch({ ids: ["up_03"], action: "delete" });
    expect(deleted.changed).toEqual(["up_03"]);
    await expect(ops.get("up_03")).rejects.toMatchObject({ status: 404 });
  });

  it("remove 后不可再读取", async () => {
    const ops = memory.createMemoryUpstreams();
    await ops.remove("up_02");
    await expect(ops.get("up_02")).rejects.toMatchObject({ status: 404, code: "not_found" });
  });
});

describe("源密钥组", () => {
  it("新增、改标签、批量删除", async () => {
    const ops = memory.createMemoryUpstreams();
    const created = await ops.createKey("up_01", { label: "主", api_key: "sk-primary-9999" });
    expect(created).toMatchObject({ label: "主", masked: "…9999", key_suffix: "9999", last_test: null });
    const relabeled = await ops.updateKey("up_01", created.id, { label: "备用" });
    expect(relabeled.label).toBe("备用");

    const result = await ops.batchDeleteKeys("up_01", { ids: [created.id, "uk_missing"] });
    expect(result.deleted).toBe(1);
    expect(result.items).toEqual([
      { key_id: created.id, ok: true },
      { key_id: "uk_missing", ok: false, error: "不存在" },
    ]);
  });

  it("重复密钥抛 409 DUPLICATE_KEY，超过 20 把抛 KEY_LIMIT", async () => {
    const ops = memory.createMemoryUpstreams();
    await ops.createKey("up_01", { label: "", api_key: "sk-same-0001" });
    await expect(ops.createKey("up_01", { label: "", api_key: "sk-same-0001" })).rejects.toMatchObject({
      status: 409,
      code: "DUPLICATE_KEY",
    });

    for (let index = 1; index <= 20; index += 1) {
      await ops.createKey("up_02", { label: "", api_key: "sk-bulk-" + String(index).padStart(4, "0") });
    }
    await expect(ops.createKey("up_02", { label: "", api_key: "sk-bulk-9999" })).rejects.toMatchObject({
      status: 409,
      code: "KEY_LIMIT",
    });
  });

  it("testKeys 回写 last_test，列表能读到最近结果", async () => {
    const ops = memory.createMemoryUpstreams();
    const created = await ops.createKey("up_01", { label: "", api_key: "sk-test-7777" });
    const result = await ops.testKeys("up_01");
    const item = result.items.find((row) => row.key_id === created.id);
    expect(item).toMatchObject({ ok: true, status_code: 200 });
    const list = await ops.listKeys("up_01");
    expect(list.items.find((row) => row.id === created.id)?.last_test?.ok).toBe(true);
  });

  it("testKeys 只测请求指定的行：单把 key_id / 批量 keys 写回对应行", async () => {
    const ops = memory.createMemoryUpstreams();
    const first = await ops.createKey("up_03", { label: "一", api_key: "sk-scope-0001" });
    const second = await ops.createKey("up_03", { label: "二", api_key: "sk-scope-0002" });
    const third = await ops.createKey("up_03", { label: "三", api_key: "sk-scope-0003" });

    // 行内单把：只落一行，其他行保持未测
    const single = await ops.testKeys("up_03", { key_id: second.id });
    expect(single.items.map((item) => item.key_id)).toEqual([second.id]);
    let rows = (await ops.listKeys("up_03")).items;
    expect(rows.find((row) => row.id === second.id)?.last_test).not.toBeNull();
    expect(rows.find((row) => row.id === first.id)?.last_test).toBeNull();
    expect(rows.find((row) => row.id === third.id)?.last_test).toBeNull();

    // 批量：只测选中 keys，按请求顺序返回
    const batch = await ops.testKeys("up_03", { keys: [third.id, first.id] });
    expect(batch.items.map((item) => item.key_id)).toEqual([third.id, first.id]);
    rows = (await ops.listKeys("up_03")).items;
    expect(rows.find((row) => row.id === first.id)?.last_test).not.toBeNull();
    expect(rows.find((row) => row.id === third.id)?.last_test).not.toBeNull();

    // 未知 id 与同时给两种 scope 都是 422 VALIDATION_ERROR（与后端同一契约）
    await expect(ops.testKeys("up_03", { key_id: "uk_missing" })).rejects.toMatchObject({
      status: 422,
      code: "VALIDATION_ERROR",
    });
    await expect(
      ops.testKeys("up_03", { key_id: first.id, keys: [first.id] }),
    ).rejects.toMatchObject({ status: 422, code: "VALIDATION_ERROR" });
  });

  it("删除不存在的密钥抛 404", async () => {
    const ops = memory.createMemoryUpstreams();
    await expect(ops.removeKey("up_01", "uk_missing")).rejects.toMatchObject({ status: 404, code: "not_found" });
  });
});

describe("模型发现与导入", () => {
  it("discoverModels 返回演示模型清单", async () => {
    const ops = memory.createMemoryUpstreams();
    const probe = await ops.discoverModels("up_01", { api_style: "auto" });
    expect(probe).toMatchObject({ kind: "discover", status: "ok", http_status: 200 });
    expect(probe.model_count).toBe(5);
    expect(probe.models ?? []).toHaveLength(5);
    expect(probe.models).toContain("glm-5.3");
  });

  it("importModels 只创建新模型、已存在的进 skipped", async () => {
    const ops = memory.createMemoryUpstreams();
    const existing = fixtures.upstreamModels.find((model) => model.upstream_id === "up_02");
    expect(existing).toBeDefined();
    const result = await ops.importModels("up_02", {
      names: [existing?.name ?? "", "brand-new-model"],
      model_type: "chat",
    });
    expect(result.created).toEqual(["brand-new-model"]);
    expect(result.skipped).toEqual([existing?.name]);
    expect(result.errors).toEqual([]);
  });

  it("probeModels 按模型逐个返回结果（第 3 个演示失败）", async () => {
    const ops = memory.createMemoryUpstreams();
    const ids = fixtures.upstreamModels.slice(0, 3).map((model) => model.id);
    if (ids.length === 3) {
      const probe = await ops.probeModels("up_01", { model_ids: ids } as never);
      expect(probe.items).toHaveLength(3);
      expect(probe.items[2]).toMatchObject({ ok: false, error_type: "http" });
    }
  });
});

describe("改写规则", () => {
  it("getTransforms 返回 fixtures，saveTransforms 后可回读", async () => {
    const ops = memory.createMemoryUpstreams();
    const before = await ops.getTransforms("up_01");
    expect(before.upstream_id).toBe("up_01");
    expect(before.transforms).toEqual(fixtures.sampleTransforms);

    const custom = { ...fixtures.sampleTransforms, request_headers: [] };
    await expect(ops.saveTransforms("up_01", custom)).resolves.toEqual({ saved: true });
    const after = await ops.getTransforms("up_01");
    expect(after.transforms).toEqual(custom);
  });

  it("previewTransforms 返回 before/after 示例", async () => {
    const ops = memory.createMemoryUpstreams();
    const preview = await ops.previewTransforms("up_01", { ...fixtures.sampleTransforms, request_headers: [] });
    expect(preview.upstream_id).toBe("up_01");
    expect(preview.before).toMatchObject({ model: "glm-5.3" });
    expect(preview.after).toMatchObject({ request: { set: { "x-trace": '"slipstream"' } } });
  });

  it("sampleTransforms 返回演示 before/after 与字段 diff，不改写传入样例", async () => {
    const ops = memory.createMemoryUpstreams();
    const sample = {
      transforms: fixtures.sampleTransforms,
      request: { headers: { "x-trace": "old" }, body: { model: "glm-5.3" } },
      response: { headers: {}, body: null },
    };
    const result = await ops.sampleTransforms("up_01", sample);
    expect(result.upstream_id).toBe("up_01");
    expect(result.before.request.headers["x-trace"]).toBe("old");
    expect(result.diff).toHaveLength(1);
    expect(result.diff[0]).toMatchObject({
      segment: "request_headers",
      kind: "header",
      path: "x-trace",
      before: "old",
      after: "slipstream",
    });
    expect(sample.request.headers["x-trace"]).toBe("old");
  });
});
