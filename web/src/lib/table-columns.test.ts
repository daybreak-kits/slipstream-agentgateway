import { describe, expect, it } from "vitest";

import {
  ACTION_CELL_WRAPPER_CLASS,
  RESULT_CELL_LINE_COUNT,
  RESULT_CELL_SLOT_CLASS,
  STABLE_ACTION_CELL_WRAPPER_CLASS,
  TABLE_FIXED_LAYOUT_CLASS,
  actionColumnWidth,
  tableColumnWidthStyle,
} from "./table-columns";

/**
 * W8 t03 表格稳定布局契约：固定布局（table-fixed）+ 列宽元数据 + 结果列固定两行槽位 +
 * 操作列按钮固定最小宽度。具体 DOM 断言在 `web/scripts/check-ui-foundation.mjs` 的
 * 「W8 t03」段落里用 SSR 渲染两个状态对比；这里是原语的纯函数/常量契约。
 */
describe("固定表格布局原语（W8 t03）", () => {
  it("固定布局类名只影响显式启用 layout=fixed 的表格", () => {
    expect(TABLE_FIXED_LAYOUT_CLASS).toBe("table-fixed");
  });

  it("列宽元数据写进表头内联样式；未声明宽度不产生样式", () => {
    expect(tableColumnWidthStyle({ width: "10rem" })).toEqual({ width: "10rem" });
    expect(tableColumnWidthStyle({ align: "right" })).toBeUndefined();
    expect(tableColumnWidthStyle(undefined)).toBeUndefined();
  });

  it("固定布局操作列追加按钮最小宽度，非固定布局的表格不受影响", () => {
    expect(ACTION_CELL_WRAPPER_CLASS).toBe("flex justify-end");
    expect(STABLE_ACTION_CELL_WRAPPER_CLASS.startsWith(ACTION_CELL_WRAPPER_CLASS)).toBe(true);
    // dense 按钮 3.5rem：足够「测试」「测试中」两种文案，图标+短词按钮自然宽 4rem 不受限
    expect(STABLE_ACTION_CELL_WRAPPER_CLASS).toContain("[&_button]:min-w-14");
  });

  it("操作列宽度按按钮数与按钮最小宽换算（间距 0.25rem + 单元格 padding 1.5rem）", () => {
    // 带图标 dense ActionButton：4rem
    expect(actionColumnWidth(3)).toBe("14rem");
    expect(actionColumnWidth(4)).toBe("18.25rem");
    expect(actionColumnWidth(5)).toBe("22.5rem");
    // 纯文字 dense 按钮（密钥表）：3.5rem
    expect(actionColumnWidth(3, 3.5)).toBe("12.5rem");
    // 按钮越多列越宽，非法数量按 1 个按钮兜底
    expect(Number.parseFloat(actionColumnWidth(5))).toBeGreaterThan(Number.parseFloat(actionColumnWidth(4)));
    expect(actionColumnWidth(0)).toBe(actionColumnWidth(1));
    expect(actionColumnWidth(-3)).toBe(actionColumnWidth(1));
  });

  it("结果列固定两行槽位：两行高度写死，空槽也占位，行高不随结果出现变化", () => {
    expect(RESULT_CELL_LINE_COUNT).toBe(2);
    // 第一行 22px（徽章行，text-2xs 18px + py 4px）、第二行 18px（时间/补充）
    expect(RESULT_CELL_SLOT_CLASS).toContain("grid-rows-[1.375rem_1.125rem]");
  });
});
