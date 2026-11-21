import { useEffect, useMemo, useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Empty } from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { PAGE_SIZE_OPTIONS, Pagination } from "@/components/ui/pagination";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableWrap, TD, TH, THead, TR } from "@/components/ui/table";
import {
  ACTION_CELL_WRAPPER_CLASS,
  rowToneClass,
  rowToneTrStyle,
  tableColumnCellClass,
  tableColumnHeaderClass,
  type TableColumnLayoutMeta,
  type TableRowTone,
} from "@/lib/table-columns";
import { partitionClosedLast } from "@/lib/table-order";
import { SELECT_ALL_VALUE } from "@/lib/select-sentinels";
import { cn } from "@/lib/utils";
import { ListFilter, Settings2 } from "lucide-react";

/** 列定义：align/sticky 与 DataTable/PriceTable 共用 lib/table-columns；hideable 默认 true。 */
export interface ModelColumn<T> extends TableColumnLayoutMeta {
  key: string;
  /** 列设置菜单里的名称；表头默认渲染它，需要更复杂表头时用 header 覆盖。 */
  label: string;
  header?: ReactNode;
  cell: (row: T) => ReactNode;
  /** false = 勾选列/操作列等固定列，不进列设置菜单。 */
  hideable?: boolean;
}

interface ModelsTableProps<T> {
  columns: ModelColumn<T>[];
  /** 当前筛选后的行 */
  rows: T[];
  /** 未筛选的总行数（区分「无数据 / 无匹配」空态） */
  totalCount: number;
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
  /** 列显隐持久化：localStorage 里 key 下的本 Tab 条目（隐藏列 key 数组） */
  storageKey: string;
  tabKey: string;
  searchText: string;
  onSearchChange: (value: string) => void;
  searchPlaceholder: string;
  /** 类型下拉筛选；不传则不渲染（公开模型没有类型维度） */
  typeFilter?: {
    value: string;
    onChange: (value: string) => void;
    options: Array<{ value: string; label: string }>;
  };
  /** 筛选行尾内容（批量操作按钮组），不得插入新块挤动布局 */
  toolbarEnd?: ReactNode;
  emptyText: string;
  emptyAction?: ReactNode;
  onClearFilters: () => void;
  /** 行点击回调（W4-C：公开模型整行进入整页编辑器）；传入后行加 cursor-pointer。行内按钮/复选框的点击不触发。 */
  onRowClick?: (row: T) => void;
  /** W6 ticket 10（user story 41）：返回 true 的行默认置尾（本表无列排序，「默认」恒成立）。
   * 稳定分区在分页切片前做，跨页顺序一致。 */
  closedLast?: (row: T) => boolean;
  /** W6 ticket 10（user story 41/43）：行状态底色（neutral=关闭微灰 / warning=冷却微黄），
   * 冻结列经 --row-bg 同步着色。冷却行只变色不置尾。 */
  rowTone?: (row: T) => TableRowTone | undefined;
}

type ColsMap = Record<string, string[]>;

