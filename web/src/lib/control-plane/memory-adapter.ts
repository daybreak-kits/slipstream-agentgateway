/**
 * 内存适配器（离线演示）：持 fixtures + 少量命令状态，实现与 HTTP 适配器相同的
 * ControlPlane 接口。VITE_MOCK=1 时由组合根装配；不再是「按 URL 重写一个后端」。
 *
 * 约定：
 *  - 读操作返回 fixtures 的克隆，页面改行不会污染下次请求；
 *  - 写操作只做演示级的最小状态变更（数组增删改），不模拟后端全部业务规则；
 *  - 错误也用统一 ApiError 抛出，页面只认一种错误形状。
 */

import type { AdoptModelsDevResult, TargetDraft } from "@/generated/contract";
import type {
  AvailabilityRule,
  ModelParameters,
  ModelTarget,
  PublicModel,
  Upstream,
  UpstreamKey,
  UpstreamModel,
  UpstreamTransforms,
} from "@/types";

import { ApiError } from "./errors";
import { createMemoryAudits } from "./memory-audits";
import { createMemoryPlayground } from "./memory-playground";
import { createMemorySystem } from "./memory-system";
import * as fixtures from "./memory/fixtures";
import { createMemoryAuth } from "./memory-auth";
import { createMemoryClientKeys } from "./memory-keys";
import { createMemoryConfig } from "./memory-config";
import { createMemoryGovernance } from "./memory-governance";
import { createMemoryPrices } from "./memory-prices";
import { createMemoryLogs } from "./memory-logs";
import { createMemoryRoles } from "./memory-roles";
import { createMemorySettings } from "./memory-settings";
import { createMemoryUsers } from "./memory-users";
import { createMemoryReports } from "./memory-reports";
import type { ControlPlane } from "./operations";
import type { ModelsOperations } from "./operations/models";
import type {
  KeyBatchDeleteResult,
  KeyTestResult,
  ModelProbeResponse,
  ProbeResultView,
  UpstreamRow,
  UpstreamsOperations,
} from "./operations/upstreams";

export function clone<T>(value: T): T {
  return structuredClone(value);
}

function notFound(message: string): ApiError {
  return new ApiError(404, "not_found", message);
}

function upstreamSeq(): number {
  return fixtures.upstreams.length + 1;
}

function modelSeq(): number {
  return fixtures.upstreamModels.length + 1;
}

/** 上游列表/详情派生列：model_count 由登记模型数计算（真实后端同样读侧派生）。 */
function upstreamView(row: Upstream): UpstreamRow {
  return {
    ...clone(row),
    model_count: fixtures.upstreamModels.filter((model) => model.upstream_id === row.id).length,
  };
}

// —— 源密钥命令状态（fixtures 只带连接；密钥是演示时新增的少量可变数据） ——
let upstreamKeySeq = 0;
const upstreamKeys = new Map<string, UpstreamKey[]>();

function keyStore(upstreamId: string): UpstreamKey[] {
  let rows = upstreamKeys.get(upstreamId);
  if (!rows) {
    rows = [];
    upstreamKeys.set(upstreamId, rows);
  }
  return rows;
}

function maskKey(plaintext: string): { masked: string; suffix: string } {
  const trimmed = plaintext.trim();
  const suffix = trimmed.length > 4 ? trimmed.slice(-4) : trimmed;
  return { masked: "…" + suffix, suffix };
}

function requireUpstream(id: string): Upstream {
  const row = fixtures.upstreams.find((item) => item.id === id);
  if (!row) throw notFound("上游不存在：" + id);
  return row;
}

const DISCOVERED_MODELS = ["glm-5.3", "glm-5.3-flash", "glm-4.6", "qwen-max", "deepseek/v5-chat"];

/** 改写规则预览的示例请求体（与旧 mock 的演示值一致）。 */
const PREVIEW_BODY = JSON.stringify({
  model: "glm-5.3",
  temperature: 0.9,
  messages: [{ role: "user", content: "hi" }],
});

