import type { HTMLAttributes, ReactNode, TdHTMLAttributes, ThHTMLAttributes } from "react";

import {
  RESULT_CELL_PRIMARY_CLASS,
  RESULT_CELL_SECONDARY_CLASS,
  RESULT_CELL_SLOT_CLASS,
  TABLE_FIXED_LAYOUT_CLASS,
} from "@/lib/table-columns";
import { cn } from "@/lib/utils";

export function TableWrap({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div data-slot="table-wrap" className={cn("w-full overflow-x-auto", className)} {...rest} />;
}

export interface TableProps extends HTMLAttributes<HTMLTableElement> {
  /** 固定布局（W8 t03）：列宽只由列定义的 width 决定，内容/状态变化不再改变列宽。 */
  fixed?: boolean;
}

export function Table({ className, fixed = false, ...rest }: TableProps) {
  return (
    <table
      className={cn(
        "w-full caption-bottom text-2sm",
        fixed && TABLE_FIXED_LAYOUT_CLASS,
        className,
      )}
      {...rest}
    />
  );
}

export function THead({ className, ...rest }: HTMLAttributes<HTMLTableSectionElement>) {
  return <thead className={cn("bg-surface-2/60", className)} {...rest} />;
}

export function TH({ className, ...rest }: ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th
      // 表头行节奏（DESIGN-AUDIT 四期 §2 / W5 D1）：与 TD 同档 h-9、显式 align-middle 垂直居中；
      // 字号仍是 12px，但行盒用 leading-5 与正文 20px 行高对齐，不再让表头单独撑高。
      // 旧实现 h-9 + 12/18 行盒 vs 紧凑正文 32px，造成「头高身矮」与表头/按钮不居中。
      // 默认 text-left；列定义传 text-right / text-center（列元数据 align）时经 cn 覆盖默认值，
      // 保证表头与表体同侧对齐。
      className={cn(
        "h-9 select-none px-3 text-left align-middle text-2xs font-medium leading-5 text-faint",
        className,
      )}
      {...rest}
    />
  );
}

export function TR({ className, ...rest }: HTMLAttributes<HTMLTableRowElement>) {
  return (
    <tr
      // group + --row-hover（W5 D1）：冻结列（sticky right-0）必须有与行悬浮一致的不透明底色，
      // 否则 hover 时冻结单元格与相邻单元格出现色块断层；--row-hover 在 index.css 浅/深各一套。
      className={cn("group border-t border-border hover:bg-[var(--row-hover)]", className)}
      {...rest}
    />
  );
}

export function TD({ className, ...rest }: TdHTMLAttributes<HTMLTableCellElement>) {
  return (
    <td
      // 行高节奏固定为 h-9（36px，与表头同档）：正文行盒 20px 垂直居中，行内按钮（28px）也装得下，
      // 不再出现表头 36 / 正文随按钮 44–48 的错位；py-1 只是内容超高时的兜底内边距。
      className={cn("h-9 px-3 py-1 align-middle text-body", className)}
      {...rest}
    />
  );
}

export interface ResultCellProps extends HTMLAttributes<HTMLSpanElement> {
  /** 第一行：结果徽章 / 摘要。 */
  primary: ReactNode;
  /** 第二行：时间 / 补充信息；不传也保留空行占位。 */
  secondary?: ReactNode;
  primaryClassName?: string;
  secondaryClassName?: string;
}

/**
 * 结果列固定两行槽位（W8 t03）：第一行 22px、第二行 18px 写死，空槽也占位。
 * 测试结果从无到有时只填充槽位内容，行高与列宽不变（密钥表 / 最近探测 / 模型测试结果共用）。
 */
export function ResultCell({
  primary,
  secondary,
  primaryClassName,
  secondaryClassName,
  className,
  ...rest
}: ResultCellProps) {
  return (
    <span data-slot="result-cell" className={cn(RESULT_CELL_SLOT_CLASS, className)} {...rest}>
      <span className={cn(RESULT_CELL_PRIMARY_CLASS, primaryClassName)}>{primary}</span>
      <span className={cn(RESULT_CELL_SECONDARY_CLASS, secondaryClassName)}>{secondary}</span>
    </span>
  );
}
