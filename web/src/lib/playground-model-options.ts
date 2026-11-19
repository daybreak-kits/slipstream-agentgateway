// 模型试验（游乐场）需要的中性模型类型。
//
// 这些类型原先住在旧版模型模块里（该模块已删除）。游乐场只用
// 参数、健康状态与排期这几小块，迁移后统一用 upstream / upstream model 术语。

/** 上游模型的健康状态（由数据面派生）。 */
export type HealthStatus = "normal" | "open" | "half_open" | "fault";

/** 公开可见状态：在健康状态之外多一个人工封禁态。 */
export type VisibleStatus = "normal" | "open" | "half_open" | "fault" | "disabled";

export type InputType = "text" | "image" | "audio" | "video" | "file";
export type OutputType = "text" | "image" | "audio" | "embedding";

/** 上游模型登记的调用参数（只读展示，不参与请求改写）。 */
export interface ModelParameters {
  max_input_tokens: number;
  max_output_tokens: number;
  reasoning_level: string;
  input_types: InputType[];
  output_types: OutputType[];
  tool_call?: boolean;
  reasoning?: boolean;
  attachment?: boolean;
  structured_output?: boolean;
}

export const DEFAULT_MODEL_PARAMETERS: ModelParameters = {
  max_input_tokens: 0,
  max_output_tokens: 0,
  reasoning_level: "",
  input_types: ["text"],
  output_types: ["text"],
};

export type ScheduleRuleKind = "daily" | "weekly" | "monthly";

export interface ScheduleRule {
  kind: ScheduleRuleKind;
  /** weekly 用 ISO 星期（1=周一）。 */
  days?: number[];
  /** monthly 用日号 1–31。 */
  days_of_month?: number[];
  /** HH:MM 本地墙钟；end <= start 表示跨天窗口。 */
  start: string;
  end: string;
}

/** 上游模型的排期文档（v2）。 */
export interface ModelSchedule {
  version: 2;
  /** IANA 时区名：窗口按该时区的墙钟求值。 */
  timezone: string;
  rules: ScheduleRule[];
}