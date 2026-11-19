import { useMemo, useRef, useState, type ReactNode } from "react";
import {
  flexRender, getCoreRowModel, getFilteredRowModel, getPaginationRowModel,
  getSortedRowModel, useReactTable, type ColumnDef, type SortingState,
} from "@tanstack/react-table";
import { ArrowDown, ArrowUp, Settings2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Empty } from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { PAGE_SIZE_OPTIONS, Pagination } from "@/components/ui/pagination";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableWrap, TD, TH, THead, TR } from "@/components/ui/table";
import { cn } from "@/lib/utils";

/** 稳定的空数据引用：`data ?? []` 每次渲染都会新建数组，会让 TanStack Table
 * 的行模型 memo 每次都判定「数据变了」，进而触发 _autoResetPageIndex 排微任务
 * 重置页码 → setState → 再渲染 → 再新建数组的同步死循环（真实浏览器卡死）。 */
const EMPTY_ROWS: never[] = [];

/** 单元格/表头渲染函数。 */
type CellRenderer = (context: unknown) => ReactNode;

/** 列定义里的 cell/header 通常是页面里新建的行内箭头函数：每次渲染身份都变。
 * flexRender 会把函数当作组件类型渲染，函数身份一变 React 就卸载并重建整个单元格子树——
 * 单元格里的输入框会在每次输入时被替换（价目管理的成本单价输入框因此每敲一个字符就丢焦点，
 * 没法连续输入）。这里按「用途 + 列位置」缓存稳定的包装组件，内部始终调用最新的列定义，
 * 从而让 React 只更新内容、不重建 DOM。 */
function stableColumnRenderer(
  cache: Map<string, CellRenderer>,
  latestColumns: { current: unknown[] },
  kind: "header" | "cell",
  index: number,
): CellRenderer {
  const cacheKey = kind + ":" + index;
  const cached = cache.get(cacheKey);
  if (cached) return cached;
  const renderer: CellRenderer = (context) => {
    const column = latestColumns.current[index] as Record<string, unknown> | undefined;
    const render = column ? column[kind] : undefined;
    if (typeof render === "function") return (render as CellRenderer)(context);
    return (render as ReactNode) ?? null;
  };
  cache.set(cacheKey, renderer);
  return renderer;
}

