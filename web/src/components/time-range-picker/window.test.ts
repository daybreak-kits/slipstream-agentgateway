import { describe, expect, it } from "vitest";

import { timeWindowEquals, timeWindowLabel, type TimeWindow } from "./window";

/** 本地时区构造（格式化/比较都按浏览器本地时区，与构造方式无关）。 */
function at(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second = 0,
): number {
  return new Date(year, month - 1, day, hour, minute, second).getTime();
}

describe("timeWindowEquals：时间窗按值比较", () => {
  it("预设区间同名相等、异名不等", () => {
    expect(
      timeWindowEquals({ kind: "range", value: "today" }, { kind: "range", value: "today" }),
    ).toBe(true);
    expect(
      timeWindowEquals({ kind: "range", value: "today" }, { kind: "range", value: "7d" }),
    ).toBe(false);
  });

  it("自定义窗同起止毫秒即相等（新对象不影响）", () => {
    const fromMs = at(2026, 11, 22, 0, 0, 0);
    const toMs = at(2026, 11, 22, 23, 59, 59);
    expect(
      timeWindowEquals(
        { kind: "custom", fromMs, toMs },
        { kind: "custom", fromMs, toMs },
      ),
    ).toBe(true);
  });

  it("自定义窗起或止不同即不等", () => {
    const fromMs = at(2026, 11, 22, 0, 0, 0);
    const toMs = at(2026, 11, 22, 23, 59, 59);
    expect(
      timeWindowEquals(
        { kind: "custom", fromMs, toMs },
        { kind: "custom", fromMs, toMs: toMs + 1 },
      ),
    ).toBe(false);
    expect(
      timeWindowEquals(
        { kind: "custom", fromMs, toMs },
        { kind: "custom", fromMs: fromMs + 1, toMs },
      ),
    ).toBe(false);
  });

  it("预设与自定义窗永不相等", () => {
    expect(
      timeWindowEquals(
        { kind: "range", value: "24h" },
        { kind: "custom", fromMs: at(2026, 11, 21, 19, 0, 0), toMs: at(2026, 11, 22, 19, 0, 0) },
      ),
    ).toBe(false);
  });

  it("起止相等的自定义窗按值相等", () => {
    const same = at(2026, 11, 22, 12, 30, 0);
    const window: TimeWindow = { kind: "custom", fromMs: same, toMs: same };
    expect(timeWindowEquals(window, { kind: "custom", fromMs: same, toMs: same })).toBe(true);
    expect(
      timeWindowEquals(window, { kind: "custom", fromMs: same, toMs: same + 1 }),
    ).toBe(false);
  });
});
describe("timeWindowLabel：完整区间与预设名", () => {
  it("自定义窗显示 YYYY/MM/DD HH:mm:ss 至 YYYY/MM/DD HH:mm:ss", () => {
    const label = timeWindowLabel({
      kind: "custom",
      fromMs: at(2026, 11, 22, 19, 51, 50),
      toMs: at(2026, 11, 22, 20, 1, 5),
    });
    expect(label).toBe("2026/11/22 19:51:50 至 2026/11/22 20:01:05");
    expect(label).not.toContain("—");
  });

  it("跨年时两端都带完整年份与秒", () => {
    const label = timeWindowLabel({
      kind: "custom",
      fromMs: at(2025, 12, 31, 23, 59, 59),
      toMs: at(2026, 1, 1, 0, 0, 0),
    });
    expect(label).toBe("2025/12/31 23:59:59 至 2026/01/01 00:00:00");
  });

  it("起止相等时两端各自完整显示（不做折叠）", () => {
    const same = at(2026, 11, 22, 12, 30, 0);
    expect(timeWindowLabel({ kind: "custom", fromMs: same, toMs: same })).toBe(
      "2026/11/22 12:30:00 至 2026/11/22 12:30:00",
    );
  });

  it("预设区间仍显示预设名", () => {
    expect(timeWindowLabel({ kind: "range", value: "24h" })).toBe("近 24 小时");
    expect(timeWindowLabel({ kind: "range", value: "today" })).toBe("今天");
  });
});
