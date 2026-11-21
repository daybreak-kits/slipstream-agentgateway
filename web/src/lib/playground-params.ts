import type { ChatParamInput, ReasoningLevel, ResponseFormatType } from "@/lib/playground";

/** 参数面板的状态：数字一律以字符串保存，空串表示「不发送、用上游默认」。 */
export interface PlaygroundParamsState
  extends Omit<ChatParamInput, "responseFormat" | "logprobs" | "thinkingMode"> {
  model: string;
  systemPrompt: string;
  streaming: boolean;
  /** 只留在浏览器内存的调用密钥；控制面仍用服务端密钥，这里按 Authorization 附带。 */
  apiKey: string;
  responseFormat: ResponseFormatType;
  logprobs: boolean;
  /** 思考档位；default = 不发送 reasoning_effort（票18）。 */
  thinkingMode: ReasoningLevel;
}

export const EMPTY_PLAYGROUND_PARAMS: PlaygroundParamsState = {
  model: "",
  systemPrompt: "",
  streaming: true,
  apiKey: "",
  temperature: "",
  topP: "",
  topK: "",
  frequencyPenalty: "",
  presencePenalty: "",
  seed: "",
  maxTokens: "",
  maxCompletionTokens: "",
  stop: "",
  n: "",
  responseFormat: "text",
  logprobs: false,
  topLogprobs: "",
  user: "",
  thinkingMode: "default",
  extraFields: "",
};