/** 列显隐持久化：JSON 字符串数组（隐藏列 id）；存储不可用（隐私模式）时只在当前会话生效。 */
function readHiddenCols(storageKey: string | undefined): string[] {
  if (!storageKey) return [];
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((item) => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function writeHiddenCols(storageKey: string | undefined, hidden: string[]): void {
  if (!storageKey) return;
  try {
    localStorage.setItem(storageKey, JSON.stringify(hidden));
  } catch {
    // 存储不可用（隐私模式）时列设置只在当前会话生效
  }
}
/** 分页模式：client 在当前数据里切页；server 只展示当前页，翻页/换档位交给调用方。 */
export type DataTablePaging =
  | { mode: "client" }
  | {
      mode: "server";
      offset: number;
      pageSize: number;
      total: number;
      onOffsetChange: (offset: number) => void;
      onPageSizeChange: (pageSize: number) => void;
    };

interface DataTableProps<T> {
  columns: ColumnDef<T, unknown>[];
  data: T[] | undefined;
  loading?: boolean;
  /** 请求失败信息；非空时显示错误态（带重试），不再误报「暂无数据」 */
  error?: string | null;
  /** 错误态重试回调；配合 error 使用 */
  onRetry?: () => void;
  emptyText?: string;
  /** 空态主操作（CTA），如「新建上游」 */
  emptyAction?: ReactNode;
  filterPlaceholder?: string;
  /** 初始每页条数，档位来自后端（默认 50）；仅 client 模式生效 */
  pageSize?: (typeof PAGE_SIZE_OPTIONS)[number];
  /** 不传等价于 `{mode:"client"}`，保持既有页面行为不变 */
  paging?: DataTablePaging;
  /** 列显隐持久化（DESIGN-AUDIT §2）：localStorage key 存隐藏列 id 数组，如 slipstream.cols.audits */
  storageKey?: string;
  /** 列设置菜单的展示名：表头为函数/自定义节点时用它补充（键为列 id） */
  columnLabels?: Record<string, string>;
}

/** 全站统一的表格封装：排序 / 全局筛选 / 分页 / 空态 / 加载骨架。 */
export function DataTable<T>({
  columns, data, loading = false, error, onRetry, emptyText = "暂无数据", emptyAction, filterPlaceholder,
  pageSize = 50, paging, storageKey, columnLabels,
}: DataTableProps<T>) {
  const [sorting, setSorting] = useState<SortingState>([]);
  const [globalFilter, setGlobalFilter] = useState("");
  const [hiddenCols, setHiddenCols] = useState<string[]>(() => readHiddenCols(storageKey));
  const serverPaging = paging?.mode === "server" ? paging : undefined;
  const columnVisibility = useMemo(
    () => Object.fromEntries(hiddenCols.map((id) => [id, false])),
    [hiddenCols],
  );

  // 稳定的单元格/表头包装器：列定义可以每次渲染都新建，但 React 看到的组件类型不变，
  // 单元格里的输入框因此不会被卸载重建（详见 stableColumnRenderer 注释）。
  const latestColumnsRef = useRef<ColumnDef<T, unknown>[]>(columns);
  latestColumnsRef.current = columns;
  const renderersRef = useRef(new Map<string, CellRenderer>());
  const renderHeader = (index: number) => stableColumnRenderer(renderersRef.current, latestColumnsRef, "header", index);
  const renderCell = (index: number) => stableColumnRenderer(renderersRef.current, latestColumnsRef, "cell", index);

  const serverPageIndex = serverPaging
    ? Math.floor(serverPaging.offset / Math.max(1, serverPaging.pageSize))
    : 0;

  const table = useReactTable({
    data: data ?? EMPTY_ROWS,
    columns,
    state: {
      sorting,
      globalFilter,
      columnVisibility,
      ...(serverPaging
        ? { pagination: { pageIndex: serverPageIndex, pageSize: serverPaging.pageSize } }
        : {}),
    },
    onSortingChange: setSorting,
    onGlobalFilterChange: setGlobalFilter,
    // 服务端分页时排序/筛选只能作用于当前页；排序交给页面的查询参数，避免只排一页。
    enableSorting: serverPaging === undefined,
    manualPagination: serverPaging !== undefined,
    pageCount: serverPaging
      ? Math.max(1, Math.ceil(serverPaging.total / Math.max(1, serverPaging.pageSize)))
      : undefined,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: serverPaging ? undefined : getSortedRowModel(),
    getFilteredRowModel: serverPaging ? undefined : getFilteredRowModel(),
    getPaginationRowModel: serverPaging ? undefined : getPaginationRowModel(),
    initialState: serverPaging ? undefined : { pagination: { pageSize } },
  });

  // 列设置菜单的可隐藏列：排除操作列（id=actions）与 meta.hideable=false 的列；
  // 表头为函数时用 meta.label / columnLabels 补展示名，都没有则不进菜单。
  const hideableColumns = useMemo(() => {
    if (!storageKey) return [] as Array<{ id: string; label: string }>;
    const result: Array<{ id: string; label: string }> = [];
    for (const column of table.getVisibleLeafColumns()) {
      if (column.id === "actions") continue;
      const meta = column.columnDef.meta as { label?: string; hideable?: boolean } | undefined;
      if (meta?.hideable === false) continue;
      const header = column.columnDef.header;
      const label =
        meta?.label ??
        columnLabels?.[column.id] ??
        (typeof header === "string" && header.length > 0 ? header : undefined);
      if (label) result.push({ id: column.id, label });
    }
    return result;
  }, [storageKey, columnLabels, table]);

  const toggleColumn = (id: string) => {
    setHiddenCols((prev) => {
      const nextHidden = prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id];
      writeHiddenCols(storageKey, nextHidden);
      return nextHidden;
    });
  };
  const resetColumns = () => {
    setHiddenCols([]);
    writeHiddenCols(storageKey, []);
  };

  return (
    <div className="space-y-2">
      {(filterPlaceholder !== undefined && serverPaging === undefined) || hideableColumns.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2">
          {filterPlaceholder !== undefined && serverPaging === undefined ? (
            <Input
              value={globalFilter}
              onChange={(e) => setGlobalFilter(e.target.value)}
              placeholder={filterPlaceholder}
              className="max-w-64"
            />
          ) : null}
          {hideableColumns.length > 0 ? (
            <div className="ml-auto">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm" aria-label="列设置">
                    <Settings2 className="h-3.5 w-3.5" /> 列设置
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-44">
                  <DropdownMenuLabel>显示列</DropdownMenuLabel>
                  {hideableColumns.map((column) => (
                    <DropdownMenuCheckboxItem
                      key={column.id}
                      checked={!hiddenCols.includes(column.id)}
                      onCheckedChange={() => toggleColumn(column.id)}
                      onSelect={(event) => event.preventDefault()}
                    >
                      {column.label}
                    </DropdownMenuCheckboxItem>
                  ))}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onSelect={resetColumns}>恢复默认</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          ) : null}
        </div>
      ) : null}
      <TableWrap className="rounded-lg border border-border bg-surface">
        <Table>
          <THead>
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id}>
                {hg.headers.map((header) => {
                  const canSort = header.column.getCanSort();
                  const dir = header.column.getIsSorted();
                  return (
                    <TH
                      key={header.id}
                      onClick={canSort ? header.column.getToggleSortingHandler() : undefined}
                      className={cn(
                        canSort && "cursor-pointer hover:text-body",
                        (header.column.columnDef.meta as { className?: string } | undefined)?.className,
                      )}
                    >
                      <span className="inline-flex items-center gap-1">
                        {flexRender(renderHeader(header.column.getIndex()), header.getContext())}
                        {dir === "asc" && <ArrowUp className="h-3 w-3" />}
                        {dir === "desc" && <ArrowDown className="h-3 w-3" />}
                      </span>
                    </TH>
                  );
                })}
              </tr>
            ))}
          </THead>
          <tbody data-testid="data-table-body">
            {loading ? (
              Array.from({ length: 5 }, (_, i) => (
                <TR key={i}>
                  {table.getVisibleLeafColumns().map((col) => (
                    <TD
                      key={col.id}
                      className={(col.columnDef.meta as { className?: string } | undefined)?.className}
                    >
                      <Skeleton className="h-4 w-full max-w-40" />
                    </TD>
                  ))}
                </TR>
              ))
            ) : error ? (
              <tr>
                <td colSpan={table.getVisibleLeafColumns().length}>
                  <div className="flex flex-col items-center justify-center gap-2 py-12 text-center">
                    <p className="text-sm text-danger-text">加载失败：{error}</p>
                    {onRetry && (
                      <Button variant="outline" size="sm" onClick={onRetry}>
                        重试
                      </Button>
                    )}
                  </div>
                </td>
              </tr>
            ) : table.getRowModel().rows.length === 0 ? (
              <tr>
                <td colSpan={table.getVisibleLeafColumns().length}>
                  <Empty text={emptyText} action={emptyAction} />
                </td>
              </tr>
            ) : (
              table.getRowModel().rows.map((row) => (
                <TR key={row.id}>
                  {row.getVisibleCells().map((cell) => (
                    <TD
                      key={cell.id}
                      className={(cell.column.columnDef.meta as { className?: string } | undefined)?.className}
                    >
                      {flexRender(renderCell(cell.column.getIndex()), cell.getContext())}
                    </TD>
                  ))}
                </TR>
              ))
            )}
          </tbody>
        </Table>
      </TableWrap>
      {serverPaging ? (
        <Pagination
          page={serverPageIndex + 1}
          pageSize={serverPaging.pageSize}
          total={serverPaging.total}
          pageSizeOptions={PAGE_SIZE_OPTIONS}
          onPageChange={(page) =>
            serverPaging.onOffsetChange((page - 1) * serverPaging.pageSize)
          }
          onPageSizeChange={(size) => {
            if (size === serverPaging.pageSize) return;
            serverPaging.onPageSizeChange(size);
            serverPaging.onOffsetChange(0);
          }}
          className="rounded-lg border border-border bg-surface"
        />
      ) : (
        <Pagination
          page={table.getState().pagination.pageIndex + 1}
          pageSize={table.getState().pagination.pageSize}
          total={table.getFilteredRowModel().rows.length}
          pageSizeOptions={PAGE_SIZE_OPTIONS}
          onPageChange={(page) => table.setPageIndex(page - 1)}
          onPageSizeChange={(size) => table.setPageSize(size)}
          className="rounded-lg border border-border bg-surface"
        />
      )}
    </div>
  );
}

