import { describe, expect, it } from "vitest";

import type { KeyTestResult } from "@/lib/control-plane/operations/upstreams";

import {
  batchTestLabel,
  batchTestTarget,
  isKeyTestTarget,
  keyTestInput,
  keyTestNotice,
  rowTestLabel,
} from "./key-test";

/** 两把结果的最小响应：成功/失败各一条，断言只依赖 items。 */
function result(okFlags: boolean[]): KeyTestResult {
  return {
    upstream_id: "up_01",
    api_style: "openai_chat",
    items: okFlags.map((ok, index) => ({
      key_id: "uk_0" + String(index + 1),
      ok,
      status_code: ok ? 200 : 401,
      latency_ms: ok ? 12 : 8,
      error: ok ? "" : "上游返回 HTTP 401",
    })),
  };
}

/**
 * W8 票04 密钥测试的纯 UI 逻辑：行内单把与多选批量共用同一 POST /keys/test。
 * 页面只根据这里的输出决定请求体、按钮文案与 toast；断言的是用户可见行为
 * （只测当前行 / 只测选中行 / 测试中文案），不碰组件内部结构。
 */
describe("密钥测试目标（W8 票04）", () => {
  it("行内测试只带当前 key_id，不夹带 keys", () => {
    const body = keyTestInput({ keyId: "uk_02" });
    expect(body).toEqual({ key_id: "uk_02" });
    expect("keys" in body).toBe(false);
  });

  it("批量测试只带选中 keys，保持选中顺序", () => {
    const body = keyTestInput({ keyIds: ["uk_03", "uk_01"] });
    expect(body).toEqual({ keys: ["uk_03", "uk_01"] });
    expect("key_id" in body).toBe(false);
  });

  it("没有选中时不出批量目标；有选中时按选中集合成批", () => {
    expect(batchTestTarget(new Set())).toBeNull();
    expect(batchTestTarget(new Set(["uk_01", "uk_02"]))).toEqual({ keyIds: ["uk_01", "uk_02"] });
  });

  it("pending 目标只命中被测试的行（单把与批量同一判定）", () => {
    expect(isKeyTestTarget({ keyId: "uk_02" }, "uk_02")).toBe(true);
    expect(isKeyTestTarget({ keyId: "uk_02" }, "uk_01")).toBe(false);
    expect(isKeyTestTarget({ keyIds: ["uk_01", "uk_03"] }, "uk_03")).toBe(true);
    expect(isKeyTestTarget({ keyIds: ["uk_01", "uk_03"] }, "uk_02")).toBe(false);
    expect(isKeyTestTarget(null, "uk_01")).toBe(false);
    expect(isKeyTestTarget(undefined, "uk_01")).toBe(false);
  });

  it("进行中只有目标行的行内按钮换「测试中」，其余保持「测试」（按钮宽度由固定列兜底）", () => {
    expect(rowTestLabel(false, false)).toBe("测试");
    expect(rowTestLabel(true, true)).toBe("测试中");
    expect(rowTestLabel(true, false)).toBe("测试");
  });

  it("批量按钮显示选中把数，进行中换「测试中」——同一按钮宽度不因文案变化", () => {
    expect(batchTestLabel(false, 3)).toBe("批量测试 3 把");
    expect(batchTestLabel(true, 3)).toBe("测试中");
  });
});

describe("密钥测试结果汇总（W8 票04）", () => {
  it("单把成功：成功提示，不再出现「逐把测试」的整组口径", () => {
    expect(keyTestNotice({ keyId: "uk_01" }, result([true]))).toEqual({
      tone: "success",
      title: "测试完成",
      description: "成功 1 把",
    });
  });

  it("单把失败：warning 并提示已标红", () => {
    expect(keyTestNotice({ keyId: "uk_01" }, result([false]))).toEqual({
      tone: "warning",
      title: "测试完成",
      description: "成功 0 把 · 失效 1 把（已标红）",
    });
  });

  it("批量：汇总成功/失效数，标题明确是批量测试", () => {
    expect(keyTestNotice({ keyIds: ["uk_01", "uk_02", "uk_03"] }, result([true, true, false]))).toEqual({
      tone: "warning",
      title: "批量测试完成",
      description: "成功 2 把 · 失效 1 把（已标红）",
    });
    expect(keyTestNotice({ keyIds: ["uk_01"] }, result([true]))).toEqual({
      tone: "success",
      title: "批量测试完成",
      description: "成功 1 把",
    });
  });
});