// —— 改写规则命令状态：演示时保存后能回读到刚保存的规则 ——
const transformsByUpstream = new Map<string, UpstreamTransforms>();

function transformValue(id: string): UpstreamTransforms {
  return clone(transformsByUpstream.get(id) ?? fixtures.sampleTransforms);
}

/** 上游渠道领域的内存实现。 */
export function createMemoryUpstreams(): UpstreamsOperations {
  return {
    list: async () => fixtures.upstreams.map(upstreamView),

    get: async (id) => upstreamView(requireUpstream(id)),

    create: async (input) => {
      const baseUrl = input.base_url.trim();
      if (baseUrl === "") throw new ApiError(422, "validation_error", "连接地址不能为空", "", { base_url: "必填" });
      const created: Upstream = {
        id: "up_" + String(upstreamSeq()).padStart(2, "0"),
        name: input.name?.trim() || fixtures.upstreamNameFromBaseUrl(baseUrl, fixtures.upstreams),
        alias: input.alias?.trim() ?? "",
        base_url: baseUrl,
        api_style: input.api_style === "auto" ? "openai_chat" : input.api_style,
        transforms: null,
        max_buffer_bytes: input.max_buffer_bytes ?? 2097152,
        enabled: true,
        created_at_ms: Date.now(),
      };
      fixtures.upstreams.push(created);
      if (input.api_key.trim() !== "") {
        const masked = maskKey(input.api_key);
        keyStore(created.id).push({
          id: "uk_" + String((upstreamKeySeq += 1)).padStart(2, "0"),
          label: "",
          masked: masked.masked,
          key_suffix: masked.suffix,
          created_at_ms: Date.now(),
          last_test: null,
          last_test_at_ms: 0,
        });
      }
      return upstreamView(created);
    },

    update: async (id, input) => {
      const row = requireUpstream(id);
      if (input.base_url != null) row.base_url = input.base_url;
      if (input.api_style != null) row.api_style = input.api_style;
      if (typeof input.enabled === "boolean") row.enabled = input.enabled;
      // 留空保持原名（与后端契约一致，ADR-023 #6）
      if (input.name != null && input.name.trim() !== "") row.name = input.name.trim();
      if (input.alias != null) row.alias = input.alias.trim();
      // 上游行里的 transforms 是落库的 JSON 文本（响应字段），写入口是对象
      if (input.transforms != null) row.transforms = JSON.stringify(input.transforms);
      if (input.max_buffer_bytes != null) row.max_buffer_bytes = input.max_buffer_bytes;
      return upstreamView(row);
    },

    remove: async (id) => {
      const index = fixtures.upstreams.findIndex((row) => row.id === id);
      if (index < 0) throw notFound("上游不存在：" + id);
      fixtures.upstreams.splice(index, 1);
      upstreamKeys.delete(id);
    },

    batch: async (input) => {
      const changed: string[] = [];
      const missing: string[] = [];
      for (const id of input.ids) {
        const row = fixtures.upstreams.find((item) => item.id === id);
        if (!row) {
          missing.push(id);
          continue;
        }
        if (input.action === "delete") fixtures.upstreams.splice(fixtures.upstreams.indexOf(row), 1);
        else row.enabled = input.action === "enable";
        changed.push(id);
      }
      return { changed, missing, failed: [], action: input.action as "enable" | "disable" | "delete" };
    },

    discoverModels: async (id, input): Promise<ProbeResultView> => {
      requireUpstream(id);
      void input;
      return {
        kind: "discover",
        status: "ok",
        http_status: 200,
        latency_ms: 186,
        message: "发现 5 个模型",
        model_count: DISCOVERED_MODELS.length,
        models: [...DISCOVERED_MODELS],
        tested_at_ms: Date.now(),
        protocol: "openai_chat",
        protocol_source: "auto",
        probe_steps: [],
      };
    },

    importModels: async (id, input) => {
      requireUpstream(id);
      const existing = new Set(
        fixtures.upstreamModels.filter((model) => model.upstream_id === id).map((model) => model.name),
      );
      const created: string[] = [];
      const skipped: string[] = [];
      for (const name of input.names) {
        if (existing.has(name)) {
          skipped.push(name);
          continue;
        }
        const row: UpstreamModel = {
          id: "um_" + String(modelSeq()).padStart(2, "0"),
          upstream_id: id,
          name,
          model_type: input.model_type ?? "chat",
          enabled: true,
          created_at_ms: Date.now(),
        };
        fixtures.upstreamModels.push(row);
        existing.add(name);
        created.push(name);
      }
      return { upstream_id: id, created, skipped, errors: [] };
    },

    listKeys: async (id) => {
      requireUpstream(id);
      return { items: clone(keyStore(id)), limit: 20 };
    },

    createKey: async (id, input) => {
      requireUpstream(id);
      const rows = keyStore(id);
      if (rows.length >= 20) throw new ApiError(409, "KEY_LIMIT", "单个上游最多 20 把密钥");
      const masked = maskKey(input.api_key);
      if (rows.some((row) => row.key_suffix === masked.suffix && row.masked === masked.masked)) {
        throw new ApiError(409, "DUPLICATE_KEY", "该密钥已存在");
      }
      const created: UpstreamKey = {
        id: "uk_" + String((upstreamKeySeq += 1)).padStart(2, "0"),
        label: input.label?.trim() ?? "",
        masked: masked.masked,
        key_suffix: masked.suffix,
        created_at_ms: Date.now(),
        last_test: null,
        last_test_at_ms: 0,
      };
      rows.push(created);
      return clone(created);
    },

    updateKey: async (id, keyId, input) => {
      requireUpstream(id);
      const row = keyStore(id).find((item) => item.id === keyId);
      if (!row) throw notFound("密钥不存在：" + keyId);
      if (input.label != null) row.label = input.label.trim();
      return clone(row);
    },

    removeKey: async (id, keyId) => {
      requireUpstream(id);
      const rows = keyStore(id);
      const index = rows.findIndex((item) => item.id === keyId);
      if (index < 0) throw notFound("密钥不存在：" + keyId);
      rows.splice(index, 1);
    },

    batchDeleteKeys: async (id, input): Promise<KeyBatchDeleteResult> => {
      requireUpstream(id);
      const rows = keyStore(id);
      const items: KeyBatchDeleteResult["items"] = [];
      let deleted = 0;
      for (const keyId of input.ids) {
        const index = rows.findIndex((item) => item.id === keyId);
        if (index < 0) {
          items.push({ key_id: keyId, ok: false, error: "不存在" });
          continue;
        }
        rows.splice(index, 1);
        deleted += 1;
        items.push({ key_id: keyId, ok: true });
      }
      return { deleted, items };
    },

    testKeys: async (id, input): Promise<KeyTestResult> => {
      const upstream = requireUpstream(id);
      if (input?.key_id != null && input?.keys != null) {
        throw new ApiError(422, "VALIDATION_ERROR", "key_id 与 keys 不能同时提供");
      }
      // 与真实后端同一 scope 口径（W8 票04）：不传=全部；key_id=单把；
      // keys=选中集合（按请求顺序、重复折叠、未知 id 整批 422，不产生部分结果）。
      const rows = keyStore(id);
      let targets = rows.map((row, index) => ({ row, index }));
      if (input?.key_id != null) {
        targets = targets.filter((item) => item.row.id === input.key_id);
        if (targets.length === 0) {
          throw new ApiError(422, "VALIDATION_ERROR", "密钥不存在：" + input.key_id);
        }
      } else if (input?.keys != null) {
        const byId = new Map(targets.map((item) => [item.row.id, item] as const));
        const seen = new Set<string>();
        const scoped: typeof targets = [];
        for (const keyId of input.keys) {
          if (seen.has(keyId)) continue;
          const target = byId.get(keyId);
          if (!target) throw new ApiError(422, "VALIDATION_ERROR", "密钥不存在：" + keyId);
          seen.add(keyId);
          scoped.push(target);
        }
        targets = scoped;
      }
      const items = targets.map(({ row, index }) => {
        const ok = index % 4 !== 3;
        const item = {
          key_id: row.id,
          ok,
          status_code: ok ? 200 : 401,
          latency_ms: ok ? 240 + index * 18 : 120,
          error: ok ? "" : "上游返回 HTTP 401：invalid api key",
        };
        row.last_test = item;
        row.last_test_at_ms = Date.now();
        return item;
      });
      return { upstream_id: id, api_style: upstream.api_style, items: clone(items) };
    },

    probeModels: async (id, input): Promise<ModelProbeResponse> => {
      requireUpstream(id);
      const modelIds = input.model_ids ?? [];
      const ids = modelIds.length > 0 ? modelIds : input.model_id ? [input.model_id] : [];
      const items = ids
        .map((modelId) => fixtures.upstreamModels.find((model) => model.id === modelId))
        .filter((model): model is UpstreamModel => Boolean(model))
        .map((model, index) => {
          const failed = model.model_type === "embedding" || index % 3 === 2;
          return {
            model_id: model.id,
            model: model.name,
            ok: !failed,
            status: failed ? 400 : 200,
            latency_ms: failed ? 240 : 320 + index * 15,
            error_type: failed ? "http" : "",
            message: failed ? "上游返回 HTTP 400：model not supported" : "",
          };
        });
      return { upstream_id: id, key_id: input.key_id ?? "", items };
    },

    getTransforms: async (id) => {
      requireUpstream(id);
      return { upstream_id: id, transforms: transformValue(id) };
    },

    saveTransforms: async (id, value) => {
      requireUpstream(id);
      transformsByUpstream.set(id, clone(value));
      return { saved: true };
    },

    previewTransforms: async (id, value) => {
      requireUpstream(id);
      void value;
      return {
        upstream_id: id,
        before: JSON.parse(PREVIEW_BODY) as unknown,
        after: {
          request: { set: { "x-trace": '"slipstream"' } },
          conditional: [{ predicate: "json(request.body).model == 'glm-5.3'", set: {} }],
        },
        skipped: [],
        notes: [],
      };
    },

    // 演示数据无法真正执行规则；给一个可预期的字段 diff（与预览的 x-trace 假数据同源），
    // 保证离线演示里样例测试的交互与真实后端一致。
    sampleTransforms: async (id, input) => {
      requireUpstream(id);
      const before = {
        request: clone(input.request),
        response: clone(input.response),
      };
      const after = clone(before);
      const previous = after.request.headers["x-trace"];
      after.request.headers["x-trace"] = "slipstream";
      return {
        upstream_id: id,
        before,
        after,
        diff: [
          {
            segment: "request_headers" as const,
            kind: "header" as const,
            path: "x-trace",
            op: "update" as const,
            before: previous ?? null,
            after: "slipstream",
          },
        ],
      };
    },
  };
}

