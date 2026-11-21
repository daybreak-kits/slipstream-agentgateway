import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "@/lib/notify";

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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { api, apiList, ENDPOINTS } from "@/lib/api";
import { API_STYLE_LABELS, MODEL_TYPE_OPTIONS, type ProbeResultView } from "./shared";
import type { UpstreamImportResult, UpstreamModel } from "@/types";

/** 获取上游模型弹窗：POST discover-models（协议风格用页面当前选择），勾选后 import-models。
 *  后端按已保存的上游地址探测，弹窗只在已保存上游可用（新建先保存，见编辑器页头）。 */
export function DiscoverModelsDialog({
  upstreamId,
  apiStyle,
  onClose,
}: {
  upstreamId: string;
  /** 页面当前草稿的协议风格（含 auto），随探测请求下发 */
  apiStyle: string;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const discover = useQuery({
    queryKey: ["upstream-discover", upstreamId, apiStyle],
    queryFn: () => api.post<ProbeResultView>(ENDPOINTS.discoverModels(upstreamId), { api_style: apiStyle }),
    retry: false,
    staleTime: Number.POSITIVE_INFINITY,
  });
  const existingQ = useQuery({
    queryKey: ["upstream-models"],
    queryFn: () => apiList<UpstreamModel>(ENDPOINTS.upstreamModels),
  });

  const [modelType, setModelType] = useState("chat");
  const [filter, setFilter] = useState("");
  const [selected, setSelected] = useState<Set<string> | null>(null);

  const models = useMemo(() => discover.data?.models ?? [], [discover.data]);
  const existingNames = useMemo(() => {
    const list = existingQ.data?.items ?? [];
    return new Set(list.filter((model) => model.upstream_id === upstreamId).map((model) => model.name));
  }, [existingQ.data, upstreamId]);
  const visibleModels = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    if (needle === "") return models;
    return models.filter((name) => name.toLowerCase().includes(needle));
  }, [models, filter]);

  // 默认勾选尚未登记的模型；用户点过选择框后以用户选择为准。
  const chosen = selected ?? new Set(models.filter((name) => !existingNames.has(name)));
  const allVisibleChosen = visibleModels.length > 0 && visibleModels.every((name) => chosen.has(name));
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
      const parts = ["新增 " + result.created.length + " 个"];
      if (result.skipped.length > 0) parts.push("已存在跳过 " + result.skipped.length + " 个");
      if (result.errors.length > 0) parts.push("失败 " + result.errors.length + " 个");
      if (result.errors.length > 0) toast.warning("导入完成", { description: parts.join(" · ") });
      else toast.success("导入完成", { description: parts.join(" · ") });
      void qc.invalidateQueries({ queryKey: ["upstream-models"] });
      void qc.invalidateQueries({ queryKey: ["upstreams"] });
      void qc.invalidateQueries({ queryKey: ["upstream", upstreamId] });
      onClose();
    },
  });

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-xl" onSubmit={() => importModels.mutate()} submitDisabled={!ok || chosen.size === 0 || importModels.isPending}>
        <DialogHeader>
          <DialogTitle>获取上游模型</DialogTitle>
          <DialogDescription>
            调用上游的 models 接口列出候选模型，勾选后统一登记；导入不自动配置价格。探测按本页当前协议风格执行。
          </DialogDescription>
        </DialogHeader>

        {discover.isPending ? (
          <p className="py-6 text-center text-2sm text-faint">正在请求上游…</p>
        ) : discover.isError ? (
          <div className="space-y-2 py-4 text-2sm text-danger-text">
            <p>获取失败：{(discover.error as Error).message}</p>
            <Button variant="outline" size="sm" onClick={() => void discover.refetch()}>重试</Button>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-3 text-2xs text-body">
              <Badge tone={ok ? "success" : "danger"}>{ok ? "连接正常" : "连接失败"}</Badge>
              <span className="tnum">HTTP {discover.data?.http_status || "-"}</span>
              <span className="tnum">{discover.data?.latency_ms ?? 0} ms</span>
              {discover.data?.protocol ? (
                <span className="flex items-center gap-1">
                  已识别 <Badge tone="info">{API_STYLE_LABELS[discover.data.protocol] ?? discover.data.protocol}</Badge>
                </span>
              ) : null}
              <span className="tnum">发现 {models.length} 个模型</span>
            </div>
            {discover.data?.message && !ok ? (
              <p className="text-2sm text-danger-text">{discover.data.message}</p>
            ) : null}
            {ok && models.length > 0 ? (
              <>
                <div className="flex flex-wrap items-center gap-3">
                  <div className="flex items-center gap-2">
                    <Label>导入类型</Label>
                    <Select value={modelType} onValueChange={setModelType}>
                      <SelectTrigger className="h-8 w-52" aria-label="导入类型">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {MODEL_TYPE_OPTIONS.map((option) => (
                          <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <Input
                    value={filter}
                    onChange={(e) => setFilter(e.target.value)}
                    placeholder="按模型名过滤"
                    aria-label="按模型名过滤"
                    className="h-8 max-w-56"
                  />
                </div>
                <label className="flex items-center gap-2 text-2sm text-body">
                  <Checkbox
                    checked={allVisibleChosen ? true : visibleModels.some((name) => chosen.has(name)) ? "indeterminate" : false}
                    onCheckedChange={() =>
                      setSelected(allVisibleChosen
                        ? new Set(Array.from(chosen).filter((name) => !visibleModels.includes(name)))
                        : new Set(Array.from(chosen).concat(visibleModels.filter((name) => !chosen.has(name)))))
                    }
                    aria-label="全选可见模型"
                  />
                  全选（已选 <span className="tnum">{chosen.size}</span> / <span className="tnum">{models.length}</span>）
                </label>
                <div className="max-h-64 space-y-1 overflow-y-auto rounded-md border border-border p-2">
                  {visibleModels.map((name) => {
                    const added = existingNames.has(name);
                    return (
                      <label
                        key={name}
                        className="flex items-center gap-2 rounded px-1 py-1 text-2sm text-body transition-colors hover:bg-surface-2"
                      >
                        <Checkbox
                          checked={chosen.has(name)}
                          onCheckedChange={() => toggle(name)}
                          aria-label={"选择 " + name}
                        />
                        <span className="tnum min-w-0 flex-1 truncate font-mono text-2xs">{name}</span>
                        {added ? <Badge tone="neutral">已添加</Badge> : null}
                      </label>
                    );
                  })}
                  {visibleModels.length === 0 ? (
                    <p className="py-4 text-center text-2sm text-faint">没有匹配的模型名</p>
                  ) : null}
                </div>
              </>
            ) : (
              <p className="text-2sm text-faint">
                上游返回 2xx 但没有可识别的模型列表（支持 {"{data:[{id}]}"} 与 {"{models:[...]}"} 两种形态）。
              </p>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>关闭</Button>
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
