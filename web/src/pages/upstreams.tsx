import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { Link } from "react-router-dom";
import { toast } from "sonner";

import { DataTable } from "@/components/data-table";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { api, apiList, ENDPOINTS } from "@/lib/api";
import type { Upstream, UpstreamBatchResult, UpstreamProbeResult, Vendor } from "@/types";

const STYLE_LABELS: Record<string, string> = {
  openai_chat: "OpenAI Chat",
  anthropic_messages: "Anthropic Messages",
  other: "其他",
};
const STYLES = ["openai_chat", "anthropic_messages", "other"];

type BatchAction = "enable" | "disable" | "delete";

const BATCH_LABEL: Record<BatchAction, string> = {
  enable: "批量启用",
  disable: "批量停用",
  delete: "批量删除",
};

function ProbeBadge({ upstream }: { upstream: Upstream }) {
  const probe = upstream.last_probe;
  if (!probe) return <Badge tone="neutral">未测试</Badge>;
  if (probe.status === "ok") {
    return <Badge tone="success">正常 {probe.latency_ms}ms</Badge>;
  }
  if (probe.status === "timeout") return <Badge tone="warning">超时</Badge>;
  return <Badge tone="danger">失败</Badge>;
}

function UpstreamDialog({ initial, vendors, onClose }: { initial: Upstream | null; vendors: Vendor[]; onClose: () => void }) {
  const qc = useQueryClient();
  const isEdit = initial !== null;
  const [vendorId, setVendorId] = useState(initial?.vendor_id ?? vendors[0]?.id ?? "");
  const [baseUrl, setBaseUrl] = useState(initial?.base_url ?? "");
  const [apiStyle, setApiStyle] = useState(initial?.api_style ?? "openai_chat");
  const [apiKey, setApiKey] = useState("");
  const [enabled, setEnabled] = useState(initial?.enabled ?? true);

  const save = useMutation({
    mutationFn: () =>
      isEdit && initial
        ? api.patch<Upstream>(ENDPOINTS.upstreamDetail(initial.id), { base_url: baseUrl.trim(), api_style: apiStyle, enabled })
        : api.post<Upstream>(ENDPOINTS.upstreamCreate, { vendor_id: vendorId, base_url: baseUrl.trim(), api_style: apiStyle, api_key: apiKey }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["upstreams"] });
      toast.success(isEdit ? "上游已更新" : "上游已创建", {
        description: isEdit ? undefined : "首把密钥已登记为「默认密钥」，可在详情页添加备用密钥。",
      });
      onClose();
    },
    onError: (e) => toast.error("保存失败", { description: (e as Error).message }),
  });

  const canSave = baseUrl.trim() !== "" && (isEdit ? true : vendorId !== "" && apiKey.trim() !== "");

  return (
    <Dialog open onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isEdit && initial ? "编辑上游 " + initial.name : "新建上游"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          {isEdit && initial ? (
            <div className="rounded-md border border-border bg-surface-2 px-3 py-2 text-2xs text-faint">
              名称与厂商不可修改：名称由厂商 slug 自动编号（{"{vendor_slug}-NN"}）；密钥在详情页「密钥」标签管理。
            </div>
          ) : (
            <div className="space-y-1">
              <Label>厂商</Label>
              <Select value={vendorId} onValueChange={setVendorId}>
                <SelectTrigger>
                  <SelectValue placeholder="选择厂商" />
                </SelectTrigger>
                <SelectContent>
                  {vendors.map((v) => (
                    <SelectItem key={v.id} value={v.id}>{v.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-2xs text-faint">名称自动编号为 {"{vendor_slug}-NN"}，无需填写。</p>
            </div>
          )}
          <div className="space-y-1">
            <Label>Base URL</Label>
            <Input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://..." />
          </div>
          <div className="space-y-1">
            <Label>接口风格</Label>
            <Select value={apiStyle} onValueChange={setApiStyle}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STYLES.map((s) => (
                  <SelectItem key={s} value={s}>{STYLE_LABELS[s] ?? s}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {isEdit ? (
            <div className="flex items-center gap-2">
              <Checkbox id="up-enabled" checked={enabled} onCheckedChange={(checked) => setEnabled(checked === true)} />
              <Label htmlFor="up-enabled">启用该上游</Label>
            </div>
          ) : (
            <div className="space-y-1">
              <Label>API Key</Label>
              <Input type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="仅提交后保存为密文，控制台不回显" />
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>取消</Button>
          <Button disabled={save.isPending || !canSave} onClick={() => save.mutate()}>
            {save.isPending ? "保存中…" : "保存"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function UpstreamsPage() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["upstreams"], queryFn: () => apiList<Upstream>(ENDPOINTS.upstreams) });
  const vendorsQ = useQuery({ queryKey: ["vendors"], queryFn: () => apiList<Vendor>(ENDPOINTS.vendors) });
  const [dialog, setDialog] = useState<{ open: boolean; initial: Upstream | null }>({ open: false, initial: null });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState<Upstream | null>(null);
  const [deleteError, setDeleteError] = useState("");
  const [batchConfirm, setBatchConfirm] = useState<BatchAction | null>(null);

  // 稳定引用：加载中 `?? []` 每次渲染都是新数组，见 DataTable 注释。
  const rows = useMemo(() => q.data?.items ?? [], [q.data]);
  const allSelected = rows.length > 0 && rows.every((row) => selected.has(row.id));
  const someSelected = selected.size > 0 && !allSelected;
  const vendorName = (id: string) => vendorsQ.data?.items.find((v) => v.id === id)?.name ?? id;

  const toggleRow = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    if (allSelected) setSelected(new Set());
    else setSelected(new Set(rows.map((row) => row.id)));
  };

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["upstreams"] });
    void qc.invalidateQueries({ queryKey: ["upstream-keys"] });
    void qc.invalidateQueries({ queryKey: ["upstream-models"] });
  };

  const toggle = useMutation({
    mutationFn: (upstream: Upstream) =>
      api.patch<Upstream>(ENDPOINTS.upstreamDetail(upstream.id), { enabled: !upstream.enabled }),
    onSuccess: (upstream) => {
      toast.success(upstream.enabled ? "上游已启用" : "上游已停用");
      refresh();
    },
    onError: (e: Error) => toast.error("操作失败", { description: e.message }),
  });

  const test = useMutation({
    mutationFn: (upstream: Upstream) =>
      api.post<UpstreamProbeResult>(ENDPOINTS.upstreamTest(upstream.id)),
    onSuccess: (result) => {
      if (result.status === "ok") {
        toast.success("连通性测试通过", {
          description: result.model_count + " 个模型 · " + result.latency_ms + " ms",
        });
      } else {
        toast.error("连通性测试未通过", { description: result.message });
      }
      refresh();
    },
    onError: (e: Error) => toast.error("连通性测试失败", { description: e.message }),
  });

  const del = useMutation({
    mutationFn: (upstream: Upstream) =>
      api.del<{ deleted: string }>(ENDPOINTS.upstreamDetail(upstream.id)),
    onSuccess: () => {
      toast.success("上游已删除");
      setDeleting(null);
      setDeleteError("");
      refresh();
    },
    onError: (e: Error) => setDeleteError(e.message),
  });

  const batch = useMutation({
    mutationFn: (vars: { ids: string[]; action: BatchAction }) =>
      api.patch<UpstreamBatchResult>(ENDPOINTS.upstreamBatch, { ids: vars.ids, action: vars.action }),
    onSuccess: (result, vars) => {
      const nameOf = (id: string) => rows.find((row) => row.id === id)?.name ?? id;
      const parts = ["成功 " + result.changed.length + " 个"];
      if (result.missing.length > 0) parts.push(result.missing.length + " 个不存在");
      if (result.failed.length > 0) {
        parts.push(
          result.failed.length +
            " 个被拒绝：" +
            result.failed.map((item) => nameOf(item.id) + "（" + item.message + "）").join("；"),
        );
      }
      const description = parts.join("；");
      if (result.failed.length > 0) toast.warning(BATCH_LABEL[vars.action] + "部分完成", { description });
      else toast.success(BATCH_LABEL[vars.action] + "完成", { description });
      setSelected(new Set());
      setBatchConfirm(null);
      refresh();
    },
    onError: (e: Error) => toast.error("批量操作失败", { description: e.message }),
  });

  const columns: ColumnDef<Upstream, unknown>[] = [
    {
      id: "select",
      header: () => (
        <Checkbox
          checked={allSelected ? true : someSelected ? "indeterminate" : false}
          onCheckedChange={() => toggleAll()}
          aria-label="全选当前列表"
        />
      ),
      cell: (cell) => (
        <Checkbox
          checked={selected.has(cell.row.original.id)}
          onCheckedChange={() => toggleRow(cell.row.original.id)}
          aria-label={"选择 " + cell.row.original.name}
        />
      ),
    },
    {
      accessorKey: "name",
      header: "名称",
      cell: (c) => (
        <Link to={"/upstreams/" + c.row.original.id} className="font-medium text-primary-text hover:underline">
          {c.row.original.name}
        </Link>
      ),
    },
    { id: "vendor", accessorFn: (r) => vendorName(r.vendor_id), header: "厂商", cell: (c) => <span>{String(c.getValue())}</span> },
    { accessorKey: "base_url", header: "Base URL", cell: (c) => <span className="font-mono text-2xs text-body">{c.row.original.base_url}</span> },
    {
      id: "keys",
      accessorFn: (r) => r.key_count ?? 0,
      header: "密钥",
      cell: (c) => <span className="tnum">{String(c.getValue())}</span>,
    },
    {
      id: "models",
      accessorFn: (r) => r.model_count ?? 0,
      header: "模型数",
      cell: (c) => <span className="tnum">{String(c.getValue())}</span>,
    },
    {
      id: "probe",
      header: "连通性",
      cell: (c) => <ProbeBadge upstream={c.row.original} />,
    },
    {
      accessorKey: "enabled",
      header: "状态",
      cell: (c) => (
        <Switch
          checked={c.row.original.enabled}
          disabled={toggle.isPending && toggle.variables?.id === c.row.original.id}
          onCheckedChange={() => toggle.mutate(c.row.original)}
          aria-label={(c.row.original.enabled ? "停用 " : "启用 ") + c.row.original.name}
        />
      ),
    },
    {
      id: "actions",
      header: "操作",
      cell: (c) => (
        <div className="flex gap-1">
          <Button variant="ghost" size="dense" onClick={() => setDialog({ open: true, initial: c.row.original })}>
            编辑
          </Button>
          <Button
            variant="ghost"
            size="dense"
            disabled={test.isPending && test.variables?.id === c.row.original.id}
            onClick={() => test.mutate(c.row.original)}
          >
            {test.isPending && test.variables?.id === c.row.original.id ? "测试中…" : "测试"}
          </Button>
          <Button
            variant="ghost"
            size="dense"
            className="text-danger-text"
            onClick={() => {
              setDeleteError("");
              setDeleting(c.row.original);
            }}
          >
            删除
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-2xs text-faint">
          名称由厂商 slug 自动编号；勾选行可批量启用 / 停用 / 删除。删除受引用保护：被对外模型引用的上游拒绝删除。
        </p>
        <Button size="sm" onClick={() => setDialog({ open: true, initial: null })}>新建上游</Button>
      </div>

      {selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-surface-2 px-3 py-2">
          <span className="text-2sm text-body">
            已选 <span className="tnum font-medium text-title">{selected.size}</span> / <span className="tnum">{rows.length}</span> 个上游
          </span>
          <Button variant="outline" size="sm" disabled={batch.isPending} onClick={() => batch.mutate({ ids: Array.from(selected), action: "enable" })}>
            批量启用
          </Button>
          <Button variant="outline" size="sm" disabled={batch.isPending} onClick={() => batch.mutate({ ids: Array.from(selected), action: "disable" })}>
            批量停用
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="text-danger-text"
            disabled={batch.isPending}
            onClick={() => setBatchConfirm("delete")}
          >
            批量删除
          </Button>
          <Button variant="ghost" size="sm" className="ml-auto" disabled={batch.isPending} onClick={() => setSelected(new Set())}>
            清除选择
          </Button>
        </div>
      )}

      <DataTable
        columns={columns}
        data={rows}
        loading={q.isPending}
        error={q.isError ? (q.error as Error).message : null}
        onRetry={() => void q.refetch()}
        emptyText="暂无上游"
        emptyAction={<Button size="sm" onClick={() => setDialog({ open: true, initial: null })}>新建上游</Button>}
        filterPlaceholder="筛选名称 / 厂商 / 地址"
      />
      {dialog.open ? (
        <UpstreamDialog
          initial={dialog.initial}
          vendors={vendorsQ.data?.items ?? []}
          onClose={() => setDialog({ open: false, initial: null })}
        />
      ) : null}

      <AlertDialog
        open={deleting !== null}
        onOpenChange={(v) => {
          if (!v) {
            setDeleting(null);
            setDeleteError("");
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除上游 {deleting?.name ?? ""}？</AlertDialogTitle>
            <AlertDialogDescription>
              连带删除密钥、模型和探测记录；被对外模型目标引用的上游会被拒绝删除。此操作不可撤销。
            </AlertDialogDescription>
          </AlertDialogHeader>
          {deleteError ? <p className="text-2sm text-danger-text">删除失败：{deleteError}</p> : null}
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              className="bg-danger text-white hover:bg-danger/90"
              onClick={() => { if (deleting) del.mutate(deleting); }}
            >
              确认删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={batchConfirm !== null} onOpenChange={(v) => { if (!v) setBatchConfirm(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{BATCH_LABEL[batchConfirm ?? "delete"]} {selected.size} 个上游？</AlertDialogTitle>
            <AlertDialogDescription>
              {batchConfirm === "delete"
                ? "批量删除逐项返回：被引用的上游会单独拒绝并保留，其余照常删除；删除不可撤销。"
                : "启用 / 停用立即写库，停用的上游不再参与渲染计划。"}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              className={batchConfirm === "delete" ? "bg-danger text-white hover:bg-danger/90" : undefined}
              onClick={() => { if (batchConfirm !== null) batch.mutate({ ids: Array.from(selected), action: batchConfirm }); }}
            >
              确认{batchConfirm === "delete" ? "删除" : "执行"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
