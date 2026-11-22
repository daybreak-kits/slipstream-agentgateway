/** Playground 非 chat 操作的内存实现：复用 fixtures 的 myModels 演示数据。 */

import type { MyModelOut } from "@/generated/contract";

import * as fixtures from "./memory/fixtures";
import { clone } from "./memory-adapter";
import type { PlaygroundOperations } from "./operations/playground";

export function createMemoryPlayground(): PlaygroundOperations {
  return {
    myModels: async () => clone(fixtures.myModels) as MyModelOut[],
  };
}