// —— 模型域命令状态 ——
let upstreamModelSeq = fixtures.upstreamModels.length;
let publicModelSeq = fixtures.publicModels.length;
let modelTargetSeq = fixtures.modelTargets.length;
let ruleSeq = 90;

/** models.dev 演示快照：只覆盖几个常见模型；未命中的模型名不做模糊猜测。 */
const MODELS_DEV: Record<
  string,
  { provider: string; model: string; parameters: ModelParameters; cost_input_per_1m: string; cost_output_per_1m: string }
> = {
  "glm-5.3": {
    provider: "zai",
    model: "glm-5.3",
    parameters: {
      max_input_tokens: 200_000, max_output_tokens: 128_000, reasoning_level: "high",
      reasoning_levels: ["default", "none", "low", "medium", "high", "xhigh"], default_reasoning_level: "medium",
      input_types: ["text", "image"], output_types: ["text"],
      tool_call: true, reasoning: true, attachment: false, structured_output: true,
    },
    cost_input_per_1m: "0.700000",
    cost_output_per_1m: "2.800000",
  },
  "glm-5.3-flash": {
    provider: "zai",
    model: "glm-5.3-flash",
    parameters: {
      max_input_tokens: 1_000_000, max_output_tokens: 131_072, reasoning_level: "",
      reasoning_levels: [], default_reasoning_level: "",
      input_types: ["text"], output_types: ["text"],
      tool_call: true, reasoning: false, attachment: false, structured_output: false,
    },
    cost_input_per_1m: "0.150000",
    cost_output_per_1m: "0.600000",
  },
  "deepseek/v5-chat": {
    provider: "deepseek",
    model: "deepseek-v5-chat",
    parameters: {
      max_input_tokens: 128_000, max_output_tokens: 64_000, reasoning_level: "medium",
      reasoning_levels: ["default", "low", "medium", "high"], default_reasoning_level: "medium",
      input_types: ["text"], output_types: ["text"],
      tool_call: true, reasoning: true, attachment: false, structured_output: false,
    },
    cost_input_per_1m: "0.270000",
    cost_output_per_1m: "1.100000",
  },
};

