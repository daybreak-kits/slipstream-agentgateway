import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import {
  ArrowDown,
  ArrowUp,
  FileText,
  ListFilter,
  RefreshCw,
  Search,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { toast } from "sonner";

import { DataTable } from "@/components/data-table";
import {
  cacheHitFraction,
  cacheRatioText,
  marginFraction,
  modelTypeLabel,
  statusLabel,
  statusTone,
} from "@/components/logs/format";
import { LogDetailDrawer } from "@/components/logs/log-detail-drawer";
import {
  buildLogQuery,
  createDefaultLogFilters,
  cycleLogSort,
  DEFAULT_LOG_SORT,
  filterDraftEqual,
  hasActiveLogFilters,
  logWindowBounds,
  type LogFilterDraft,
  type LogSort,
  type LogSortField,
  type LogStatusFilter,
} from "@/components/logs/query";
import { QuerySyntaxHelp } from "@/components/logs/query-syntax-help";
import type { LogListResponse, LogRow } from "@/components/logs/types";
import { TimeRangePicker } from "@/components/time-range-picker";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Combobox, type ComboboxOption } from "@/components/ui/combobox";
import { Empty } from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { api, apiList, ENDPOINTS } from "@/lib/api";
import { fmtInt, fmtMoney6, fmtPct, fmtSeconds } from "@/lib/format";
import { ACTION_ICONS } from "@/lib/icons";
import { usePermissions } from "@/lib/permissions";
import { SELECT_ALL_VALUE } from "@/lib/select-sentinels";
import { formatDateTime, useTimezone, type TimezoneMode } from "@/lib/time";
import { cn } from "@/lib/utils";
import type { PublicModel, Upstream, UpstreamModel, UserTreeNode } from "@/types";

interface AppliedLogFilters {
  draft: LogFilterDraft;
  query: string;
  hasError: boolean | undefined;
  from_ms?: number;
  to_ms?: number;
}

const STATUS_OPTIONS: Array<{ value: LogStatusFilter; label: string }> = [
  { value: SELECT_ALL_VALUE, label: "全部" },
  { value: "error", label: "全部错误" },
  { value: "ok", label: "全部成功" },
  { value: "2xx", label: "2XX 成功" },
  { value: "4xx", label: "4XX 客户端错误" },
  { value: "5xx", label: "5XX 服务端错误" },
];

/** DataTable 列设置菜单的展示名（表头是函数/自定义节点时需要显式给出）。 */
const LOG_COLUMN_LABELS: Record<string, string> = {
  datetime: "日期时间",
  model: "模型 · 路由",
  user: "用户",
  key: "密钥",
  tokens: "词元",
  money: "费用",
  duration: "耗时",
};
function makeApplied(draft: LogFilterDraft): AppliedLogFilters {
  const built = buildLogQuery(draft);
  const bounds = logWindowBounds(draft.window);
  return { draft: { ...draft }, query: built.query, hasError: built.hasError, from_ms: bounds.start, to_ms: bounds.end };
}

