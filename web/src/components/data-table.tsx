import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  flexRender, getCoreRowModel, getFilteredRowModel, getPaginationRowModel,
  getSortedRowModel, useReactTable, type ColumnDef, type SortingState,
} from "@tanstack/react-table";
import { Settings2 } from "lucide-react";

import { ACTION_ICONS } from "@/lib/icons";
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
  rowToneClass,
  rowToneTrStyle,
  STABLE_ACTION_CELL_WRAPPER_CLASS,
  tableColumnCellClass,
  tableColumnHeaderClass,
  tableColumnWidthStyle,
  type TableColumnLayoutMeta,
  type TableRowTone,
} from "@/lib/table-columns";
import { partitionClosedLast } from "@/lib/table-order";
import { cn } from "@/lib/utils";

/** 稳定的空数据引用：`data ?? []` 每次渲染都会新建数组，会让 TanStack Table
 * 的行模型 memo 每次都判定「数据变了」，进而触发 _autoResetPageIndex 排微任务
 * 重置页码 → setState → 再渲染 → 再新建数组的同步死循环（真实浏览器卡死）。 */
const EMPTY_ROWS: never[] = [];

/** 单元格/表头渲染函数。 */
type CellRenderer = (context: unknown) => ReactNode;

/** 与 TanStack 列 id 同口径解析列定义 id（table-core createColumn）：
 * 显式 id 优先，其次 accessorKey（"." 置换为 "_"），再次字符串表头；accessorFn 无 id 会被 TanStack 拒绝。 */
function columnDefId(def: unknown, index: number): string {
  const d = def as { id?: unknown; accessorKey?: unknown; header?: unknown };
  if (typeof d.id === "string" && d.id.length > 0) return d.id;
  if (typeof d.accessorKey === "string" && d.accessorKey.length > 0) {
    return typeof String.prototype.replaceAll === "function"
      ? d.accessorKey.replaceAll(".", "_")
      : d.accessorKey.replace(/\./g, "_");
  }
  if (typeof d.header === "string" && d.header.length > 0) return d.header;
  return String(index);
}

/** 列定义里的 cell/header 通常是页面里新建的行内箭头函数：每次渲染身份都变。
 * flexRender 会把函数当作组件类型渲染，函数身份一变 React 就卸载并重建整个单元格子树——
 * 单元格里的输入框会在每次输入时被替换（价目管理的成本单价输入框因此每敲一个字符就丢焦点，
 * 没法连续输入）。这里按「用途 + 列 id」缓存稳定的包装组件，内部始终调用最新的列定义，
 * 从而让 React 只更新内容、不重建 DOM。
 * 缓存键与查找都用列 id，不用可见列下标：column.getIndex() 取的是可见列下标，
 * 隐藏列后其后所有列的下标整体前移，按下标取列定义会让这些列渲染到别的列的内容
 * （W4-A1 冒烟实测：隐藏「最近探测」后操作列整列渲染成探测列）。 */
