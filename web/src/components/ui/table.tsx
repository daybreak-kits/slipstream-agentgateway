import type { HTMLAttributes, TdHTMLAttributes, ThHTMLAttributes } from "react";

import { cn } from "@/lib/utils";

export function TableWrap({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("w-full overflow-x-auto", className)} {...rest} />;
}

export function Table({ className, ...rest }: HTMLAttributes<HTMLTableElement>) {
  return <table className={cn("w-full caption-bottom text-2sm", className)} {...rest} />;
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
