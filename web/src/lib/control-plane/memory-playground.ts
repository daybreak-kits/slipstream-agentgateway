/**
 * Playground 操作的内存实现（W5 票05）：读取复用 fixtures，对话走离线 mock 流。
 *
 * mock 只产出与真实后端同形状的 SSE 文本分片，事件解析仍由 lib/chat 的同一套
 * 解析器完成——离线演示与真实后端的事件形状因此不会分叉。
 */

import type { MyModelOut } from "@/generated/contract";
import { mockChatSseFrames } from "@/lib/chat/mock";

import type {
  ChatStreamOptions,
  PlaygroundChatRequest,
  PlaygroundOperations,
} from "./operations/playground";
import * as fixtures from "./memory/fixtures";
import { clone } from "./memory-adapter";

export function createMemoryPlayground(): PlaygroundOperations {
  return {
    myModels: async () => clone(fixtures.myModels) as MyModelOut[],
    streamChat: async (request: PlaygroundChatRequest, options?: ChatStreamOptions) =>
      mockChatSseFrames(
        {
          model: request.model,
          messages: request.messages,
          reasoningEffort: request.reasoning_effort ?? null,
        },
        { signal: options?.signal },
      ),
  };
}
