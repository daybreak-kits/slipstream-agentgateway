import type { CSSProperties } from "react";

import { cn } from "@/lib/utils";

/**
 * 表格列元数据（DESIGN-AUDIT 四期 §2 + W5 D1）：
 * DataTable、ModelsTable、PriceTable 共用同一套「对齐 align / 尾部冻结 sticky」口径，
 * 列定义只声明语义，具体类名由本模块统一给出，避免三套表格各自手写导致头身不一致或漏冻结。
 */
export type TableColumnAlign = "left" | "center" | "right";
export type TableColumnSticky = "right";

/** 列布局元数据：表格组件把它同时应用到 th 与 td（头身同用）。 */
export interface TableColumnLayoutMeta {
  /** 对齐：数值列 right、状态/操作列 center 或 right、文本列 left；表头与表体必须同侧。 */
  align?: TableColumnAlign;
  /** 操作列 = 最后一列 + 冻结在尾部：窄屏横向滚动时始终可见（Excel 冻结窗格语义）。 */
  sticky?: TableColumnSticky;
  /** 追加到 th 与 td 的类（对齐/字号等逃生通道；常规对齐优先用 align）。 */
  className?: string;
  /** 仅追加到 th 的覆盖通道（多行表头等）。 */
  headerClassName?: string;
  /** 固定布局列宽（CSS 长度，如 "10rem"、"18.25%"）：table-fixed 下由 `tableColumnWidthStyle`
   * 写进表头内联样式，列宽只由列定义决定、不随单元格内容或状态变化（W8 t03）。 */
  width?: string;
}

const ALIGN_CLASS: Record<TableColumnAlign, string> = {
  left: "text-left",
  center: "text-center",
  right: "text-right",
};

/**
 * 冻结列单元格：不透明底色 + 左侧分割阴影 + 列层级（高于表体、低于吸顶表头，
 * 见 index.css 的 --z-sticky-column / --z-sticky-head）；行悬浮由 TR 的 group 与
 * --row-hover 同步，避免 hover 时出现色块断层。
 * 底色走行背景变量 --row-bg（W6 ticket 10）：行有微灰/微黄底色时冻结列同步着色，
 * 不再出现白底断层；无行色时回落 --surface。pr-2 是末列收窄的右 padding（贴边）。
 */
export const FROZEN_COLUMN_CELL_CLASS =
  "sticky right-0 z-[var(--z-sticky-column)] pr-2 bg-[var(--row-bg,var(--surface))] shadow-[inset_1px_0_0_var(--border)] group-hover:bg-[var(--row-hover)]";

/** 冻结列表头：底色跟随表头行（bg-surface-2），层级高于吸顶表头，横向滚动时压住其它表头；末列同样收窄右 padding。 */
export const FROZEN_COLUMN_HEADER_CLASS =
  "sticky right-0 z-[var(--z-sticky-head)] pr-2 bg-surface-2 shadow-[inset_1px_0_0_var(--border)]";

/**
 * 操作列单元格内容的统一包装（W6 ticket 10 / user story 38）：表格组件对 sticky 列的
 * 单元格内容套一层 flex justify-end，让按钮组贴近表格右边缘，而不是停在列左侧留白。
 * 只对 td 内容生效（th 由 align 控制文本对齐）。
 */
export const ACTION_CELL_WRAPPER_CLASS = "flex justify-end";

/**
 * 固定布局表格（W8 t03）：table-layout: fixed —— 列宽只由列定义 width 决定，
 * 单元格内容（测试结果出现、按钮文案变化）不再反过来改变列宽。
 */
export const TABLE_FIXED_LAYOUT_CLASS = "table-fixed";

/**
 * 固定布局表格的操作列内容包装（W8 t03）：在右贴边的基础上，把行内按钮的最小宽度固定为
 * 3.5rem——文案在「测试 / 测试中」、空态与结果态之间切换时按钮不塌缩，操作列不抖动。
 * 仅在 `layout="fixed"` 的表格（及密钥表）使用；普通表格继续用 ACTION_CELL_WRAPPER_CLASS。
 */
export const STABLE_ACTION_CELL_WRAPPER_CLASS =
  ACTION_CELL_WRAPPER_CLASS + " [&_button]:min-w-14";

/**
 * 结果列固定两行槽位（W8 t03）：第一行 22px（结果徽章/摘要）、第二行 18px（时间/补充），
 * 空槽也占位——测试结果出现/消失时行高不变。
 */