function requireUpstreamModel(id: string): UpstreamModel {
  const row = fixtures.upstreamModels.find((item) => item.id === id);
  if (!row) throw notFound("上游模型不存在：" + id);
  return row;
}

function requirePublicModel(id: string): PublicModel {
  const row = fixtures.publicModels.find((item) => item.id === id);
  if (!row) throw notFound("公开模型不存在：" + id);
  return row;
}

function nextUpstreamModelId(): string {
  upstreamModelSeq += 1;
  return "um_" + String(upstreamModelSeq).padStart(2, "0");
}

function nextPublicModelId(): string {
  publicModelSeq += 1;
  return "pm_" + String(publicModelSeq).padStart(2, "0");
}

/** 上游模型行视图：派生 upstream_name / target_count / availability（后端读侧同样派生）。 */
function upstreamModelView(row: UpstreamModel): UpstreamModel {
  const cooling = (row.cooldown_until_ms ?? 0) > Date.now();
  return {
    ...clone(row),
    upstream_name: row.upstream_name ?? fixtures.upstreams.find((item) => item.id === row.upstream_id)?.name,
    target_count: fixtures.modelTargets.filter((target) => target.upstream_model_id === row.id).length,
    availability: cooling
      ? { state: "cooling", cooldown_until_ms: row.cooldown_until_ms }
      : { state: row.enabled ? "normal" : "closed" },
  };
}