export function LogsPage() {
  const { mode } = useTimezone();
  const [draft, setDraft] = useState<LogFilterDraft>(createDefaultLogFilters);
  const [applied, setApplied] = useState<AppliedLogFilters>(() => makeApplied(createDefaultLogFilters()));
  const [sort, setSort] = useState<LogSort>(DEFAULT_LOG_SORT);
  const [queryError, setQueryError] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState<number>(50);
  const [selected, setSelected] = useState<LogRow | null>(null);

  // 筛选下拉的数据源与接口类型 join（upstream_model_id → model_type）。
  const publicModelsQ = useQuery({
    queryKey: ["public-models"],
    queryFn: () => apiList<PublicModel>(ENDPOINTS.publicModels),
  });
  const upstreamsQ = useQuery({
    queryKey: ["upstreams"],
    queryFn: () => apiList<Upstream>(ENDPOINTS.upstreams),
  });
  const usersQ = useQuery({
    queryKey: ["users"],
    queryFn: () => apiList<UserTreeNode>(ENDPOINTS.users),
  });
  const upstreamModelsQ = useQuery({
    queryKey: ["upstream-models"],
    queryFn: () => apiList<UpstreamModel>(ENDPOINTS.upstreamModels),
  });

  const logsQuery = useQuery({
    queryKey: [
      "logs",
      applied.query,
      applied.hasError === undefined ? "" : String(applied.hasError),
      applied.from_ms ?? 0,
      applied.to_ms ?? 0,
      sort.field,
      sort.order,
      page,
      pageSize,
    ],
    queryFn: ({ signal }) => {
      const params = new URLSearchParams({
        query: applied.query,
        page_size: String(pageSize),
        offset: String(page * pageSize),
        sort: sort.field,
        order: sort.order,
      });
      if (applied.from_ms !== undefined) params.set("from_ms", String(applied.from_ms));
      if (applied.to_ms !== undefined) params.set("to_ms", String(applied.to_ms));
      if (applied.hasError !== undefined) params.set("has_error", String(applied.hasError));
      return api.get<LogListResponse>("/admin/logs?" + params.toString(), { signal });
    },
    placeholderData: keepPreviousData,
  });

  const modelOptions = useMemo<ComboboxOption[]>(
    () => (publicModelsQ.data?.items ?? []).map((model) => ({ value: model.name, label: model.name })),
    [publicModelsQ.data],
  );
  const upstreamOptions = useMemo<ComboboxOption[]>(
    () =>
      (upstreamsQ.data?.items ?? []).map((upstream) => ({
        value: upstream.id,
        label: upstream.name,
        description: upstream.base_url,
      })),
    [upstreamsQ.data],
  );
  const userOptions = useMemo<ComboboxOption[]>(
    () =>
      (usersQ.data?.items ?? []).map((user) => ({
        value: user.id,
        label: user.name,
        description: user.id,
      })),
    [usersQ.data],
  );
  // 接口类型 join：按行的 upstream_model_id 精确匹配（列表接口 200 条上限，见报告）。
  const modelTypes = useMemo(() => {
    const map = new Map<string, string>();
    for (const model of upstreamModelsQ.data?.items ?? []) map.set(model.id, model.model_type);
    return map;
  }, [upstreamModelsQ.data]);

  const dirty = !filterDraftEqual(draft, applied.draft);

  useEffect(() => {
    if (!logsQuery.data) return;
    const maxPage = Math.max(0, Math.ceil(logsQuery.data.total / pageSize) - 1);
    if (page > maxPage) setPage(maxPage);
  }, [logsQuery.data, page, pageSize]);

  const updateDraft = (patch: Partial<LogFilterDraft>) => {
    setDraft((current) => ({ ...current, ...patch }));
    if (queryError) setQueryError(null);
  };

  const applyDraft = (next: LogFilterDraft) => {
    const built = buildLogQuery(next);
    if (built.error) {
      setQueryError(built.error);
      return;
    }
    const bounds = logWindowBounds(next.window);
    setQueryError(null);
    setApplied({ draft: { ...next }, query: built.query, hasError: built.hasError, from_ms: bounds.start, to_ms: bounds.end });
    setPage(0);
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    applyDraft(draft);
  };

  const reset = () => {
    const next = createDefaultLogFilters();
    setDraft(next);
    applyDraft(next);
  };

  const refresh = async () => {
    const result = await logsQuery.refetch();
    if (!result.isError) toast.success("日志已刷新");
  };

  const handleSort = useCallback((field: LogSortField) => {
    setSort((current) => cycleLogSort(current, field));
    setPage(0);
  }, []);

  const openDetail = useCallback((row: LogRow) => setSelected(row), []);
  const { can } = usePermissions();
  const canCost = can("billing:cost");
  const canSpend = can("billing:spend");

  const columns = useMemo(
    () =>
      buildLogColumns({
        mode,
        sort,
        onSort: handleSort,
        onOpen: openDetail,
        canCost,
        canSpend,
        modelTypes,
      }),
    [mode, sort, handleSort, openDetail, canCost, canSpend, modelTypes],
  );

  const total = logsQuery.data?.total ?? 0;
  const showEmpty = total === 0 && !logsQuery.isError && !logsQuery.isPending;
  const noMatch = showEmpty && hasActiveLogFilters(applied.draft);

  return (
    <div className="space-y-3">
      <form onSubmit={submit} className="space-y-2 rounded-lg border border-border bg-surface p-3">
        <div className="flex flex-wrap items-end gap-2">
          <TimeRangePicker
            value={draft.window}
            onChange={(window) => updateDraft({ window })}
            className="w-56"
          />
          <Combobox
            options={modelOptions}
            value={draft.model}
            onChange={(value) => updateDraft({ model: value })}
            placeholder="全部公开模型"
            searchPlaceholder="搜索公开模型名"
            ariaLabel="按公开模型筛选"
            highlighted={draft.model !== applied.draft.model}
            loading={publicModelsQ.isFetching}
            className="w-44"
          />
          <Combobox
            options={upstreamOptions}
            value={draft.upstream}
            onChange={(value) => updateDraft({ upstream: value })}
            placeholder="全部上游渠道"
            searchPlaceholder="搜索上游名称/标识"
            ariaLabel="按上游渠道筛选"
            highlighted={draft.upstream !== applied.draft.upstream}
            loading={upstreamsQ.isFetching}
            className="w-44"
          />
          <Combobox
            options={userOptions}
            value={draft.user}
            onChange={(value) => updateDraft({ user: value })}
            placeholder="全部用户"
            searchPlaceholder="搜索用户编号或名称"
            ariaLabel="按用户筛选"
            highlighted={draft.user !== applied.draft.user}
            loading={usersQ.isFetching}
            className="w-44"
          />
          <Select value={draft.status} onValueChange={(value) => updateDraft({ status: value as LogStatusFilter })}>
            <SelectTrigger className="h-9 w-44" aria-label="按状态筛选">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {STATUS_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Input
            value={draft.keyword}
            onChange={(event) => updateDraft({ keyword: event.target.value })}
            placeholder="关键词，或输入 user: / key: / status: / latency&gt; / cache&gt; / stream: 等语法；空格分隔多个条件"
            className="h-9 min-w-56 flex-1 font-mono text-2xs"
            aria-label="关键词或查询语法"
          />
          <QuerySyntaxHelp />
          <Button type="button" variant="ghost" onClick={reset}>
            <ACTION_ICONS.restore className="h-3.5 w-3.5" />
            重置
          </Button>
          <Button type="submit" variant="primary">
            <Search className="h-3.5 w-3.5" />
            查询
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => void refresh()}
            disabled={logsQuery.isFetching}
          >
            {logsQuery.isFetching ? <Spinner size="sm" /> : <RefreshCw className="h-3.5 w-3.5" />}
            刷新
          </Button>
        </div>

        {queryError || dirty ? (
          <p className={cn("text-xs", queryError ? "text-danger-text" : "text-faint")}>
            {queryError ?? "筛选已修改，点「查询」生效。"}
          </p>
        ) : null}
      </form>

      {logsQuery.isError && !logsQuery.data ? (
        <div className="rounded-lg border border-border bg-surface px-6 py-12 text-center">
          <p className="text-sm text-danger-text">日志加载失败</p>
          <p className="mt-1 text-xs text-faint">
            {logsQuery.error instanceof Error ? logsQuery.error.message : "请检查控制面 API 是否可达"}
          </p>
          <Button variant="outline" size="sm" className="mt-3" onClick={() => void logsQuery.refetch()}>
            <RefreshCw className="h-3.5 w-3.5" />
            重试
          </Button>
        </div>
      ) : noMatch ? (
        <div className="rounded-lg border border-border bg-surface px-6 py-12">
          <Empty
            icon={ListFilter}
            title="没有匹配的日志"
            description="换个时间范围，或清除筛选查看全部记录。"
            action={
              <Button variant="outline" size="sm" onClick={reset}>
                <ACTION_ICONS.clear className="h-3.5 w-3.5" />
                清除筛选
              </Button>
            }
          />
        </div>
      ) : showEmpty ? (
        <div className="rounded-lg border border-border bg-surface px-6 py-12">
          <Empty
            icon={FileText}
            title="暂无日志"
            description="数据面尚未产生用量记录；客户端发起请求后会出现在这里。"
          />
        </div>
      ) : (
        <DataTable
          columns={columns}
          data={logsQuery.data?.items}
          loading={logsQuery.isPending}
          emptyText="当前页没有记录"
          storageKey="slipstream.cols.logs"
          columnLabels={LOG_COLUMN_LABELS}
          paging={{
            mode: "server",
            offset: page * pageSize,
            pageSize,
            total: logsQuery.data?.total ?? 0,
            onOffsetChange: (offset) => setPage(Math.floor(offset / pageSize)),
            onPageSizeChange: (size) => {
              setPage(0);
              setPageSize(size);
            },
          }}
        />
      )}

      <LogDetailDrawer
        open={selected !== null}
        row={selected}
        timezone={mode}
        onOpenChange={(open) => {
          if (!open) setSelected(null);
        }}
      />
    </div>
  );
}