export const RESULT_CELL_SLOT_CLASS = "grid grid-rows-[1.375rem_1.125rem] gap-0.5";
/** 结果列槽位第一行（徽章/摘要）。 */
export const RESULT_CELL_PRIMARY_CLASS = "flex min-w-0 items-center gap-1.5 overflow-hidden";
/** 结果列槽位第二行（时间/补充信息），空串也保留占位行。 */
export const RESULT_CELL_SECONDARY_CLASS = "block truncate text-2xs";
/** 结果列槽位固定行数：DOM 断言与 SSR 检查用它证明「两行槽位」不随状态变化。 */
export const RESULT_CELL_LINE_COUNT = 2;

/**
 * 列宽 → 表头/单元格内联样式（table-fixed 取首行表头宽度）。未声明 width 时不出样式，
 * 由固定布局把剩余宽度留给唯一未声明宽度的弹性列。
 */
export function tableColumnWidthStyle(meta?: TableColumnLayoutMeta): CSSProperties | undefined {
  return meta?.width ? { width: meta.width } : undefined;
}

/**
 * 操作列固定宽度（W8 t03）：按行内按钮数量换算，保证结果/按钮文案变化时操作列宽度恒定。
 * - 带图标 dense ActionButton 自然宽 4rem（图标 14 + 间距 8 + 2 汉字 26 + 左右 padding 16）；
 * - 纯文字 dense 按钮传 buttonWidthRem=3.5（密钥表）；
 * - 间距 0.25rem（gap-1）、单元格左右 padding 1.5rem（px-3 + 冻结列 pr-2 的余量）。
 */
export function actionColumnWidth(buttonCount: number, buttonWidthRem = 4): string {
  const count = Math.max(1, Math.trunc(buttonCount));
  const width = count * buttonWidthRem + (count - 1) * 0.25 + 1.5;
  return String(Math.round(width * 100) / 100).replace(/\.0+$/, "") + "rem";
}

/** 列的对齐类：th 与 td 共用，保证头身同侧。 */
export function tableColumnAlignClass(align?: TableColumnAlign): string | undefined {
  return align ? ALIGN_CLASS[align] : undefined;
}

/** sticky 尾列 = 操作列约定（W5 D1 + W6 ticket 10）：未显式声明 align 时默认右对齐，头身同侧。 */
function resolvedAlign(meta: TableColumnLayoutMeta): TableColumnAlign | undefined {
  return meta.align ?? (meta.sticky === "right" ? "right" : undefined);
}

/** th 完整类：对齐 + 冻结表头 + 逃生通道（调用方需在 cn 中最后合并本返回值以覆盖默认类）。 */
export function tableColumnHeaderClass(meta?: TableColumnLayoutMeta): string | undefined {
  if (!meta) return undefined;
  return cn(
    tableColumnAlignClass(resolvedAlign(meta)),
    meta.sticky === "right" && FROZEN_COLUMN_HEADER_CLASS,
    meta.className,
    meta.headerClassName,
  );
}

/** td 完整类：对齐 + 冻结单元格 + 逃生通道。 */
export function tableColumnCellClass(meta?: TableColumnLayoutMeta): string | undefined {
  if (!meta) return undefined;
  return cn(
    tableColumnAlignClass(resolvedAlign(meta)),
    meta.sticky === "right" && FROZEN_COLUMN_CELL_CLASS,
    meta.className,
  );
}

/**
 * 行状态底色（W6 ticket 10 / user story 41/43）：关闭行 neutral 微灰、冷却行 warning 微黄，
 * 用 index.css 的 --neutral-soft / --warning-soft（浅深各一套）。
 * 冷却行不置尾只变色；关闭行变色 + 默认置尾（置尾见 lib/table-order）。
 * 类名必须是字面量：Tailwind 扫描不到模板字符串拼出来的类。
 */
export type TableRowTone = "neutral" | "warning";

const ROW_TONE_BG_CLASS: Record<TableRowTone, string> = {
  neutral: "bg-[var(--neutral-soft)]",
  warning: "bg-[var(--warning-soft)]",
};

const ROW_TONE_CSS_VAR: Record<TableRowTone, string> = {
  neutral: "--neutral-soft",
  warning: "--warning-soft",
};

/** 行色对应的 TR 追加类。 */
export function rowToneClass(tone?: TableRowTone): string | undefined {
  return tone ? ROW_TONE_BG_CLASS[tone] : undefined;
}

/** 行色对应的 TR 内联样式：把同一色调写进 --row-bg，冻结列（bg-[var(--row-bg,…)]）同步着色不断层。 */
export function rowToneTrStyle(tone?: TableRowTone): CSSProperties | undefined {
  if (!tone) return undefined;
  return { "--row-bg": `var(${ROW_TONE_CSS_VAR[tone]})` } as CSSProperties;
}