function targetDraftsToRows(publicModelId: string, drafts: TargetDraft[]): ModelTarget[] {
  return drafts.map((draft, index) => {
    const member = fixtures.upstreamModels.find((item) => item.id === draft.upstream_model_id);
    const upstream = member ? fixtures.upstreams.find((item) => item.id === member.upstream_id) : undefined;
    modelTargetSeq += 1;
    return {
      id: "mt_" + String(modelTargetSeq).padStart(2, "0"),
      public_model_id: publicModelId,
      upstream_model_id: draft.upstream_model_id,
      upstream_model_name: member?.name ?? draft.upstream_model_id,
      upstream_name: upstream?.name ?? "",
      priority: draft.priority ?? index + 1,
      weight: draft.weight ?? null,
      when: draft.when ?? null,
      enabled: true,
    };
  });
}

function adoptOne(id: string): AdoptModelsDevResult {
  const row = requireUpstreamModel(id);
  const match = MODELS_DEV[row.name];
  if (!match) {
    return { id, name: row.name, matched: false, status: "no-match", refreshed: true, results: {}, filled: [] };
  }
  const results: Record<string, string> = {};
  const filled: string[] = [];
  if (row.parameters == null) {
    row.parameters = clone(match.parameters);
    results["parameters"] = "filled";
    filled.push("parameters");
  } else {
    results["parameters"] = "skipped-manual";
  }
  if (row.cost_input_per_1m == null || row.cost_input_per_1m === "") {
    row.cost_input_per_1m = match.cost_input_per_1m;
    results["cost_input_per_1m"] = "filled";
    filled.push("cost_input_per_1m");
  } else {
    results["cost_input_per_1m"] = "skipped-manual";
  }
  if (row.cost_output_per_1m == null || row.cost_output_per_1m === "") {
    row.cost_output_per_1m = match.cost_output_per_1m;
    results["cost_output_per_1m"] = "filled";
    filled.push("cost_output_per_1m");
  } else {
    results["cost_output_per_1m"] = "skipped-manual";
  }
  row.params_source = "models.dev";
  row.model_type_source = row.model_type_source ?? "upstream";
  return {
    id, name: row.name, matched: true,
    status: filled.length > 0 ? "filled" : "nothing-to-fill",
    provider: match.provider, model: match.model, refreshed: true,
    results, filled, params_source: "models.dev",
  };
}

