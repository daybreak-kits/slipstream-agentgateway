import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ListFilter, Settings2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Empty } from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { PAGE_SIZE_OPTIONS, Pagination } from "@/components/ui/pagination";
import { Skeleton } from "@/components/ui/skeleton";
import { SortIndicator } from "@/components/ui/sort-indicator";
import { Table, TableWrap, TD, TH, THead, TR } from "@/components/ui/table";
import {
  ACTION_CELL_WRAPPER_CLASS,
  tableColumnCellClass,
  tableColumnHeaderClass,
  type TableColumnLayoutMeta,
} from "@/lib/table-columns";
import { cn } from "@/lib/utils";

/** 列显隐持久化（DESIGN-AUDIT §2）：key=slipstream.cols.pricing，按段存隐藏列 key 数组。 */
const COLS_STORAGE_KEY = "slipstream.cols.pricing";

type ColsMap = Record<string, string[]>;

function readHiddenCols(sectionKey: string): string[] {
  try {
    const raw = localStorage.getItem(COLS_STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    const entry = (parsed as ColsMap | null)?.[sectionKey];
    return Array.isArray(entry) ? entry.filter((item) => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function writeHiddenCols(sectionKey: string, hidden: string[]): void {
  try {
    let map: ColsMap = {};
    const raw = localStorage.getItem(COLS_STORAGE_KEY);
    if (raw) {
      const parsed: unknown = JSON.parse(raw);
      if (parsed && typeof parsed === "object") map = parsed as ColsMap;
    }
    map[sectionKey] = hidden;
    localStorage.setItem(COLS_STORAGE_KEY, JSON.stringify(map));
  } catch {
    // 存储不可用（隐私模式）时列设置只在当前会话生效
  }
}

/** 价目页列定义：align/sticky 与 DataTable/ModelsTable 共用 lib/table-columns。 */
export interface PriceColumn<T> extends TableColumnLayoutMeta {
  key: string;
  /** 列设置菜单里的名称；表头默认渲染它，需要单位副行等复杂表头时用 header 覆盖。 */
  label: string;
  header?: ReactNode;
  cell: (row: T) => ReactNode;
  /** 可排序列（DESIGN-AUDIT §2）：点击表头循环 升 → 降 → 取消。 */
  sortable?: boolean;
  /** 排序取值；null（未配价等）恒排在最后。 */
  sortValue?: (row: T) => number | string | null;
  hideable?: boolean;
}

interface PriceTableProps<T> {
  columns: PriceColumn<T>[];
  /** 当前筛选后的行 */
  rows: T[];
  /** 未筛选的总行数（区分「无数据 / 无匹配」双空态） */
  totalCount: number;
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
  /** 列显隐持久化的段内条目（slipstream.cols.pricing 下的 key） */
  sectionKey: string;
  searchText: string;
  onSearchChange: (value: string) => void;
  searchPlaceholder: string;
  /** 筛选行内容（未配价开关等筛选控件） */
  toolbarStart?: ReactNode;
  /** 筛选行尾内容（批量操作区），不得插入新块挤动布局 */
  toolbarEnd?: ReactNode;
  emptyText: string;
  emptyAction?: ReactNode;
  onClearFilters: () => void;
  rowKey: (row: T) => string;
}

type SortDir = "asc" | "desc";

/** 价目页表格（DESIGN-AUDIT §2）：筛选行 + 行尾批量区、列显隐、表头排序、sticky 表头、
 * 紧凑行高、无数据/无匹配双空态 + 清除筛选 CTA、分页。 */
export function PriceTable<T>({
  columns, rows, totalCount, loading = false, error, onRetry,
  sectionKey, searchText, onSearchChange, searchPlaceholder,
  toolbarStart, toolbarEnd, emptyText, emptyAction, onClearFilters, rowKey,
}: PriceTableProps<T>) {
  const [hiddenCols, setHiddenCols] = useState<string[]>(() => readHiddenCols(sectionKey));
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [pageIndex, setPageIndex] = useState(1);
  const [pageSize, setPageSize] = useState<number>(PAGE_SIZE_OPTIONS[0] ?? 50);

  // 换段重置排序；筛选条件变化回到第一页；rows 长度变化（刷新）不重置，避免翻页中被打断。
  useEffect(() => {
    setPageIndex(1);
    setSortKey(null);
  }, [sectionKey]);
  useEffect(() => {
    setPageIndex(1);
  }, [searchText]);

  const visibleColumns = useMemo(
    () => columns.filter((col) => col.hideable === false || !hiddenCols.includes(col.key)),
    [columns, hiddenCols],
  );
  const toggleCol = (key: string) => {
    setHiddenCols((prev) => {
      const next = prev.includes(key) ? prev.filter((item) => item !== key) : [...prev, key];
      writeHiddenCols(sectionKey, next);
      return next;
    });
  };
  const resetCols = () => {
    setHiddenCols([]);
    writeHiddenCols(sectionKey, []);
  };

  const sortedRows = useMemo(() => {
    if (!sortKey) return rows;
    const col = columns.find((item) => item.key === sortKey);
    if (!col?.sortValue) return rows;
    const dir = sortDir === "asc" ? 1 : -1;
    return [...rows].sort((a, b) => {
      const va = col.sortValue!(a);
      const vb = col.sortValue!(b);
      if (va === null && vb === null) return 0;
      if (va === null) return 1;
      if (vb === null) return -1;
      if (typeof va === "number" && typeof vb === "number") return (va - vb) * dir;
      return String(va).localeCompare(String(vb), "zh") * dir;
    });
  }, [rows, columns, sortKey, sortDir]);

  const toggleSort = (col: PriceColumn<T>) => {
    if (!col.sortable || !col.sortValue) return;
    if (sortKey !== col.key) {
      setSortKey(col.key);
      setSortDir("asc");
      return;
    }
    if (sortDir === "asc") setSortDir("desc");
    else setSortKey(null); // 升 → 降 → 取消
  };

  const totalPages = Math.max(1, Math.ceil(sortedRows.length / Math.max(1, pageSize)));
  const currentPage = Math.min(pageIndex, totalPages);
  const pageRows = sortedRows.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  const colCount = visibleColumns.length;
  const noMatch = totalCount > 0 && sortedRows.length === 0;

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={searchText}
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder={searchPlaceholder}
          aria-label="搜索"
          className="h-8 w-56"
        />
        {toolbarStart}
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {toolbarEnd}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" aria-label="列设置">
                <Settings2 className="h-3.5 w-3.5" /> 列设置
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44">
              <DropdownMenuLabel>显示列</DropdownMenuLabel>
              {columns.filter((col) => col.hideable !== false).map((col) => (
                <DropdownMenuCheckboxItem
                  key={col.key}
                  checked={!hiddenCols.includes(col.key)}
                  onCheckedChange={() => toggleCol(col.key)}
                  onSelect={(event) => event.preventDefault()}
                >
                  {col.label}
                </DropdownMenuCheckboxItem>
              ))}
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={resetCols}>恢复默认</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
      {/* 表体内部滚动（DESIGN-AUDIT 四期 §3/§9）：高度公式与 DataTable 一致（17rem 起步，不设最小高度）。 */}
      <TableWrap className="table-responsive overflow-y-auto rounded-lg border border-border bg-surface">
        <Table>
          <THead>
            <tr>
              {visibleColumns.map((col) => (
                <TH
                  key={col.key}
                  onClick={col.sortable && col.sortValue ? () => toggleSort(col) : undefined}
                  className={cn(
                    "sticky top-0 z-[var(--z-sticky)] bg-surface-2 h-8",
                    col.sortable && col.sortValue && "cursor-pointer hover:text-body",
                    tableColumnHeaderClass(col),
                  )}
                >
                  <span className="inline-flex items-center gap-1">
                    {col.header ?? col.label}
                    {/* W6 ticket 11：三态指示复用共享 SortIndicator——未排序 ArrowUpDown 常驻（否则看不出列可排序），
                        升序 ArrowUpNarrowWide、降序 ArrowDownNarrowWide，不再各自维护两态图标。 */}
                    {col.sortable && col.sortValue ? (
                      <SortIndicator direction={sortKey === col.key ? sortDir : false} />
                    ) : null}
                  </span>
                </TH>
              ))}
            </tr>
          </THead>
          <tbody data-testid="data-table-body">
            {loading ? (
              Array.from({ length: 5 }, (_, i) => (
                <TR key={i}>
                  {visibleColumns.map((col) => (
                    <TD key={col.key} className={cn("h-8 py-0.5", tableColumnCellClass(col))}>
                      <Skeleton className="h-4 w-full max-w-40" />
                    </TD>
                  ))}
                </TR>
              ))
            ) : error ? (
              <tr>
                <td colSpan={colCount}>
                  <div className="flex flex-col items-center justify-center gap-2 py-12 text-center">
                    <p className="text-sm text-danger-text">加载失败：{error}</p>
                    {onRetry && <Button variant="outline" size="sm" onClick={onRetry}>重试</Button>}
                  </div>
                </td>
              </tr>
            ) : noMatch ? (
              <tr>
                <td colSpan={colCount}>
                  <Empty
                    icon={ListFilter}
                    title="没有匹配的行"
                    description="换个关键词，或清除筛选查看全部。"
                    action={
                      <Button variant="outline" size="sm" onClick={onClearFilters}>清除筛选</Button>
                    }
                  />
                </td>
              </tr>
            ) : sortedRows.length === 0 ? (
              <tr>
                <td colSpan={colCount}>
                  <Empty text={emptyText} action={emptyAction} />
                </td>
              </tr>
            ) : (
              pageRows.map((row, index) => (
                <TR key={rowKey(row) ?? index}>
                  {visibleColumns.map((col) => (
                    <TD key={col.key} className={cn("h-8 py-0.5", tableColumnCellClass(col))}>
                      {/* W6 ticket 11：操作列（sticky 尾列）内容统一 flex justify-end 贴右边缘，
                          与 DataTable/ModelsTable 同一机制，页面不再各自手写对齐。 */}
                      {col.sticky === "right" ? (
                        <div className={ACTION_CELL_WRAPPER_CLASS}>{col.cell(row)}</div>
                      ) : (
                        col.cell(row)
                      )}
                    </TD>
                  ))}
                </TR>
              ))
            )}
          </tbody>
        </Table>
      </TableWrap>
      <Pagination
        page={currentPage}
        pageSize={pageSize}
        total={sortedRows.length}
        onPageChange={setPageIndex}
        onPageSizeChange={(size) => {
          setPageSize(size);
          setPageIndex(1);
        }}
        className="rounded-lg border border-border bg-surface"
      />
    </div>
  );
}
