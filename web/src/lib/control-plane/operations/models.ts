/**
 * 模型域的 typed operations（W4 票04）：上游模型、公开模型、模型可用性规则。
 *
 * 页面只调语义方法；上游模型/公开模型列表的响应仍是手写领域类型（后端这些路由
 * 返回 dict 未声明 response_model），请求体与 models.dev 兑入结果用生成契约类型。
 */

import type {
  AdoptModelsDevBatchResult,
  AdoptModelsDevResult,
  ModelBulk,
  ModelsDevSnapshotStatus,
  PublicModelCreate,
  PublicModelPatch,
  RuleCreate,
  RulePatch,
  UpstreamModelCreate,
  UpstreamModelPatch,
} from "@/generated/contract";
import type { AvailabilityRule, ModelBatchResult, ModelTarget, PublicModel, UpstreamModel } from "@/types";

import type { OperationOptions } from "../types";

/** 列表取数选项：pageSize=200 用于「全量候选」场景（与后端分页档位一致）。 */
export interface ModelListOptions extends OperationOptions {
  pageSize?: number;
}

/** 行级可用性写接口的响应：窗口期启用时后端带 window_skip 提示。 */
export interface AvailabilityPatchResult {
  window_skip?: { message: string } | null;
}

export interface ModelsOperations {
  /** GET /admin/upstream-models（裸数组或信封均可） */
  listUpstreamModels(options?: ModelListOptions): Promise<UpstreamModel[]>;
  updateUpstreamModel(id: string, input: UpstreamModelPatch): Promise<UpstreamModel>;
  createUpstreamModel(input: UpstreamModelCreate): Promise<UpstreamModel>;
  removeUpstreamModel(id: string): Promise<void>;
  bulkUpstreamModels(input: ModelBulk): Promise<ModelBatchResult>;
  /** POST /admin/upstream-models/{id}/adopt-modelsdev：单条兑入空键 */
  adoptModelsDev(id: string): Promise<AdoptModelsDevResult>;
  /** POST /admin/upstream-models/adopt-modelsdev：批量兑入 */
  adoptAllModelsDev(): Promise<AdoptModelsDevBatchResult>;
  modelsDevStatus(options?: OperationOptions): Promise<ModelsDevSnapshotStatus>;

  /** GET /admin/model-targets：公开模型成员行（路由成员选择/实验模型清单）。 */
  listModelTargets(options?: OperationOptions): Promise<ModelTarget[]>;
  listPublicModels(options?: ModelListOptions): Promise<PublicModel[]>;
  createPublicModel(input: PublicModelCreate): Promise<PublicModel>;
  updatePublicModel(id: string, input: PublicModelPatch): Promise<PublicModel>;
  removePublicModel(id: string): Promise<void>;
  bulkPublicModels(input: ModelBulk): Promise<ModelBatchResult>;

  /** GET /admin/availability-rules?page_size=200 */
  listRules(options?: OperationOptions): Promise<AvailabilityRule[]>;
  createRule(input: RuleCreate): Promise<AvailabilityRule>;
  updateRule(id: string, input: RulePatch): Promise<void>;
  removeRule(id: string): Promise<void>;

  /** 行级启停/冷却（上游模型或公开模型共用）：PATCH 单行，返回窗口期提示。 */
  setAvailability(
    kind: "upstream" | "public",
    id: string,
    input: { enabled?: boolean; cooldown_until_ms?: number },
  ): Promise<AvailabilityPatchResult>;
}
