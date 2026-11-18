import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { Radar } from "lucide-react";
import { toast } from "sonner";

import { DataTable } from "@/components/data-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { api, apiList, ENDPOINTS } from "@/lib/api";
import { formatDateTime, useTimezone } from "@/lib/time";
import type {
  UpstreamImportResult,
  UpstreamModel,
  UpstreamProbeResult,
} from "@/types";

const MODEL_TYPES = ["chat", "embedding", "rerank", "image"] as const;

export function UpstreamModelsPanel({ upstreamId }: { upstreamId: string }) {
  const { mode: timezone } = useTimezone();
  const q = useQuery({
    queryKey: ["upstream-models"],
    queryFn: () => apiList<UpstreamModel>(ENDPOINTS.upstreamModels),
  });
  const [discovering, setDiscovering] = useState(false);
  // 稳定引用：TanStack Table 的行模型 memo 依赖 data 引用，每次渲染都 filter 出新数组
  // 会触发 _autoResetPageIndex → setState → 再渲染的同步死循环（筛选框一输入就卡死）。
  const rows = useMemo(
    () => (q.data?.items ?? []).filter((model) => model.upstream_id === upstreamId),
    [q.data, upstreamId],
  );

  const columns: ColumnDef<UpstreamModel, unknown>[] = [
    {
      accessorKey: "name",
      header: "模型名",
      cell: (c) => <span className="tnum font-medium text-title">{c.row.original.name}</span>,
    },
    {
      accessorKey: "model_type",
      header: "类型",
      cell: (c) => <Badge tone="info">{c.row.original.model_type}</Badge>,
    },
    {
      accessorKey: "enabled",
      header: "状态",
      cell: (c) =>
        c.row.original.enabled ? <Badge tone="success">启用</Badge> : <Badge tone="neutral">停用</Badge>,
    },
    {
      accessorKey: "created_at_ms",
      header: "登记时间",
      cell: (c) => (
        <span className="tnum text-2xs text-body">
          {formatDateTime(c.row.original.created_at_ms, timezone)}
        </span>
      ),
    },
  ];

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-2xs text-faint">
          本上游登记 <span className="tnum">{rows.length}</span> 个模型；「发现模型」会探测{" "}
          <span className="font-mono">{"<base_url>/models"}</span>{" "}
          并写一条探测记录，选中结果可批量导入。
        </p>
        <Button size="sm" onClick={() => setDiscovering(true)}>
          <Radar className="h-3.5 w-3.5" /> 发现模型
        </Button>
      </div>
      <DataTable
        columns={columns}
        data={rows}
        loading={q.isPending}
        error={q.isError ? (q.error as Error).message : null}
        onRetry={() => void q.refetch()}
        emptyText="还没有登记模型，试试「发现模型」"
        filterPlaceholder="筛选模型名 / 类型"
      />
      {discovering ? (
        <DiscoverModelsDialog
          upstreamId={upstreamId}
          onClose={() => setDiscovering(false)}
        />
      ) : null}
    </div>
  );
}

