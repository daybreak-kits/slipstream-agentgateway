import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import {
  FileText,
  ListFilter,
  RefreshCw,
  Search,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { toast } from "@/lib/notify";

import { DataTable } from "@/components/data-table";
import { mockLatency } from "@/components/dashboard/report-mocks";
import {
  REPORT_PATHS,
  type AllSamplesLatency,
  type LatencyReport,
} from "@/components/dashboard/report-types";
import {
  cacheHitFraction,
  cacheRatioText,
  marginFraction,
  statusLabel,
  statusTone,
} from "@/components/logs/format";
import {
  LATENCY_TONE_BAR_CLASS, LATENCY_TONE_TEXT_CLASS, latencyTone,
} from "@/components/logs/latency-tone";
import { LogDetailDrawer } from "@/components/logs/log-detail-drawer";
import { rowErrorText } from "@/components/logs/error-summary";
import { SortIndicator } from "@/components/ui/sort-indicator";
import {
  NoChainRecord,
  RequestAttemptChainPopover,
} from "@/components/logs/request-attempt-chain";
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
import { TimeRangePicker, timeWindowUsable } from "@/components/time-range-picker";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Combobox, type ComboboxOption } from "@/components/ui/combobox";
import { Empty } from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { api, apiList, ENDPOINTS } from "@/lib/api";
import { fmtInt, fmtMoney, fmtPct, fmtSeconds } from "@/lib/format";
import { ACTION_ICONS } from "@/lib/icons";
import { useMock } from "@/lib/mock";
import { usePermissions } from "@/lib/permissions";
import { SELECT_ALL_VALUE } from "@/lib/select-sentinels";
import { formatDateTime, useTimezone, type TimezoneMode } from "@/lib/time";
import { cn } from "@/lib/utils";
import type { PublicModel, Upstream, UserTreeNode } from "@/types";
import { PageHeader } from "@/components/layout/page-header";

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
  model: "模型",
  attempts: "尝试",
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

  // 耗时语义色的分位锚（W4-F）：与 /admin/logs 同窗口并发拉取。窗口缺省时不传
  // from/to（后端缺省=全时段）；取 all 块——全样本、不过滤 ttft>0 配对，非流式
  // 行的真实耗时也参与锚定（DESIGN-AUDIT §11）。
  // W6 票 16：超界自定义窗不发请求（与看板同一扇门）；失败不再静默——下方有可见错误态，
  // 通知中心条目由 lib/api 的票 07 查询失败语义统一去重落条。
  const latencyQuery = useQuery({
    queryKey: ["logs", "latency", applied.from_ms ?? 0, applied.to_ms ?? 0],
    enabled: timeWindowUsable(applied.draft.window),
    placeholderData: keepPreviousData,
    queryFn: ({ signal }): Promise<LatencyReport> => {
      if (useMock) {
        const fromMs = applied.from_ms ?? 0;
        return Promise.resolve(mockLatency({ kind: "custom", fromMs, toMs: applied.to_ms ?? Date.now() }));
      }
      const params = new URLSearchParams();
      if (applied.from_ms !== undefined && applied.to_ms !== undefined) {
        params.set("from_ms", String(applied.from_ms));
        params.set("to_ms", String(applied.to_ms));
      }
      const query = params.toString();
      return api.get<LatencyReport>(REPORT_PATHS.latency + (query ? "?" + query : ""), { signal });
    },
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
  const latencyAll = latencyQuery.data?.all;

  const columns = useMemo(
    () =>
      buildLogColumns({
        mode,
        sort,
        onSort: handleSort,
        onOpen: openDetail,
        canCost,
        canSpend,
        latencyAll,
      }),
    [mode, sort, handleSort, openDetail, canCost, canSpend, latencyAll],
  );

  const total = logsQuery.data?.total ?? 0;
  const showEmpty = total === 0 && !logsQuery.isError && !logsQuery.isPending;
  const noMatch = showEmpty && hasActiveLogFilters(applied.draft);

  return (
    <div className="space-y-4">
      <PageHeader
        title="使用日志"
        description="按时间窗筛选请求；首字与耗时按当前窗口分位上色（≤P50 绿 / ≤P95 黄 / >P95 红 / 缺失灰）。"
      />
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
          <p className={cn("text-2sm", queryError ? "text-danger-text" : "text-faint")}>
            {queryError ?? "筛选已修改，点「查询」生效。"}
          </p>
        ) : null}
      </form>

      {latencyQuery.isError && (
        <div className="flex flex-wrap items-center gap-2 text-2xs text-danger-text">
          <span className="min-w-0 truncate">
            延迟分位加载失败：
            {latencyQuery.error instanceof Error ? latencyQuery.error.message : "请稍后重试"}
          </span>
          <Button variant="outline" size="dense" onClick={() => void latencyQuery.refetch()}>
            重试
          </Button>
        </div>
      )}

      {logsQuery.isError && !logsQuery.data ? (
        <div className="rounded-lg border border-border bg-surface px-6 py-12 text-center">
          <p className="text-sm text-danger-text">日志加载失败</p>
          <p className="mt-1 text-2sm text-faint">
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
            description="当前时间窗内没有请求记录；调整时间范围或发起一次请求后再试。"
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

/** 表头排序按钮：升→降→取消（取消=回默认时间倒序）。
 * W6 ticket 11：三态指示复用共享 SortIndicator——未排序 ArrowUpDown 常驻（否则看不出列可排序）、
 * 升序 ArrowUpNarrowWide、降序 ArrowDownNarrowWide；图标包 aria-hidden，
 * 按钮可访问名保持「按…排序」不被图标状态标签污染（w6 验收按 exact 匹配点按）。 */
export function SortHeader({
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
  return (
    <Button
      variant="ghost"
      size="dense"
      className="-ml-1.5 gap-1 px-1.5 text-2xs text-faint hover:text-body"
      onClick={() => onSort(field)}
      aria-label={"按" + label + "排序"}
    >
      {label}
      <span aria-hidden="true"><SortIndicator direction={active ? sort.order : false} /></span>
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
  /** 延迟报表 all 块（W4-F）：耗时列语义色的分位锚；加载中/旧后端缺位时中性灰。 */
  latencyAll?: AllSamplesLatency;
}

/**
 * 语义色条行（DESIGN-AUDIT §5）：竖色条 3px 圆角 + 标签 + 数值。
 * 色条颜色由 latencyTone 按当前窗口分位动态判定（首字用 all.ttft、耗时用 all.total）。
 */
function LatencyLine({
  label,
  value,
  p50,
  p95,
}: {
  label: string;
  value: number;
  p50: number | null | undefined;
  p95: number | null | undefined;
}) {
  const tone = latencyTone(value, p50, p95);
  return (
    <p className="flex items-center gap-1.5 text-2xs leading-4">
      <span
        aria-hidden="true"
        className={cn("h-3.5 w-[3px] shrink-0 rounded-full", LATENCY_TONE_BAR_CLASS[tone])}
      />
      <span className="text-faint">{label}</span>
      <span className={cn("tnum font-medium", LATENCY_TONE_TEXT_CLASS[tone])}>
        {fmtSeconds(value)}
      </span>
    </p>
  );
}

/** 两行式单元格（DESIGN-AUDIT §2）：主行 primary、次行 muted；数字列右对齐 tnum。 */
function buildLogColumns(spec: LogColumnSpec): ColumnDef<LogRow, unknown>[] {
  const { mode, sort, onSort, onOpen, canCost, canSpend, latencyAll } = spec;
  const columns: ColumnDef<LogRow, unknown>[] = [
    {
      id: "datetime",
      header: () => <SortHeader label="日期时间" field="started_at" sort={sort} onSort={onSort} />,
      enableSorting: false,
      cell: ({ row }) => {
        // ticket 04：失败行的错误摘要。服务层只回事实字段，摘要统一由 rowErrorText 拼装
        //（原始日志文本优先，缺失时用最近一次失败尝试兜底），整行扫读即可定位失败点。
        const errorText = rowErrorText(row.original);
        return (
          <div className="min-w-0 whitespace-nowrap">
            <p className="tnum text-2sm text-body">{formatDateTime(row.original.started_at_ms, mode)}</p>
            <p className="mt-0.5">
              <Badge tone={statusTone(row.original.http_status)}>{statusLabel(row.original.http_status)}</Badge>
            </p>
            {errorText ? (
              <p className="mt-0.5 max-w-[180px] truncate text-2xs text-danger-text" title={errorText}>
                {errorText}
              </p>
            ) : null}
          </div>
        );
      },
    },
    {
      id: "model",
      // 两行式（D4）：第一行=客户端请求的公开模型，第二行=实际响应的上游模型，中间轻分割。
      // 流式/优先级/接口类型不混进这两行（需要时在详情抽屉看）。
      header: "模型",
      enableSorting: false,
      cell: ({ row }) => {
        const item = row.original;
        return (
          <div className="min-w-0">
            <p
              className="truncate text-2sm font-medium text-title"
              title={item.requested_model || item.upstream_model || "-"}
            >
              {item.requested_model || item.upstream_model || "-"}
            </p>
            {item.requested_model ? (
              <p
                className="mt-0.5 truncate border-t border-border/60 pt-0.5 text-2xs text-faint"
                title={item.upstream_model || "-"}
              >
                {item.upstream_model || "-"}
              </p>
            ) : item.upstream_model ? (
              <p className="mt-0.5 border-t border-border/60 pt-0.5 text-2xs text-faint">
                请求模型未记录
              </p>
            ) : null}
          </div>
        );
      },
    },
    {
      // ticket 04：模型旁的尝试列。有尝试 →「N 次尝试」按钮开路由链 popover；
      // 历史行没有尝试记录 → 明确写「无链路记录」，不伪造链路。
      id: "attempts",
      header: "尝试",
      enableSorting: false,
      cell: ({ row }) => {
        const item = row.original;
        if (!item.has_attempts) return <NoChainRecord />;
        return (
          <RequestAttemptChainPopover
            eventId={item.event_id}
            attemptsCount={item.attempts_count ?? 0}
            totalDurationMs={item.duration_ms}
          />
        );
      },
    },
    {
      id: "user",
      header: "用户",
      enableSorting: false,
      cell: ({ row }) => (
        <div className="min-w-0">
          <p className="max-w-[120px] truncate text-2sm text-body" title={row.original.user_name}>
            {row.original.user_name || "-"}
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
          {row.original.api_key_label || "-"}
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
            <p className="text-2sm text-body">
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
          // W5-D2：费用列两行（金额 + 明细），金额表格 2 位小数；毛利百分比 1 位。
          <div className="whitespace-nowrap tnum">
            {canSpend ? (
              <p className="text-2sm text-body" title="花费（向用户计费）">
                {fmtMoney(item.charge_micro, item.currency)}
              </p>
            ) : null}
            {canCost ? (
              <p className="mt-0.5 text-2xs text-faint" title="成本（付上游进价）">
                本 {fmtMoney(item.cost_micro, item.currency)}
                {canSpend ? " · 利 " + (marginPct === null ? "-" : fmtPct(marginPct)) : null}
              </p>
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
      cell: ({ row }) => {
        const anchors = latencyAll;
        return (
          <div
            className="flex flex-col items-end gap-0.5 whitespace-nowrap tnum"
            title="色条按当前窗口分位动态着色：≤P50 绿、P50 至 P95 黄、>P95 红；灰色 = 样本不足或零值"
          >
            <LatencyLine
              label="首字"
              value={row.original.time_to_first_token_ms}
              p50={anchors?.ttft.p50_ms}
              p95={anchors?.ttft.p95_ms}
            />
            <LatencyLine
              label="耗时"
              value={row.original.duration_ms}
              p50={anchors?.total.p50_ms}
              p95={anchors?.total.p95_ms}
            />
          </div>
        );
      },
    },
    {
      id: "actions",
      header: "查看详情",
      enableSorting: false,
      meta: { sticky: "right" },
      cell: ({ row }) => (
        <Button
          variant="ghost"
          size="dense"
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
