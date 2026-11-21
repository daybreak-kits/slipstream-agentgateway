import { ArrowDownNarrowWide, ArrowUpNarrowWide, ArrowUpDown } from "lucide-react";

/** 排序方向：false = 未排序。 */
export type SortDirection = "asc" | "desc" | false;

/**
 * 可排序列的三态指示（W6 ticket 10 / user story 44），DataTable 等表格共用，
 * 不再各自实现图标语义：未排序 ArrowUpDown（常驻可见，否则看不出列可排序）、
 * 升序 ArrowUpNarrowWide（上窄下宽）、降序 ArrowDownNarrowWide（下窄上宽）。
 */
export function SortIndicator({ direction }: { direction: SortDirection }) {
  const Icon = direction === "asc" ? ArrowUpNarrowWide : direction === "desc" ? ArrowDownNarrowWide : ArrowUpDown;
  const label = direction === "asc" ? "升序" : direction === "desc" ? "降序" : "未排序";
  return <Icon className="h-3 w-3 text-faint" aria-label={label} />;
}