/** 模型域的内存实现。 */
export function createMemoryModels(): ModelsOperations {
  return {
    listUpstreamModels: async () => fixtures.upstreamModels.map(upstreamModelView),

    updateUpstreamModel: async (id, input) => {
      const row = requireUpstreamModel(id);
      if (input.name != null) row.name = input.name;
      if (input.model_type != null) row.model_type = input.model_type;
      if (input.model_type_source != null) row.model_type_source = input.model_type_source as UpstreamModel["model_type_source"];
      if (input.parameters !== undefined) row.parameters = input.parameters as unknown as UpstreamModel["parameters"];
      if (typeof input.enabled === "boolean") row.enabled = input.enabled;
      if (input.enabled === true) row.cooldown_until_ms = 0;
      if (typeof input.cooldown_until_ms === "number") row.cooldown_until_ms = input.cooldown_until_ms;
      if (input.cost_input_per_1m !== undefined) row.cost_input_per_1m = input.cost_input_per_1m === null ? null : String(input.cost_input_per_1m);
      if (input.cost_output_per_1m !== undefined) row.cost_output_per_1m = input.cost_output_per_1m === null ? null : String(input.cost_output_per_1m);
      if (input.markup !== undefined && input.markup !== null) row.markup = String(input.markup);
      return upstreamModelView(row);
    },

    createUpstreamModel: async (input) => {
      const upstream = fixtures.upstreams.find((item) => item.id === input.upstream_id);
      if (!upstream) throw notFound("上游不存在：" + input.upstream_id);
      const row: UpstreamModel = {
        id: nextUpstreamModelId(),
        upstream_id: input.upstream_id,
        name: input.name,
        model_type: input.model_type ?? "chat",
        enabled: input.enabled ?? true,
        created_at_ms: Date.now(),
        upstream_name: upstream.name,
        model_type_source: (input.model_type_source as UpstreamModel["model_type_source"]) ?? "manual",
        parameters: input.parameters as unknown as UpstreamModel["parameters"],
        cooldown_until_ms: 0,
        cost_input_per_1m: input.cost_input_per_1m == null ? null : String(input.cost_input_per_1m),
        cost_output_per_1m: input.cost_output_per_1m == null ? null : String(input.cost_output_per_1m),
        markup: input.markup == null ? "" : String(input.markup),
      };
      fixtures.upstreamModels.push(row);
      return upstreamModelView(row);
    },

    removeUpstreamModel: async (id) => {
      requireUpstreamModel(id);
      if (fixtures.modelTargets.some((target) => target.upstream_model_id === id)) {
        throw new ApiError(409, "MODEL_REFERENCED", "该上游模型仍被公开模型引用，不能删除");
      }
      fixtures.upstreamModels.splice(fixtures.upstreamModels.findIndex((row) => row.id === id), 1);
    },

    bulkUpstreamModels: async (input) => {
      const changed: string[] = [];
      const missing: string[] = [];
      const failed: Array<{ id: string; code: string; message: string }> = [];
      for (const id of input.ids) {
        const row = fixtures.upstreamModels.find((item) => item.id === id);
        if (!row) {
          missing.push(id);
          continue;
        }
        if (input.action === "delete") {
          if (fixtures.modelTargets.some((target) => target.upstream_model_id === id)) {
            failed.push({ id, code: "MODEL_REFERENCED", message: "仍被公开模型引用" });
            continue;
          }
          fixtures.upstreamModels.splice(fixtures.upstreamModels.indexOf(row), 1);
        } else {
          row.enabled = input.action === "enable";
          if (input.action === "enable") row.cooldown_until_ms = 0;
        }
        changed.push(id);
      }
      return { action: input.action, changed, missing, failed };
    },

    adoptModelsDev: async (id) => adoptOne(id),

    adoptAllModelsDev: async () => {
      const items = fixtures.upstreamModels.map((row) => adoptOne(row.id));
      return {
        refreshed: true,
        snapshot: { providers: 3, models: Object.keys(MODELS_DEV).length, fetched_at_ms: Date.now() },
        total: items.length,
        matched: items.filter((item) => item.matched).length,
        filled_models: items.filter((item) => item.status === "filled").length,
        filled_keys: items.reduce((sum, item) => sum + (item.filled?.length ?? 0), 0),
        no_match: items.filter((item) => !item.matched).length,
        items,
      };
    },

    modelsDevStatus: async () => ({
      models: Object.keys(MODELS_DEV).length,
      providers: 3,
      fetched_at_ms: Date.parse("2026-11-18T02:00:00"),
    }),

    listModelTargets: async () => clone(fixtures.modelTargets),

    listPublicModels: async () => clone(fixtures.publicModelsView()),

    createPublicModel: async (input) => {
      if (input.name.trim() === "") throw new ApiError(422, "validation_error", "模型名称不能为空");
      const id = nextPublicModelId();
      const row: PublicModel = {
        id,
        name: input.name.trim(),
        routing_mode: (input.routing_mode ?? "failover") as PublicModel["routing_mode"],
        note: input.note ?? null,
        enabled: input.enabled ?? true,
        created_at_ms: Date.now(),
      };
      fixtures.publicModels.push(row);
      if (input.targets && input.targets.length > 0) {
        fixtures.modelTargets.push(...targetDraftsToRows(id, input.targets));
      }
      const view = fixtures.publicModelsView().find((item) => item.id === id);
      if (!view) throw notFound("公开模型不存在：" + id);
      return view;
    },

    updatePublicModel: async (id, input) => {
      const row = requirePublicModel(id);
      if (input.name != null) row.name = input.name;
      if (input.routing_mode != null) row.routing_mode = input.routing_mode as PublicModel["routing_mode"];
      if (input.note !== undefined) row.note = input.note;
      if (typeof input.enabled === "boolean") row.enabled = input.enabled;
      if (input.enabled === true) row.cooldown_until_ms = 0;
      if (typeof input.cooldown_until_ms === "number") row.cooldown_until_ms = input.cooldown_until_ms;
      if (input.targets != null) {
        if (input.targets.length === 0) throw new ApiError(422, "at_least_one_member", "至少保留一个成员");
        for (let index = fixtures.modelTargets.length - 1; index >= 0; index -= 1) {
          if (fixtures.modelTargets[index]?.public_model_id === id) fixtures.modelTargets.splice(index, 1);
        }
        fixtures.modelTargets.push(...targetDraftsToRows(id, input.targets));
      }
      const view = fixtures.publicModelsView().find((item) => item.id === id);
      if (!view) throw notFound("公开模型不存在：" + id);
      return view;
    },

    removePublicModel: async (id) => {
      requirePublicModel(id);
      fixtures.publicModels.splice(fixtures.publicModels.findIndex((row) => row.id === id), 1);
      for (let index = fixtures.modelTargets.length - 1; index >= 0; index -= 1) {
        if (fixtures.modelTargets[index]?.public_model_id === id) fixtures.modelTargets.splice(index, 1);
      }
    },

    bulkPublicModels: async (input) => {
      const changed: string[] = [];
      const missing: string[] = [];
      for (const id of input.ids) {
        const row = fixtures.publicModels.find((item) => item.id === id);
        if (!row) {
          missing.push(id);
          continue;
        }
        if (input.action === "delete") {
          fixtures.publicModels.splice(fixtures.publicModels.indexOf(row), 1);
          for (let index = fixtures.modelTargets.length - 1; index >= 0; index -= 1) {
            if (fixtures.modelTargets[index]?.public_model_id === id) fixtures.modelTargets.splice(index, 1);
          }
        } else {
          row.enabled = input.action === "enable";
          if (input.action === "enable") row.cooldown_until_ms = 0;
        }
        changed.push(id);
      }
      return { action: input.action, changed, missing, failed: [] };
    },

    listRules: async () => clone(fixtures.availabilityRules),

    createRule: async (input) => {
      ruleSeq += 1;
      const rule: AvailabilityRule = {
        id: "rule_" + String(ruleSeq).padStart(2, "0"),
        kind: input.kind === "ban" ? "ban" : "cooldown",
        scope: input.scope,
        scope_id: input.scope_id,
        recurrence: (input.recurrence as AvailabilityRule["recurrence"]) ?? "once",
        expires_at_ms: input.expires_at_ms ?? null,
        schedule_json: input.schedule_json ?? null,
        note: input.note ?? "",
        created_at_ms: Date.now(),
      };
      fixtures.availabilityRules.push(rule);
      return clone(rule);
    },

    updateRule: async (id, input) => {
      const rule = fixtures.availabilityRules.find((item) => item.id === id);
      if (!rule) throw notFound("可用性规则不存在：" + id);
      if (input.kind != null) rule.kind = input.kind === "ban" ? "ban" : "cooldown";
      if (input.scope != null) rule.scope = input.scope;
      if (input.scope_id != null) rule.scope_id = input.scope_id;
      if (input.recurrence !== undefined && input.recurrence !== null) rule.recurrence = input.recurrence as AvailabilityRule["recurrence"];
      if (input.expires_at_ms !== undefined) rule.expires_at_ms = input.expires_at_ms;
      if (input.schedule_json !== undefined) rule.schedule_json = input.schedule_json;
      if (input.note !== undefined && input.note !== null) rule.note = input.note;
    },

    removeRule: async (id) => {
      const index = fixtures.availabilityRules.findIndex((item) => item.id === id);
      if (index < 0) throw notFound("可用性规则不存在：" + id);
      fixtures.availabilityRules.splice(index, 1);
    },

    setAvailability: async (kind, id, input) => {
      const scope = kind === "upstream" ? "upstream_model" : "public_model";
      const row: { enabled: boolean; cooldown_until_ms?: number } =
        kind === "upstream" ? requireUpstreamModel(id) : requirePublicModel(id);
      if (typeof input.enabled === "boolean") {
        row.enabled = input.enabled;
        if (input.enabled) row.cooldown_until_ms = 0;
      }
      if (typeof input.cooldown_until_ms === "number") row.cooldown_until_ms = input.cooldown_until_ms;
      const periodic = fixtures.availabilityRules.some(
        (rule) => rule.scope === scope && rule.scope_id === id && rule.kind === "cooldown" && rule.recurrence !== "once",
      );
      if (input.enabled === true && periodic) {
        return { window_skip: { message: "本次启用仅跳过当前窗口，后续窗口照常" } };
      }
      return {};
    },
  };
}

/** 组合出内存 fixtures 上的 ControlPlane（离线演示）。 */
export function createMemoryControlPlane(): ControlPlane {
  return {
    upstreams: createMemoryUpstreams(),
    models: createMemoryModels(),
    reports: createMemoryReports(),
    logs: createMemoryLogs(),
    users: createMemoryUsers(),
    clientKeys: createMemoryClientKeys(),
    roles: createMemoryRoles(),
    auth: createMemoryAuth(),
    settings: createMemorySettings(),
    config: createMemoryConfig(),
    governance: createMemoryGovernance(),
    prices: createMemoryPrices(),
    audits: createMemoryAudits(),
    playground: createMemoryPlayground(),
    system: createMemorySystem(),
  };
}
