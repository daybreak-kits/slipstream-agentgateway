/**
 * 控制面组合根（W4 票04）：页面/组件/hooks 只 import 这里，不直接碰 HTTP 或 fixtures。
 *
 * 适配器选择只发生在这里：VITE_MOCK=1 用 in-memory adapter（离线演示/单测友好），
 * 否则用 HTTP adapter 打真实 /admin API。页面不存在 useMock 分支。
 */

import { createHttpControlPlane } from "./http-adapter";
import { createMemoryControlPlane } from "./memory-adapter";
import type { ControlPlane } from "./operations";

/**
 * 仅组合根读取环境变量：VITE_MOCK=1/true 时走离线演示数据。
 * 写成构建期可常量折叠的条件：生产构建（未设 VITE_MOCK）会把内存适配器整域摇掉，
 * 不让演示 fixtures 进首包；离线演示仍用 VITE_MOCK=1 构建。
 */
const mockFlag: string | undefined = import.meta.env.VITE_MOCK;
export const isMockMode: boolean = mockFlag === "1" || mockFlag === "true";

export const controlPlane: ControlPlane = isMockMode ? createMemoryControlPlane() : createHttpControlPlane();

export { API_BASE, API_BASE_LABEL } from "./http-adapter";
export { ApiError } from "./errors";
export type { ControlPlane };
