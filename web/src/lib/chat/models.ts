/**
 * 游乐场的模型选择项（W5 票05，自 lib/playground 收进 chat 模块）。
 *
 * 真实模式读控制面公开模型 + 目标数；Mock 模式给一份演示清单（见 mock.ts），
 * 不冒充真实目录。
 */

import { controlPlane, isMockMode } from "@/lib/control-plane";
import type { PublicModel } from "@/types";

import { MOCK_PLAYGROUND_MODELS } from "./mock";

/** 游乐场的模型选择项：对外模型名 + 目标数（v1 三层寻址：PublicModel → ModelTarget）。 */
export interface PlaygroundModel {
  name: string;
  targetCount: number;
  /** 路由模式：对话框按它分组（故障转移 / 加权 / 条件）。 */
  routingMode: PublicModel["routing_mode"];
}

/** 参数面板的模型清单：只列启用的对外模型；Mock 模式给一份演示清单。 */
export async function listChatModels(): Promise<PlaygroundModel[]> {
  if (isMockMode) {
    return MOCK_PLAYGROUND_MODELS.map((item) => ({
      name: item.name,
      targetCount: item.targetCount,
      routingMode: item.routingMode,
    }));
  }
  const [rows, targets] = await Promise.all([
    controlPlane.models.listPublicModels(),
    controlPlane.models.listModelTargets().catch(() => []),
  ]);
  const counts = new Map<string, number>();
  for (const target of targets) {
    counts.set(target.public_model_id, (counts.get(target.public_model_id) ?? 0) + 1);
  }
  return rows
    .filter((row) => row.enabled)
    .map((row) => ({
      name: row.name,
      targetCount: counts.get(row.id) ?? 0,
      routingMode: row.routing_mode,
    }));
}
