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
      // 对齐镜像（DESIGN-AUDIT 四期 §2）：默认 text-left；列定义传 text-right / text-center
      // 等对齐类时经 cn（tailwind-merge）覆盖默认值，供「头身同用」的列定义保证表头与表体同侧对齐。
      className={cn("h-9 select-none px-3 text-left text-2xs font-medium text-faint", className)}
      {...rest}
    />
  );
}

export function TR({ className, ...rest }: HTMLAttributes<HTMLTableRowElement>) {
  return <tr className={cn("border-t border-border hover:bg-surface-2/40", className)} {...rest} />;
}

export function TD({ className, ...rest }: TdHTMLAttributes<HTMLTableCellElement>) {
  return <td className={cn("px-3 py-2 align-middle text-body", className)} {...rest} />;
}