function stableColumnRenderer(
  cache: Map<string, CellRenderer>,
  latestColumns: { current: unknown[] },
  kind: "header" | "cell",
  columnId: string,
): CellRenderer {
  const cacheKey = kind + ":" + columnId;
  const cached = cache.get(cacheKey);
  if (cached) return cached;
  const renderer: CellRenderer = (context) => {
    const index = latestColumns.current.findIndex(
      (def, i) => columnDefId(def, i) === columnId,
    );
    const column = index >= 0 ? (latestColumns.current[index] as Record<string, unknown> | undefined) : undefined;
    const render = column ? column[kind] : undefined;
    if (typeof render === "function") return (render as CellRenderer)(context);
    if (render !== undefined && render !== null) return render as ReactNode;
    // W6 ticket 10：列没有自定义 cell 时回退 TanStack 默认行为——渲染 accessor 取到的值，
    // 不再整列空白（配置版本「操作人」就是只有 accessorKey + header 的列）。
    if (kind === "cell") {
      const value = (context as { getValue?: () => unknown }).getValue?.();
      if (value == null || typeof value === "object") return null;
      return value as ReactNode;
    }
    return null;
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

/**
 * 列定义 meta 契约：align/sticky 与 ModelsTable/PriceTable 共用 lib/table-columns（头身同用），
 * 另带列设置菜单信息（DESIGN-AUDIT 四期 §2/§6）。
 */
export interface DataTableMeta extends TableColumnLayoutMeta {
  /** 列设置菜单的展示名（表头为函数/自定义节点时用它补充）。 */
  label?: string;
  /** false = 不进列设置菜单（勾选列等固定列）。 */
  hideable?: boolean;
}

interface DataTableProps<T> {
  columns: ColumnDef<T, unknown>[];
  data: T[] | undefined;
  loading?: boolean;
  /** 请求失败信息；非空时显示错误态（带重试），不再误报「暂无数据」 */
  error?: string | null;
  /** 错误态重试回调；配合 error 使用 */
  onRetry?: () => void;
  emptyText?: string;
  /** 空态补充说明；区分「无数据 / 无匹配」双空态文案时配合 emptyText 使用 */
  emptyDescription?: string;
  /** 空态主操作（CTA），如「新建上游」 */
  emptyAction?: ReactNode;
  filterPlaceholder?: string;
  /** 行点击回调（如上游列表整行进入编辑）；传入后行加 cursor-pointer */
  onRowClick?: (row: T) => void;
  /** 初始每页条数，档位来自后端（默认 50）；仅 client 模式生效 */
  pageSize?: (typeof PAGE_SIZE_OPTIONS)[number];
  /** 不传等价于 `{mode:"client"}`，保持既有页面行为不变 */
  paging?: DataTablePaging;
  /** 列显隐持久化（DESIGN-AUDIT §2）：localStorage key 存隐藏列 id 数组，如 slipstream.cols.audits */
  storageKey?: string;
  /** 列设置菜单的展示名：表头为函数/自定义节点时用它补充（键为列 id） */
  columnLabels?: Record<string, string>;
  /** W6 ticket 10（user story 41）：返回 true 的行在默认（未排序）视图置尾；显式列排序激活时
   * 尊重排序不强制置尾。仅 client 模式生效——server 模式只见到当前页，须由页面在全量数据上先分区。 */
  closedLast?: (row: T) => boolean;
  /** W6 ticket 10（user story 41/43）：行状态底色（neutral=关闭微灰 / warning=冷却微黄），
   * 冻结列经 --row-bg 同步着色。 */
  rowTone?: (row: T) => TableRowTone | undefined;
  /** W8 t03：固定列宽布局（table-fixed）。列定义用 meta.width 声明宽度，操作列按钮固定最小宽度，
   * 单元格内容/状态变化不再改变列宽；不传保持原 auto 布局（页面行为不变）。 */
  layout?: "auto" | "fixed";
}

/** 全站统一的表格封装：排序 / 全局筛选 / 分页 / 空态 / 加载骨架。 */
export function DataTable<T>({
  columns, data, loading = false, error, onRetry, emptyText = "暂无数据", emptyDescription, emptyAction,
  filterPlaceholder, onRowClick, pageSize = 50, paging, storageKey, columnLabels, closedLast, rowTone,
  layout = "auto",
}: DataTableProps<T>) {
  const fixedLayout = layout === "fixed";
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
  const renderHeader = (columnId: string) => stableColumnRenderer(renderersRef.current, latestColumnsRef, "header", columnId);
  const renderCell = (columnId: string) => stableColumnRenderer(renderersRef.current, latestColumnsRef, "cell", columnId);

  const serverPageIndex = serverPaging
    ? Math.floor(serverPaging.offset / Math.max(1, serverPaging.pageSize))
    : 0;

  // W6 ticket 10：默认（未排序）视图关闭行置尾（稳定分区，见 lib/table-order）；
  // 显式列排序激活时尊重排序不强制置尾（user story 42）。server 模式分区交给页面（只见当前页）。
  const orderedData = useMemo(() => {
    if (!closedLast || serverPaging || sorting.length > 0) return data;
    return partitionClosedLast(data ?? EMPTY_ROWS, closedLast);
  }, [closedLast, serverPaging, sorting, data]);

  const table = useReactTable({
    data: orderedData ?? EMPTY_ROWS,
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

  // 列设置菜单的可隐藏列：取全部叶子列（含已隐藏的，否则隐藏列会从菜单消失、勾不回来），
  // 排除操作列（id=actions）与 meta.hideable=false 的列；
  // 表头为函数时用 meta.label / columnLabels 补展示名，都没有则不进菜单。
  // 注意与 storageKey 解耦：可隐列是否存在只看列定义本身，菜单是否渲染、是否告警才看 storageKey。
  const hideableColumns = useMemo(() => {
    const result: Array<{ id: string; label: string }> = [];
    for (const column of table.getAllLeafColumns()) {
      if (column.id === "actions") continue;
      const meta = column.columnDef.meta as DataTableMeta | undefined;
      if (meta?.hideable === false) continue;
      const header = column.columnDef.header;
      const label =
        meta?.label ??
        columnLabels?.[column.id] ??
        (typeof header === "string" && header.length > 0 ? header : undefined);
      if (label) result.push({ id: column.id, label });
    }
    return result;
  }, [columnLabels, table]);

  // 列设置强制（DESIGN-AUDIT 四期 §10）：有可隐藏列却不给 storageKey，勾选状态会静默不持久化。
  // 不直接禁用，只在本实例首个命中时 console.warn 一次，提醒接入页补 key（A2 扫尾票清零）。
  const warnedNoStorageKey = useRef(false);
  useEffect(() => {
    if (storageKey === undefined && hideableColumns.length > 0 && !warnedNoStorageKey.current) {
      warnedNoStorageKey.current = true;
      console.warn(
        '[DataTable] 该表格存在可隐藏列但未传 storageKey：列设置不会持久化（刷新即丢）。请传 storageKey="slipstream.cols.<page>"。',
      );
    }
  }, [storageKey, hideableColumns]);

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
      {(filterPlaceholder !== undefined && serverPaging === undefined) ||
      (storageKey !== undefined && hideableColumns.length > 0) ? (
        <div className="flex flex-wrap items-center gap-2">
          {filterPlaceholder !== undefined && serverPaging === undefined ? (
            <Input
              value={globalFilter}
              onChange={(e) => setGlobalFilter(e.target.value)}
              placeholder={filterPlaceholder}
              className="max-w-64"
            />
          ) : null}
          {storageKey !== undefined && hideableColumns.length > 0 ? (
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
      {/* 表体内部滚动（DESIGN-AUDIT 四期 §3/§9）：滚动区高度自适应视口（起步公式 17rem），
          不设最小高度——数据少时表格随内容收缩，不整块留白；表头在该容器内吸顶。 */}
      <TableWrap className="table-responsive overflow-y-auto rounded-lg border border-border bg-surface">
        <Table fixed={fixedLayout}>
          <THead>
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id}>
                {hg.headers.map((header) => {
                  const canSort = header.column.getCanSort();
                  const dir = header.column.getIsSorted();
                  const meta = header.column.columnDef.meta as DataTableMeta | undefined;
                  return (
                    <TH
                      key={header.id}
                      onClick={canSort ? header.column.getToggleSortingHandler() : undefined}
                      aria-sort={dir === "asc" ? "ascending" : dir === "desc" ? "descending" : undefined}
                      style={tableColumnWidthStyle(meta, layout)}
                      className={cn(
                        "sticky top-0 z-[var(--z-sticky)] bg-surface-2",
                        canSort && "cursor-pointer hover:text-body",
                        tableColumnHeaderClass(meta),
                      )}
                    >
                      <span className="inline-flex items-center gap-1">
                        {flexRender(renderHeader(header.column.id), header.getContext())}
                        {canSort && <SortIndicator direction={dir} />}
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
                      className={tableColumnCellClass(col.columnDef.meta as DataTableMeta | undefined)}
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
                        <ACTION_ICONS.refresh className="h-3.5 w-3.5" /> 重试
                      </Button>
                    )}
                  </div>
                </td>
              </tr>
            ) : table.getRowModel().rows.length === 0 ? (
              <tr>
                <td colSpan={table.getVisibleLeafColumns().length}>
                  <Empty text={emptyText} description={emptyDescription} action={emptyAction} />
                </td>
              </tr>
            ) : (
              table.getRowModel().rows.map((row) => {
                const tone = rowTone?.(row.original);
                return (
                <TR
                  key={row.id}
                  className={cn(onRowClick ? "cursor-pointer" : undefined, rowToneClass(tone))}
                  style={rowToneTrStyle(tone)}
                  onClick={onRowClick ? () => onRowClick(row.original) : undefined}
                >
                  {row.getVisibleCells().map((cell) => {
                    const cellMeta = cell.column.columnDef.meta as DataTableMeta | undefined;
                    const content = flexRender(renderCell(cell.column.id), cell.getContext());
                    return (
                      <TD
                        key={cell.id}
                        className={tableColumnCellClass(cellMeta)}
                      >
                        {/* W6 ticket 10：操作列（sticky 尾列）内容统一 flex justify-end 贴右边缘。
                            W8 t03：固定布局下按钮再固定最小宽度，文案在「测试 / 测试中」间切换不改变列宽。 */}
                        {cellMeta?.sticky === "right" ? (
                          <div className={fixedLayout ? STABLE_ACTION_CELL_WRAPPER_CLASS : ACTION_CELL_WRAPPER_CLASS}>
                            {content}
                          </div>
                        ) : (
                          content
                        )}
                      </TD>
                    );
                  })}
                </TR>
                );
              })
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

