/** 使用日志页与详情抽屉共用的本地类型：字段以 GET /admin/logs 返回为准。 */
/** 金额字段（cost_micro / margin_micro / charge_micro）无权限时后端直接不返回，故为可选。 */

export interface LogRow {
  event_id: string;
  /** ADR-028：适配器遥测关联键；空串 = 该请求没有尝试链数据。 */
  trace_id: string;
  /** 该请求归一化后的上游尝试次数（0 = 不展示路由链）。 */
  attempts_count?: number;
  has_attempts?: boolean;
  /** 最近一次失败尝试的事实字段（服务层不再拼 UI 文案；摘要由 rowErrorText 拼装）。 */
  last_failure_status?: number | null;
  last_failure_error_type?: string;
  last_failure_error_message?: string;
  started_at_ms: number;
  completed_at_ms: number;
  duration_ms: number;
  time_to_first_token_ms: number;
  http_status: number;
  /** 账本归因列：仍是记录到的模型（混合形态下=最终上游模型），不当作请求模型展示。 */
  public_model: string;
  /** 客户端请求的公开模型（AG attributes_json.agw.ai.original_model）；旧行/缺失为空串，UI 显示「—」。 */
  requested_model: string;
  /** 实际响应的上游模型。 */
  upstream_model: string;
  upstream_model_id: string;
  target_priority: number | null;
  provider: string;
  user_id: string;
  user_name: string;
  api_key_id: string;
  api_key_label: string;
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
  /** 缓存命中占比（0–100 的百分数）；未命中缓存时为 null。 */
  cache_ratio: number | null;
  /** 生成阶段输出速度（词元/秒）；无输出或无可测窗口时为 null。 */
  throughput_tps: number | null;
  is_stream: boolean;
  has_error: boolean;
  has_payload: boolean;
  error: string;
  cost_micro?: number | null;
  margin_micro?: number | null;
  charge_micro?: number | null;
  currency: string;
  estimate: boolean;
}

export interface LogListResponse {
  total: number;
  items: LogRow[];
  next_offset: number | null;
}

/** GET /admin/logs/{event_id}?include_payload=true 的形状：与列表同构 + 原始载荷。 */
export interface LogDetail extends LogRow {
  raw_json?: string;
}

/** GET /admin/logs/{event_id}/payload 的形状（ADR-021）；无行/未开启正文记录时后端 404。 */
export interface LogPayload {
  event_id: string;
  /** 请求正文（prompt）原始 JSON 字符串；可能为空串。 */
  request_prompt_json: string;
  /** 响应正文（completion）原始 JSON 字符串；可能为空串。 */
  response_completion_json: string;
}
