/**
 * 上游渠道领域的 typed operations（W4 票04）。
 *
 * 页面只调用这里的语义方法：URL/query/响应信封不进页面，HTTP 与内存适配器
 * 各自实现同一份接口（见 control-plane/http-adapter.ts、memory-adapter.ts）。
 * 请求体使用 web/src/generated/contract.ts 的生成类型；响应类型仍是手写领域
 * 类型（后端这些路由返回 dict，未声明 response_model，暂时不在生成契约里）。
 */

import type {
  UpstreamBatch,
  UpstreamCreate,
  UpstreamImportModels,
  UpstreamKeyBatchDelete,
  UpstreamKeyCreate,
  UpstreamKeyPatch,
  UpstreamKeyTestIn,
  UpstreamModelProbeIn,
  UpstreamPatch,
} from "@/generated/contract";
import type {
  TransformPreviewResult,
  TransformSampleInput,
  TransformSampleResult,
  Upstream,
  UpstreamBatchResult,
  UpstreamImportResult,
  UpstreamKey,
  UpstreamKeyList,
  UpstreamTransforms,
  UpstreamTransformsResponse,
} from "@/types";
import type { OperationOptions } from "../types";

/** 详情行带 api_style_source；has_api_key 由 key_count 派生，仅兼容旧数据。 */
export type UpstreamRow = Upstream & {
  has_api_key?: boolean;
  api_style_source?: string;
};

/** 逐把测试（POST /{id}/keys/test）的单把结果。 */
export interface KeyTestItem {
  key_id: string;
  ok: boolean;
  status_code: number;
  latency_ms: number;
  error: string;
}

/** 逐把测试响应：每把密钥一条结果，同步落库到各密钥行。 */
export interface KeyTestResult {
  upstream_id: string;
  api_style: string;
  items: KeyTestItem[];
}

/** 协议探测单步（后端 C probe_steps 的项，l05_service/upstream_ops.detect_api_style）。 */
export interface ProbeStep {
  order: number;
  protocol: string;
  method: string;
  url: string;
  http_status: number;
  latency_ms: number;
  ok: boolean;
  detail?: string;
}

/** test-connection / discover-models 响应：历史探测行 + 协议三字段。 */
export interface ProbeResultView {
  kind?: string;
  status: "ok" | "timeout" | "error";
  http_status: number;
  latency_ms: number;
  message?: string;
  model_count?: number;
  tested_at_ms?: number;
  models?: string[];
  protocol?: string | null;
  protocol_source?: string;
  probe_steps?: ProbeStep[];
}

/** 批量删除源密钥的单行结果。 */
export interface KeyDeleteItem {
  key_id: string;
  ok: boolean;
  error?: string;
}

export interface KeyBatchDeleteResult {
  deleted: number;
  items: KeyDeleteItem[];
}

/** 后端 probe 单项：{model_id, model, ok, status, latency_ms, error_type, message}。 */
export interface ModelProbeItem {
  model_id: string;
  model: string;
  ok: boolean;
  status: number;
  latency_ms: number;
  /** "" | "http" | "timeout" | "connection" */
  error_type: string;
  /** 后端截断 + 脱敏后的一行说明 */
  message: string;
}

export interface ModelProbeResponse {
  upstream_id: string;
  key_id: string;
  items: ModelProbeItem[];
}

/** 上游模型探测的调用选项：后端逐模型 20s，控制面留余量（25s 是页面口径）。 */
export interface ProbeModelsOptions extends OperationOptions {
  timeoutMs?: number;
}

export interface UpstreamsOperations {
  /** 上游列表（含 key_count/model_count 派生列）。 */
  list(options?: OperationOptions): Promise<UpstreamRow[]>;
  /** 上游详情（编辑页整页表单）。 */
  get(id: string, options?: OperationOptions): Promise<UpstreamRow>;
  create(input: UpstreamCreate): Promise<UpstreamRow>;
  /** PATCH 语义：只提交出现的字段；name 留空保持原名由后端处理。 */
  update(id: string, input: UpstreamPatch): Promise<UpstreamRow>;
  remove(id: string): Promise<void>;
  /** 批量启用/关闭/删除。 */
  batch(input: UpstreamBatch): Promise<UpstreamBatchResult>;
  /** 拉取模型（discover-models）：按 base_url 探测 /models。 */
  discoverModels(id: string, input: { api_style?: string | null }): Promise<ProbeResultView>;
  importModels(id: string, input: UpstreamImportModels): Promise<UpstreamImportResult>;
  /** 源密钥列表。 */
  listKeys(id: string, options?: OperationOptions): Promise<UpstreamKeyList>;
  createKey(id: string, input: UpstreamKeyCreate): Promise<UpstreamKey>;
  updateKey(id: string, keyId: string, input: UpstreamKeyPatch): Promise<UpstreamKey>;
  removeKey(id: string, keyId: string): Promise<void>;
  /** 勾选批量删除；逐把成败都在返回里。 */
  batchDeleteKeys(id: string, input: UpstreamKeyBatchDelete): Promise<KeyBatchDeleteResult>;
  /** 逐把测试本上游全部密钥（同步落库）。 */
  testKeys(id: string, input?: UpstreamKeyTestIn): Promise<KeyTestResult>;
  /** 串行模型探测：一次一批模型 id，页面负责逐模型串行与中止。 */
  probeModels(id: string, input: UpstreamModelProbeIn, options?: ProbeModelsOptions): Promise<ModelProbeResponse>;
  /** 请求/响应改写规则。 */
  getTransforms(id: string): Promise<UpstreamTransformsResponse>;
  saveTransforms(id: string, value: UpstreamTransforms): Promise<{ saved: boolean }>;
  previewTransforms(id: string, value: UpstreamTransforms): Promise<TransformPreviewResult>;
  /** 用粘贴的请求/响应样例回放规则（不访问上游、不落库），返回 before/after 与字段 diff。 */
  sampleTransforms(id: string, input: TransformSampleInput): Promise<TransformSampleResult>;
}
