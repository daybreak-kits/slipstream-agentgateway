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
  /** 仅追加到 th 的覆盖通道（列宽、多行表头等）。 */
  headerClassName?: string;
}

const ALIGN_CLASS: Record<TableColumnAlign, string> = {
  left: "text-left",
  center: "text-center",
  right: "text-right",
};

/**
 * 冻结列单元格：不透明底色（否则横向滚动时下层内容会透出）+ 左侧分割阴影 + 列层级
 * （高于表体、低于吸顶表头，见 index.css 的 --z-sticky-column / --z-sticky-head）；
 * 行悬浮由 TR 的 group 与 --row-hover 同步，避免 hover 时出现色块断层。
 */
export const FROZEN_COLUMN_CELL_CLASS =
  "sticky right-0 z-[var(--z-sticky-column)] bg-surface shadow-[inset_1px_0_0_var(--border)] group-hover:bg-[var(--row-hover)]";

/** 冻结列表头：底色跟随表头行（bg-surface-2），层级高于吸顶表头，横向滚动时压住其它表头。 */
export const FROZEN_COLUMN_HEADER_CLASS =
  "sticky right-0 z-[var(--z-sticky-head)] bg-surface-2 shadow-[inset_1px_0_0_var(--border)]";

/** 列的对齐类：th 与 td 共用，保证头身同侧。 */
export function tableColumnAlignClass(align?: TableColumnAlign): string | undefined {
  return align ? ALIGN_CLASS[align] : undefined;
}

/** th 完整类：对齐 + 冻结表头 + 逃生通道（调用方需在 cn 中最后合并本返回值以覆盖默认类）。 */
export function tableColumnHeaderClass(meta?: TableColumnLayoutMeta): string | undefined {
  if (!meta) return undefined;
  return cn(
    tableColumnAlignClass(meta.align),
    meta.sticky === "right" && FROZEN_COLUMN_HEADER_CLASS,
    meta.className,
    meta.headerClassName,
  );
}

/** td 完整类：对齐 + 冻结单元格 + 逃生通道。 */
export function tableColumnCellClass(meta?: TableColumnLayoutMeta): string | undefined {
  if (!meta) return undefined;
  return cn(
    tableColumnAlignClass(meta.align),
    meta.sticky === "right" && FROZEN_COLUMN_CELL_CLASS,
    meta.className,
  );
}