/** 表头排序按钮：升→降→取消（取消=回默认时间倒序），箭头指示当前方向。 */
function SortHeader({
  label,
  field,
  sort,
  onSort,
}: {
  label: string;
  field: LogSortField;
  sort: LogSort;
  onSort: (field: LogSortField) => void;
}) {
  const active = sort.field === field;
  const Arrow = active && sort.order === "asc" ? ArrowUp : ArrowDown;
  return (
    <Button
      variant="ghost"
      size="dense"
      className="-ml-1.5 gap-1 px-1.5 text-2xs text-faint hover:text-body"
      onClick={() => onSort(field)}
      aria-label={"按" + label + "排序"}
    >
      {label}
      {active ? <Arrow className="h-3 w-3" aria-hidden="true" /> : null}
    </Button>
  );
}

interface LogColumnSpec {
  mode: TimezoneMode;
  sort: LogSort;
  onSort: (field: LogSortField) => void;
  onOpen: (row: LogRow) => void;
  canCost: boolean;
  canSpend: boolean;
  modelTypes: Map<string, string>;
}

/** 两行式单元格（DESIGN-AUDIT §2）：主行 primary、次行 muted；数字列右对齐 tnum。 */
function buildLogColumns(spec: LogColumnSpec): ColumnDef<LogRow, unknown>[] {
  const { mode, sort, onSort, onOpen, canCost, canSpend, modelTypes } = spec;
  const columns: ColumnDef<LogRow, unknown>[] = [
    {
      id: "datetime",
      header: () => <SortHeader label="日期时间" field="started_at" sort={sort} onSort={onSort} />,
      enableSorting: false,
      cell: ({ row }) => (
        <div className="min-w-0 whitespace-nowrap">
          <p className="tnum text-xs text-body">{formatDateTime(row.original.started_at_ms, mode)}</p>
          <p className="mt-0.5">
            <Badge tone={statusTone(row.original.http_status)}>{statusLabel(row.original.http_status)}</Badge>
          </p>
        </div>
      ),
    },
    {
      id: "model",
      header: "模型 · 路由",
      enableSorting: false,
      cell: ({ row }) => {
        const item = row.original;
        const routeSecond = [
          item.is_stream ? "流式" : "非流",
          item.target_priority === null ? null : "P" + item.target_priority,
          modelTypeLabel(modelTypes.get(item.upstream_model_id)),
        ]
          .filter(Boolean)
          .join(" · ");
        return (
          <div className="min-w-0">
            <p
              className="truncate text-xs font-medium text-title"
              title={(item.public_model || "—") + " - " + (item.upstream_model || "—")}
            >
              {(item.public_model || "—") + " - " + (item.upstream_model || "—")}
            </p>
            <p className="mt-0.5 truncate text-2xs text-faint">{routeSecond || "—"}</p>
          </div>
        );
      },
    },
    {
      id: "user",
      header: "用户",
      enableSorting: false,
      cell: ({ row }) => (
        <div className="min-w-0">
          <p className="max-w-[120px] truncate text-xs text-body" title={row.original.user_name}>
            {row.original.user_name || "—"}
          </p>
          <p className="max-w-[120px] truncate font-mono text-2xs text-faint" title={row.original.user_id}>
            {row.original.user_id}
          </p>
        </div>
      ),
    },
    {
      id: "key",
      header: "密钥",
      enableSorting: false,
      cell: ({ row }) => (
        <span
          className="block max-w-[140px] truncate font-mono text-2xs text-body"
          title={row.original.api_key_label || row.original.api_key_id}
        >
          {row.original.api_key_label || "—"}
        </span>
      ),
    },
    {
      id: "tokens",
      header: () => <SortHeader label="词元" field="total_tokens" sort={sort} onSort={onSort} />,
      enableSorting: false,
      meta: { className: "text-right" },
      cell: ({ row }) => {
        const item = row.original;
        const cacheTotal = item.cache_read_tokens + item.cache_write_tokens;
        const cacheFraction = cacheHitFraction(item.input_tokens, item.cache_read_tokens, item.cache_write_tokens);
        return (
          <div className="whitespace-nowrap tnum">
            <p className="text-xs text-body">
              入{fmtInt(item.input_tokens)} / 出{fmtInt(item.output_tokens)}
            </p>
            <p className="mt-0.5 text-2xs text-faint">
              {cacheFraction === null ? "无缓存" : "缓 " + fmtInt(cacheTotal) + " · " + cacheRatioText(cacheFraction)}
            </p>
          </div>
        );
      },
    },
  ];

  if (canCost || canSpend) {
    columns.push({
      id: "money",
      header: canSpend ? () => <SortHeader label="费用" field="charge_micro" sort={sort} onSort={onSort} /> : "费用",
      enableSorting: false,
      meta: { className: "text-right" },
      cell: ({ row }) => {
        const item = row.original;
        const marginPct = marginFraction(item.margin_micro, item.charge_micro);
        return (
          <div className="whitespace-nowrap tnum">
            {canSpend ? (
              <p className="text-xs text-body" title="花费（向用户计费）">
                {fmtMoney6(item.charge_micro, item.currency)}
              </p>
            ) : null}
            {canCost ? (
              <p className="mt-0.5 text-2xs text-faint" title="成本（付上游进价）">
                本 {fmtMoney6(item.cost_micro, item.currency)}
              </p>
            ) : null}
            {canCost && canSpend ? (
              <p className="mt-0.5 text-2xs text-faint">利 {marginPct === null ? "—" : fmtPct(marginPct)}</p>
            ) : null}
          </div>
        );
      },
    });
  }

  columns.push(
    {
      id: "duration",
      header: () => <SortHeader label="耗时" field="duration_ms" sort={sort} onSort={onSort} />,
      enableSorting: false,
      meta: { className: "text-right" },
      cell: ({ row }) => (
        <div className="whitespace-nowrap tnum">
          <p className="text-xs text-body">{fmtSeconds(row.original.duration_ms)}</p>
          <p className="mt-0.5 text-2xs text-faint">首字 {fmtSeconds(row.original.time_to_first_token_ms)}</p>
        </div>
      ),
    },
    {
      id: "actions",
      header: "查看详情",
      enableSorting: false,
      cell: ({ row }) => (
        <Button
          variant="ghost"
          size="sm"
          aria-label={"查看 " + row.original.event_id + " 详情"}
          onClick={() => onOpen(row.original)}
        >
          <ACTION_ICONS.view className="h-3.5 w-3.5" />
          详情
        </Button>
      ),
    },
  );

  return columns;
}