function readHiddenCols(storageKey: string, tabKey: string): string[] {
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as ColsMap;
    const entry = parsed?.[tabKey];
    return Array.isArray(entry) ? entry.filter((item) => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function writeHiddenCols(storageKey: string, tabKey: string, hidden: string[]): void {
  try {
    let map: ColsMap = {};
    const raw = localStorage.getItem(storageKey);
    if (raw) {
      const parsed = JSON.parse(raw) as unknown;
      if (parsed && typeof parsed === "object") map = parsed as ColsMap;
    }
    map[tabKey] = hidden;
    localStorage.setItem(storageKey, JSON.stringify(map));
  } catch {
    // 存储不可用（隐私模式）时列设置只在当前会话生效
  }
}

/** 模型管理页专用表格（DESIGN-AUDIT §2）：筛选行 + 行尾批量区、列显隐、sticky 表头、
 * 紧凑行高、无数据/无匹配双空态 + 清除筛选 CTA、分页。 */
export function ModelsTable<T>({
  columns, rows, totalCount, loading = false, error, onRetry,
  storageKey, tabKey, searchText, onSearchChange, searchPlaceholder,
  typeFilter, toolbarEnd, emptyText, emptyAction, onClearFilters, onRowClick,
  closedLast, rowTone,
}: ModelsTableProps<T>) {
  const [hiddenCols, setHiddenCols] = useState<string[]>(() => readHiddenCols(storageKey, tabKey));
  const [pageIndex, setPageIndex] = useState(1);
  const [pageSize, setPageSize] = useState<number>(PAGE_SIZE_OPTIONS[0] ?? 50);

  // 筛选条件变化回到第一页；rows 长度变化（刷新）不重置，避免翻页中被打断。
  useEffect(() => {
    setPageIndex(1);
  }, [searchText, typeFilter?.value]);

  const visibleColumns = useMemo(
    () => columns.filter((col) => col.hideable === false || !hiddenCols.includes(col.key)),
    [columns, hiddenCols],
  );
  const toggleCol = (key: string) => {
    setHiddenCols((prev) => {
      const next = prev.includes(key) ? prev.filter((item) => item !== key) : [...prev, key];
      writeHiddenCols(storageKey, tabKey, next);
      return next;
    });
  };
  const resetCols = () => {
    setHiddenCols([]);
    writeHiddenCols(storageKey, tabKey, []);
  };

  const totalPages = Math.max(1, Math.ceil(rows.length / Math.max(1, pageSize)));
  const currentPage = Math.min(pageIndex, totalPages);
  // W6 ticket 10：关闭行置尾在分页切片前分区（稳定，启用行保持原序），跨页顺序一致。
  const orderedRows = useMemo(
    () => (closedLast ? partitionClosedLast(rows, closedLast) : rows),
    [closedLast, rows],
  );
  const pageRows = orderedRows.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  const colCount = visibleColumns.length;
  const noMatch = totalCount > 0 && rows.length === 0;

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
        {typeFilter ? (
          <Select value={typeFilter.value} onValueChange={typeFilter.onChange}>
            <SelectTrigger aria-label="按类型筛选" className="h-8 w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={SELECT_ALL_VALUE}>全部类型</SelectItem>
              {typeFilter.options.map((option) => (
                <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : null}
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
                  className={cn(
                    "sticky top-0 z-[var(--z-sticky)] bg-surface-2 h-8",
                    tableColumnHeaderClass(col),
                  )}
                >
                  {col.header ?? col.label}
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
                    title="没有匹配的模型"
                    description="换个关键词，或清除筛选查看全部。"
                    action={
                      <Button variant="outline" size="sm" onClick={onClearFilters}>清除筛选</Button>
                    }
                  />
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={colCount}>
                  <Empty text={emptyText} action={emptyAction} />
                </td>
              </tr>
            ) : (
              pageRows.map((row, index) => {
                const tone = rowTone?.(row);
                return (
                <TR
                  key={(row as { id?: string }).id ?? index}
                  className={cn(onRowClick ? "cursor-pointer" : undefined, rowToneClass(tone))}
                  style={rowToneTrStyle(tone)}
                  onClick={onRowClick
                    ? (event) => {
                        // 行内按钮/复选框/链接有自己的动作，不再触发行点击
                        const target = event.target as HTMLElement;
                        if (target.closest("button, a, input, label, [role='checkbox'], [role='menuitem']")) return;
                        onRowClick(row);
                      }
                    : undefined}
                >
                  {visibleColumns.map((col) => (
                    <TD key={col.key} className={cn("h-8 py-0.5", tableColumnCellClass(col))}>
                      {/* W6 ticket 10：操作列（sticky 尾列）内容统一 flex justify-end 贴右边缘。 */}
                      {col.sticky === "right" ? (
                        <div className={ACTION_CELL_WRAPPER_CLASS}>{col.cell(row)}</div>
                      ) : (
                        col.cell(row)
                      )}
                    </TD>
                  ))}
                </TR>
                );
              })
            )}
          </tbody>
        </Table>
      </TableWrap>
      <Pagination
        page={currentPage}
        pageSize={pageSize}
        total={rows.length}
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
