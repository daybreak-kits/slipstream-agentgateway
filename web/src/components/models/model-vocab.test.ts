import { describe, expect, it } from "vitest";

import type { ModelParameters } from "@/types";

import { DEFAULT_PARAMETERS, toggleReasoningLevel } from "./model-vocab";

/**
 * W8 ticket 06：上游模型只声明思考档位能力，不再编辑默认档。
 *
 * 默认档由公开模型/模型试验决定，但上游模型保存时后端仍会校验
 * 「默认档必须在已声明档位内」（api/src/l05_service/model_params.py）。
 * 因此取消勾选当前默认档时必须一并清空默认值，避免保存 422。
 */
function parametersOf(patch: Partial<ModelParameters>): ModelParameters {
  return { ...DEFAULT_PARAMETERS, ...patch };
}

describe("toggleReasoningLevel", () => {
  it("勾选新档位：追加声明，未声明默认档时保持未指定", () => {
    const next = toggleReasoningLevel(parametersOf({ reasoning_levels: [] }), "low");
    expect(next.reasoning_levels).toEqual(["low"]);
    expect(next.default_reasoning_level).toBe("");
  });

  it("勾选新档位：默认档仍在声明集合内时保留", () => {
    const next = toggleReasoningLevel(
      parametersOf({ reasoning_levels: ["low"], default_reasoning_level: "low" }),
      "medium",
    );
    expect(next.reasoning_levels).toEqual(["low", "medium"]);
    expect(next.default_reasoning_level).toBe("low");
  });

  it("取消勾选普通档位：只移除该档位，默认档不变", () => {
    const next = toggleReasoningLevel(
      parametersOf({ reasoning_levels: ["low", "medium"], default_reasoning_level: "low" }),
      "medium",
    );
    expect(next.reasoning_levels).toEqual(["low"]);
    expect(next.default_reasoning_level).toBe("low");
  });

  it("取消勾选默认档本身：默认档清空（保持后端「默认档必须在声明集合内」）", () => {
    const next = toggleReasoningLevel(
      parametersOf({ reasoning_levels: ["low", "medium"], default_reasoning_level: "medium" }),
      "medium",
    );
    expect(next.reasoning_levels).toEqual(["low"]);
    expect(next.default_reasoning_level).toBe("");
  });

  it("取消最后一个档位：声明清空，默认档一并清空", () => {
    const next = toggleReasoningLevel(
      parametersOf({ reasoning_levels: ["high"], default_reasoning_level: "high" }),
      "high",
    );
    expect(next.reasoning_levels).toEqual([]);
    expect(next.default_reasoning_level).toBe("");
  });

  it("结果作为整体参数对象返回：未触碰的字段保持原值", () => {
    const source = parametersOf({
      max_input_tokens: 200000,
      reasoning_levels: ["low"],
      tool_call: true,
    });
    const next = toggleReasoningLevel(source, "medium");
    expect(next.max_input_tokens).toBe(200000);
    expect(next.tool_call).toBe(true);
    expect(source.reasoning_levels).toEqual(["low"]);
  });
});
