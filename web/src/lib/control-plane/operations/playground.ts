/**
 * 模型试验（Playground）的 typed operations（W4 票04 + W5 票05）。
 *
 * 页面级读取（我的模型参数）与 chat SSE 流都从这里进出：chat 的事件解析在
 * lib/chat，适配器只负责传输（真实 HTTP / 离线 mock）。
 */

import type { MyModelOut, PlaygroundRequest } from "@/generated/contract";

import type { OperationOptions } from "../types";

/** POST /admin/playground/stream 的请求体：控制面 schema + 客户端流式开关。 */
export type PlaygroundChatRequest = PlaygroundRequest & { stream?: boolean };

/** 打开 SSE 流的调用选项：取消信号 + 浏览器端调用密钥（只进 Authorization 头）。 */
export interface ChatStreamOptions extends OperationOptions {
  apiKey?: string;
}

export interface PlaygroundOperations {
  /** GET /admin/my/models：登录用户可见的启用公开模型参数（无金额键）。 */
  myModels(options?: OperationOptions): Promise<MyModelOut[]>;
  /** POST /admin/playground/stream：打开 SSE 文本分片流（事件解析在 lib/chat）。 */
  streamChat(
    request: PlaygroundChatRequest,
    options?: ChatStreamOptions,
  ): Promise<AsyncIterable<string>>;
}
