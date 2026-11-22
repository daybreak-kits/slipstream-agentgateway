import { beforeEach, describe, expect, it, vi } from "vitest";

import type * as FixturesModule from "./memory/fixtures";
import type * as MemoryModule from "./memory-adapter";

/**
 * 模型域内存适配器行为套件（上游模型 / 公开模型 / 可用性规则）。
 * 每个用例前重置模块：fixtures 回到初始状态，写操作不串味。
 */
let memory: typeof MemoryModule;
let fixtures: typeof FixturesModule;

beforeEach(async () => {
  vi.resetModules();
  memory = await import("./memory-adapter");
  fixtures = await import("./memory/fixtures");
});

describe("模型域：上游模型", () => {
  it("list 派生 upstream_name / target_count / availability", async () => {
    const models = memory.createMemoryModels();
    const rows = await models.listUpstreamModels();
    const row = rows.find((item) => item.id === "um_01");
    expect(row?.upstream_name).toBeDefined();
    expect(row?.target_count).toBeGreaterThan(0);
    expect(row?.availability?.state).toBe("normal");
    expect(rows.find((item) => item.id === "um_05")?.availability?.state).toBe("closed");
  });

  it("update enabled=true 清冷却；写冷却后 availability=cooling", async () => {
    const models = memory.createMemoryModels();
    const cooled = await models.updateUpstreamModel("um_01", { cooldown_until_ms: Date.now() + 60_000 });
    expect(cooled.availability?.state).toBe("cooling");
    const enabled = await models.updateUpstreamModel("um_01", { enabled: true });
    expect(enabled.availability?.state).toBe("normal");
  });

  it("create 挂到上游下；被公开模型引用的行删除抛 409", async () => {
    const models = memory.createMemoryModels();
    const created = await models.createUpstreamModel({ upstream_id: "up_01", name: "glm-new", model_type: "chat" });
    expect(created.id.startsWith("um_")).toBe(true);
    await expect(models.removeUpstreamModel("um_01")).rejects.toMatchObject({ status: 409, code: "MODEL_REFERENCED" });
    await expect(models.removeUpstreamModel(created.id)).resolves.toBeUndefined();
  });

  it("bulk 删除被引用的进 failed，其余进 changed", async () => {
    const models = memory.createMemoryModels();
    const result = await models.bulkUpstreamModels({ ids: ["um_01", "um_05", "um_zz"], action: "delete" });
    expect(result.changed).toEqual(["um_05"]);
    expect(result.missing).toEqual(["um_zz"]);
    expect(result.failed).toEqual([{ id: "um_01", code: "MODEL_REFERENCED", message: "仍被公开模型引用" }]);
  });

  it("adoptModelsDev 只填空键，第二次调用 nothing-to-fill", async () => {
    const models = memory.createMemoryModels();
    const first = await models.adoptModelsDev("um_04");
    expect(first).toMatchObject({ matched: true, status: "filled", provider: "deepseek" });
    expect(first.filled).toContain("cost_input_per_1m");
    const second = await models.adoptModelsDev("um_04");
    expect(second.status).toBe("nothing-to-fill");
    const unmatched = await models.adoptModelsDev("um_03");
    expect(unmatched).toMatchObject({ matched: false, status: "no-match" });
  });

  it("adoptAllModelsDev 汇总计数；modelsDevStatus 返回快照摘要", async () => {
    const models = memory.createMemoryModels();
    const result = await models.adoptAllModelsDev();
    expect(result.total).toBe(fixtures.upstreamModels.length);
    expect(result.matched + result.no_match).toBe(result.total);
    expect(result.snapshot?.models).toBeGreaterThan(0);
    const status = await models.modelsDevStatus();
    expect(status.providers).toBe(3);
    expect(status.fetched_at_ms).toBeGreaterThan(0);
  });
});

describe("模型域：公开模型", () => {
  it("list 内嵌 targets 与 target_count", async () => {
    const models = memory.createMemoryModels();
    const rows = await models.listPublicModels();
    const row = rows.find((item) => item.id === "pm_01");
    expect(row?.targets?.length).toBe(2);
    expect(row?.target_count).toBe(2);
  });

  it("create 带 targets；update 整批替换 targets", async () => {
    const models = memory.createMemoryModels();
    const created = await models.createPublicModel({
      name: "glm-new-pub",
      routing_mode: "failover",
      targets: [{ upstream_model_id: "um_02", priority: 1 }],
    });
    expect(created.targets).toHaveLength(1);
    const updated = await models.updatePublicModel(created.id, {
      targets: [
        { upstream_model_id: "um_01", priority: 1 },
        { upstream_model_id: "um_02", priority: 2 },
      ],
    });
    expect(updated.targets?.map((target) => target.upstream_model_id)).toEqual(["um_01", "um_02"]);
    await expect(models.updatePublicModel(created.id, { targets: [] })).rejects.toMatchObject({
      status: 422,
      code: "at_least_one_member",
    });
  });

  it("remove 级联删除 targets；bulk 批量启停", async () => {
    const models = memory.createMemoryModels();
    await models.removePublicModel("pm_01");
    expect(fixtures.modelTargets.some((target) => target.public_model_id === "pm_01")).toBe(false);
    const result = await models.bulkPublicModels({ ids: ["pm_02", "pm_zz"], action: "disable" });
    expect(result.changed).toEqual(["pm_02"]);
    expect(result.missing).toEqual(["pm_zz"]);
  });
});

describe("模型域：可用性规则与行级启停", () => {
  it("rules 增改删", async () => {
    const models = memory.createMemoryModels();
    const before = await models.listRules();
    const rule = await models.createRule({
      kind: "cooldown",
      scope: "upstream_model",
      scope_id: "um_02",
      recurrence: "daily",
      note: "夜间维护",
    });
    expect(rule.recurrence).toBe("daily");
    await expect(models.updateRule(rule.id, { note: "改备注" })).resolves.toBeUndefined();
    expect((await models.listRules()).find((item) => item.id === rule.id)?.note).toBe("改备注");
    await models.removeRule(rule.id);
    expect(await models.listRules()).toHaveLength(before.length);
  });

  it("周期冷却存在时启用行返回 window_skip 提示", async () => {
    const models = memory.createMemoryModels();
    await models.createRule({
      kind: "cooldown",
      scope: "upstream_model",
      scope_id: "um_01",
      recurrence: "weekly",
    });
    const result = await models.setAvailability("upstream", "um_01", { enabled: true });
    expect(result.window_skip?.message).toContain("仅跳过当前窗口");
    const plain = await models.setAvailability("upstream", "um_02", { enabled: true });
    expect(plain.window_skip).toBeUndefined();
  });
});