function DiscoverModelsDialog({
  upstreamId,
  onClose,
}: {
  upstreamId: string;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const discover = useQuery({
    queryKey: ["upstream-discover", upstreamId],
    queryFn: () => api.post<UpstreamProbeResult>(ENDPOINTS.discoverModels(upstreamId)),
    retry: false,
    staleTime: Number.POSITIVE_INFINITY,
  });
  const [selected, setSelected] = useState<Set<string> | null>(null);
  const [modelType, setModelType] = useState<string>("chat");

  const models = discover.data?.models ?? [];
  const chosen = selected ?? new Set(models);
  const allSelected = models.length > 0 && models.every((name) => chosen.has(name));
  const ok = discover.data?.status === "ok";

  const toggle = (name: string) => {
    const next = new Set(chosen);
    if (next.has(name)) next.delete(name);
    else next.add(name);
    setSelected(next);
  };

  const importModels = useMutation({
    mutationFn: () =>
      api.post<UpstreamImportResult>(ENDPOINTS.upstreamImportModels(upstreamId), {
        names: models.filter((name) => chosen.has(name)),
        model_type: modelType,
      }),
    onSuccess: (result) => {
      toast.success("导入完成", {
        description:
          "新增 " +
          result.created.length +
          " 个" +
          (result.skipped.length > 0
            ? "；已存在跳过 " + result.skipped.length + " 个"
            : "") +
          (result.errors.length > 0 ? "；失败 " + result.errors.length + " 个" : ""),
      });
      void qc.invalidateQueries({ queryKey: ["upstream-models"] });
      void qc.invalidateQueries({ queryKey: ["upstreams"] });
      void qc.invalidateQueries({ queryKey: ["upstream", upstreamId] });
      onClose();
    },
    onError: (e: Error) => toast.error("导入失败", { description: e.message }),
  });

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>发现模型</DialogTitle>
          <DialogDescription>
            调用上游的 models 接口；结果同时记入「健康」页的最近探测。导入只登记模型，价格在价目页维护。
          </DialogDescription>
        </DialogHeader>

        {discover.isPending ? (
          <p className="py-6 text-center text-2sm text-faint">正在请求上游…</p>
        ) : discover.isError ? (
          <div className="space-y-2 py-4 text-2sm text-danger-text">
            <p>发现失败：{(discover.error as Error).message}</p>
            <Button variant="outline" size="sm" onClick={() => void discover.refetch()}>
              重试
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-3 text-2xs text-body">
              <Badge tone={ok ? "success" : "danger"}>
                {ok ? "连接正常" : "连接失败"}
              </Badge>
              <span className="tnum">HTTP {discover.data?.http_status ?? "—"}</span>
              <span className="tnum">{discover.data?.latency_ms ?? 0} ms</span>
              <span className="tnum">发现 {models.length} 个模型</span>
            </div>
            {discover.data?.message ? (
              <p className="text-2sm text-danger-text">{discover.data.message}</p>
            ) : null}
            {ok && models.length > 0 ? (
              <>
                <label className="flex items-center gap-2 text-2sm text-body">
                  <Checkbox
                    checked={allSelected ? true : chosen.size > 0 ? "indeterminate" : false}
                    onCheckedChange={() =>
                      setSelected(allSelected ? new Set() : new Set(models))
                    }
                    aria-label="全选发现结果"
                  />
                  全选（已选 {chosen.size} / {models.length}）
                </label>
                <div className="max-h-64 space-y-1 overflow-y-auto rounded-md border border-border p-2">
                  {models.map((name) => (
                    <label
                      key={name}
                      className="flex items-center gap-2 rounded px-1 py-1 text-2sm text-body hover:bg-surface-2"
                    >
                      <Checkbox
                        checked={chosen.has(name)}
                        onCheckedChange={() => toggle(name)}
                        aria-label={"选择 " + name}
                      />
                      <span className="tnum font-mono text-2xs">{name}</span>
                    </label>
                  ))}
                </div>
                <div className="flex items-center gap-2">
                  <Label>导入类型</Label>
                  <Select value={modelType} onValueChange={setModelType}>
                    <SelectTrigger className="h-8 w-36">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {MODEL_TYPES.map((type) => (
                        <SelectItem key={type} value={type}>
                          {type}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </>
            ) : (
              <p className="text-2sm text-faint">
                上游返回 2xx 但没有可识别的模型列表（支持 {"{data:[{id}]}"} 与{" "}
                {"{models:[...]}"} 两种形态）。
              </p>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            关闭
          </Button>
          <Button
            disabled={!ok || chosen.size === 0 || importModels.isPending}
            onClick={() => importModels.mutate()}
          >
            {importModels.isPending ? "导入中…" : "导入所选 " + chosen.size + " 个"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
