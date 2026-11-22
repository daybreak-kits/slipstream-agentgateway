import { describe, expect, it } from "vitest";

import { formatSampleValue, parseHeaderLines, parseJsonSample } from "./sample";

describe("样例粘贴：请求/响应头按行解析", () => {
  it("每行 Name: Value；头名大小写不敏感并归一为小写，值里的冒号保留", () => {
    const result = parseHeaderLines("Content-Type: application/json\nx-trace: a:b:c\n");
    expect(result.error).toBeNull();
    expect(result.headers).toEqual({ "content-type": "application/json", "x-trace": "a:b:c" });
  });

  it("忽略空行与首尾空白", () => {
    const result = parseHeaderLines("\n   \n  x-a  :  v1  \n\n");
    expect(result.error).toBeNull();
    expect(result.headers).toEqual({ "x-a": "v1" });
  });

  it("空文本表示没有头", () => {
    expect(parseHeaderLines("")).toEqual({ headers: {}, error: null });
  });

  it("缺冒号/缺头名报出行号，而不是静默丢行", () => {
    const missingColon = parseHeaderLines("x-a: 1\nnot a header\nx-b: 2");
    expect(missingColon.error).toContain("第 2 行");
    expect(missingColon.error).toContain("冒号");

    const missingName = parseHeaderLines("x-a: 1\n : 2");
    expect(missingName.error).toContain("第 2 行");
    expect(missingName.error).toContain("头名称");
  });
});

describe("样例粘贴：body 是 JSON", () => {
  it("合法 JSON 原样解析（对象/数组/标量）", () => {
    expect(parseJsonSample('{"model":"glm-5.3"}', "请求体")).toEqual({
      value: { model: "glm-5.3" },
      error: null,
    });
    expect(parseJsonSample("[1, 2]", "请求体")).toEqual({ value: [1, 2], error: null });
    expect(parseJsonSample('"text"', "请求体")).toEqual({ value: "text", error: null });
  });

  it("空文本表示没有 body", () => {
    expect(parseJsonSample("   ", "请求体")).toEqual({ value: null, error: null });
  });

  it("非法 JSON 带用户可读的错误与字段标签", () => {
    const result = parseJsonSample('{"model": }', "响应体");
    expect(result.value).toBeNull();
    expect(result.error).toContain("响应体");
    expect(result.error).toContain("JSON");
  });
});

describe("diff 展示：缺失值与 JSON 值格式化", () => {
  it("不存在的字段显示为中文占位", () => {
    expect(formatSampleValue(null)).toBe("（无）");
    expect(formatSampleValue(undefined)).toBe("（无）");
  });

  it("字符串原样、其余值 JSON 序列化", () => {
    expect(formatSampleValue("slipstream")).toBe("slipstream");
    expect(formatSampleValue(0.2)).toBe("0.2");
    expect(formatSampleValue(true)).toBe("true");
    expect(formatSampleValue({ a: 1 })).toBe('{"a":1}');
  });
});
