/**
 * Playground 对话模块（W5 票05）的公共入口。
 *
 * 页面只依赖少量命令与事件：
 *  - sendTurn：唯一发送命令，返回 done/aborted/error 三种结局；
 *  - chatParams：参数表派生的校验/摘要/上限/思考档位命令；
 *  - chatMessages：会话消息 → 请求内容（附件、system prompt）；
 *  - listChatModels：模型选择清单。
 *
 * SSE/thinking/usage 解析、参数白名单与 mock 线上形状都收在模块内部，
 * 页面不再 import 任何底层 helper。
 */

export { sendTurn, describeChatError } from "./send-turn";
export type { ChatStreamTransport, ChatTurnOutcome, ChatTurnRequest, ChatTurnStatus } from "./send-turn";
export { chatParams, REASONING_LEVELS, REASONING_LEVEL_LABELS } from "./params";
export type {
  ChatParamInput,
  ChatParamValidation,
  ChatParamValidationOptions,
  ParamHint,
  ParamHintKey,
} from "./params";
export { chatMessages } from "./messages";
export { listChatModels } from "./models";
export type { PlaygroundModel } from "./models";
export type {
  ChatMessage,
  ChatUsage,
  PlaygroundAttachment,
  PlaygroundUsage,
  ReasoningEffort,
  ReasoningLevel,
  ResponseFormatType,
  ThinkingCarrier,
} from "./types";
