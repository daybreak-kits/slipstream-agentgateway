import { useMemo, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

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
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableWrap, TD, TH, THead, TR } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { api, ENDPOINTS } from "@/lib/api";
import { ACTION_ICONS } from "@/lib/icons";
import { formatDateTime, useTimezone } from "@/lib/time";
import { parseKeyLines, type PendingKey } from "./shared";
import type { UpstreamKey, UpstreamKeyList } from "@/types";

/** 后端 l05_service/upstream_ops.MAX_UPSTREAM_KEYS；列表响应也会带 limit。 */
const KEY_LIMIT = 20;

function maskPreview(apiKey: string): string {
  const trimmed = apiKey.trim();
  return trimmed.length > 4 ? "…" + trimmed.slice(-4) : trimmed;
}

/** 批量粘贴弹窗（两态共用）：一行一把 → 粘贴内去重提示 → 确认后逐条提交。 */
function BatchPasteDialog({
  existingPlain,
  busy,
  onConfirm,
  onClose,
}: {
  /** 已有明文（草稿态可比较；已存态只有掩码，传空数组，重复交给后端 409 计数） */
  existingPlain: string[];
  busy: boolean;
  onConfirm: (entries: Array<{ label: string; apiKey: string }>, duplicates: number) => void;
  onClose: () => void;
}) {
  const [text, setText] = useState("");
  const parsed = useMemo(() => parseKeyLines(text, existingPlain), [text, existingPlain]);
  const ready = parsed.entries.length > 0;
  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>批量粘贴密钥</DialogTitle>
          <DialogDescription>一行一把密钥；以 # 开头的行视为注释跳过，本次粘贴内重复的行自动去重。</DialogDescription>
        </DialogHeader>
        <Textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={6}
          placeholder={"sk-...\nsk-...\n# 备注行会被跳过"}
          aria-label="批量粘贴密钥"
          className="font-mono text-2xs"
        />
        <p className="text-2xs text-faint">
          解析到 <span className="tnum">{parsed.entries.length}</span> 把
          {parsed.duplicates > 0 ? "；重复跳过 " + parsed.duplicates + " 把" : ""}
          。确认后逐条提交，结果以汇总提示为准。
        </p>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>取消</Button>
          <Button disabled={!ready || busy} onClick={() => onConfirm(parsed.entries, parsed.duplicates)}>
            逐条添加 {parsed.entries.length} 把
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** 单条添加弹窗（两态共用）：备注 + 密钥；密钥平权，无主备概念（ADR-026）。 */
function AddKeyDialog({
  busy,
  onConfirm,
  onClose,
}: {
  busy: boolean;
  onConfirm: (label: string, apiKey: string) => void;
  onClose: () => void;
}) {
  const [label, setLabel] = useState("");
  const [apiKey, setApiKey] = useState("");
  const ready = apiKey.trim() !== "";
  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>添加密钥</DialogTitle>
          <DialogDescription>密钥以密文落库，列表只显示尾 4 位；明文只在提交时传输，控制台不回显。</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="up-key-label">备注</Label>
            <Input id="up-key-label" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="如 主账号 / 备用账号" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="up-key-secret">API Key</Label>
            <Input
              id="up-key-secret"
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="仅提交后保存为密文"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>取消</Button>
          <Button disabled={!ready || busy} onClick={() => onConfirm(label.trim(), apiKey.trim())}>
            {busy ? "保存中…" : "保存"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface KeyRowModel {
  id: string;
  label: string;
  masked: string;
  createdText: string;
  /** 已存行才有：最近一次逐把测试；pending 草稿行恒为 null */
  lastTest: UpstreamKey["last_test"];
  lastTestAtMs: number;
  pending?: boolean;
}

/** 逐把测试结果（ADR-026 ③）：失效标红 danger、成功标绿、未测中性，含测试时间。 */
function KeyTestCell({ row }: { row: KeyRowModel }) {
  const { mode: timezone } = useTimezone();
  if (row.pending || row.lastTest === null || row.lastTest === undefined) {
    return <Badge tone="neutral">未测试</Badge>;
  }
  const testedAt = row.lastTestAtMs > 0 ? formatDateTime(row.lastTestAtMs, timezone) : "";
  if (row.lastTest.ok) {
    return (
      <span className="space-y-0.5">
        <Badge tone="success">HTTP {row.lastTest.status_code} · {row.lastTest.latency_ms} ms</Badge>
        {testedAt ? <p className="text-2xs text-faint tnum">{testedAt}</p> : null}
      </span>
    );
  }
  const reason = row.lastTest.error || (row.lastTest.status_code > 0 ? "HTTP " + row.lastTest.status_code : "连接失败");
  return (
    <span className="space-y-0.5">
      <Badge tone="danger">{reason}</Badge>
      {testedAt ? <p className="text-2xs text-danger-text tnum">{testedAt}</p> : null}
    </span>
  );
}

function KeysTable({
  rows,
  selected,
  onToggle,
  onToggleAll,
  selectable,
  actions,
}: {
  rows: KeyRowModel[];
  selected: Set<string>;
  onToggle: (id: string) => void;
  onToggleAll: (checked: boolean) => void;
  selectable: boolean;
  actions: (row: KeyRowModel) => ReactNode;
}) {
  const allSelected = selectable && rows.length > 0 && rows.every((row) => selected.has(row.id));
  return (
    <TableWrap>
      <Table>
        <THead>
          <tr>
            {selectable ? (
              <TH className="w-8">
                <Checkbox
                  checked={allSelected}
                  onCheckedChange={(checked) => onToggleAll(checked === true)}
                  aria-label="全选密钥"
                />
              </TH>
            ) : null}
            <TH>备注</TH>
            <TH>密钥</TH>
            <TH>测试结果</TH>
            <TH>创建时间</TH>
            <TH>操作</TH>
          </tr>
        </THead>
        <tbody>
          {rows.map((row) => (
            <TR key={row.id}>
              {selectable ? (
                <TD>
                  <Checkbox
                    checked={selected.has(row.id)}
                    onCheckedChange={() => onToggle(row.id)}
                    aria-label={"选择密钥 " + (row.label || row.masked)}
                  />
                </TD>
              ) : null}
              <TD>
                <span className="font-medium text-title">{row.label || "未命名"}</span>
                {row.pending ? <Badge tone="warning">待保存</Badge> : null}
              </TD>
              <TD>
                <span className="tnum font-mono text-2xs">{row.masked}</span>
              </TD>
              <TD><KeyTestCell row={row} /></TD>
              <TD>
                <span className="tnum text-2xs text-body">{row.createdText}</span>
              </TD>
              <TD>{actions(row)}</TD>
            </TR>
          ))}
        </tbody>
      </Table>
    </TableWrap>
  );
}

function PanelHeader({
  count,
  limit,
  hint,
  onAdd,
  onBatch,
  addDisabled,
  batchDelete,
}: {
  count: number;
  limit: number;
  hint: string;
  onAdd: () => void;
  onBatch: () => void;
  addDisabled: boolean;
  /** 已存面板才有：勾选后可批量删除 */
  batchDelete?: ReactNode;
}) {
  const AddIcon = ACTION_ICONS.add;
  return (
    <div className="flex flex-wrap items-start justify-between gap-2">
      <p className="text-2xs text-faint">{hint}</p>
      <div className="flex items-center gap-2">
        {batchDelete}
        <span className="text-2xs text-faint tnum">{count} / {limit} 把</span>
        <Button variant="outline" size="sm" disabled={addDisabled} onClick={onBatch}>批量粘贴</Button>
        <Button size="sm" disabled={addDisabled} onClick={onAdd}>
          <AddIcon className="h-3.5 w-3.5" /> 添加密钥
        </Button>
      </div>
    </div>
  );
}

/** 已保存上游的源密钥面板：密钥平权（ADR-026）——重命名/删除/逐把测试/勾选批量删除。 */
export function UpstreamKeysPanel({ upstreamId }: { upstreamId: string }) {
  const qc = useQueryClient();
  const { mode: timezone } = useTimezone();
  const q = useQuery({
    queryKey: ["upstream-keys", upstreamId],
    queryFn: () => api.get<UpstreamKeyList>(ENDPOINTS.upstreamKeys(upstreamId)),
  });
  const keys = q.data?.items ?? [];
  const limit = q.data?.limit ?? KEY_LIMIT;

  const [adding, setAdding] = useState(false);
  const [batching, setBatching] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [renaming, setRenaming] = useState<UpstreamKey | null>(null);
  const [renameLabel, setRenameLabel] = useState("");
  const [deleting, setDeleting] = useState<UpstreamKey | null>(null);
  const [batchDeleteConfirm, setBatchDeleteConfirm] = useState(false);

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["upstream-keys", upstreamId] });
    void qc.invalidateQueries({ queryKey: ["upstream", upstreamId] });
    void qc.invalidateQueries({ queryKey: ["upstreams"] });
  };

  const add = useMutation({
    mutationFn: (vars: { label: string; apiKey: string }) =>
      api.post<UpstreamKey>(ENDPOINTS.upstreamKeys(upstreamId), {
        label: vars.label,
        api_key: vars.apiKey,
      }),
    onSuccess: () => {
      toast.success("密钥已添加");
      setAdding(false);
      refresh();
    },
  });

  const batchNextNo = useMemo(() => {
    const maxNo = keys.reduce(
      (max, key) => Math.max(max, Number(/^批次 (\d+)$/.exec(key.label)?.[1] ?? 0)),
      0,
    );
    return maxNo + 1;
  }, [keys]);

  const batchAdd = useMutation({
    mutationFn: async (entries: Array<{ label: string; apiKey: string }>) => {
      let ok = 0;
      let duplicate = 0;
      let failed = 0;
      for (const entry of entries) {
        try {
          await api.post(ENDPOINTS.upstreamKeys(upstreamId), {
            label: "批次 " + batchNextNo,
            api_key: entry.apiKey,
          });
          ok += 1;
        } catch (error) {
          if ((error as { status?: number }).status === 409) duplicate += 1;
          else failed += 1;
        }
      }
      return { ok, duplicate, failed };
    },
    onSuccess: ({ ok, duplicate, failed }) => {
      const parts = ["新增 " + ok + " 把"];
      if (duplicate > 0) parts.push("重复跳过 " + duplicate + " 把");
      if (failed > 0) parts.push("失败 " + failed + " 把");
      if (failed > 0) toast.warning("批量添加完成", { description: parts.join(" · ") });
      else toast.success("批量添加完成", { description: parts.join(" · ") });
      setBatching(false);
      refresh();
    },
  });

  const rename = useMutation({
    mutationFn: () => {
      if (!renaming) throw new Error("未选中密钥行");
      return api.patch<UpstreamKey>(ENDPOINTS.upstreamKey(upstreamId, renaming.id), { label: renameLabel.trim() });
    },
    onSuccess: () => {
      toast.success("备注已更新");
      setRenaming(null);
      refresh();
    },
  });

  const del = useMutation({
    mutationFn: (key: UpstreamKey) => api.del<{ deleted: string }>(ENDPOINTS.upstreamKey(upstreamId, key.id)),
    onSuccess: () => {
      toast.success("密钥已删除");
      setDeleting(null);
      refresh();
    },
  });

  /** 逐把测试：一次触发本上游全部密钥行，结果落库并回填每行。 */
  const testKeys = useMutation({
    mutationFn: () => api.post<{ items: Array<{ key_id: string; ok: boolean }> }>(ENDPOINTS.upstreamKeysTest(upstreamId)),
    onSuccess: (result) => {
      const okCount = result.items.filter((item) => item.ok).length;
      const failCount = result.items.length - okCount;
      const description = "成功 " + okCount + " 把" + (failCount > 0 ? " · 失效 " + failCount + " 把（已标红）" : "");
      if (failCount > 0) toast.warning("逐把测试完成", { description });
      else toast.success("逐把测试完成", { description });
      refresh();
    },
  });

  const batchDelete = useMutation({
    mutationFn: () =>
      api.post<{ deleted: number; items: Array<{ key_id: string; ok: boolean; error?: string }> }>(
        ENDPOINTS.upstreamKeysBatchDelete(upstreamId),
        { ids: [...selected] },
      ),
    onSuccess: (result) => {
      const failedItems = result.items.filter((item) => !item.ok);
      const parts = ["删除 " + result.deleted + " 把"];
      if (failedItems.length > 0) {
        const firstError = failedItems[0]?.error ?? "失败";
        parts.push("未删 " + failedItems.length + " 把（" + firstError + "）");
        toast.warning("批量删除完成", { description: parts.join(" · ") });
      } else {
        toast.success("批量删除完成", { description: parts.join(" · ") });
      }
      setSelected(new Set());
      setBatchDeleteConfirm(false);
      refresh();
    },
  });

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const rows: KeyRowModel[] = keys.map((key) => ({
    id: key.id,
    label: key.label,
    masked: key.masked,
    createdText: formatDateTime(key.created_at_ms, timezone),
    lastTest: key.last_test,
    lastTestAtMs: key.last_test_at_ms,
    pending: false,
  }));

  const selectedCount = selected.size;
  const DeleteIcon = ACTION_ICONS.delete;
  const batchDeleteButton = selectedCount > 0 ? (
    <Button variant="danger" size="sm" onClick={() => setBatchDeleteConfirm(true)}>
      <DeleteIcon className="h-3.5 w-3.5" /> 删除选中 {selectedCount} 把
    </Button>
  ) : null;

  return (
    <div className="space-y-2">
      <PanelHeader
        count={keys.length}
        limit={limit}
        hint="每把密钥=一个独立 AG 上游，同层概率分流（P2C）；失效密钥标红。明文只在提交时传输，控制台不回显。"
        onAdd={() => setAdding(true)}
        onBatch={() => setBatching(true)}
        addDisabled={keys.length >= limit}
        batchDelete={batchDeleteButton}
      />
      {q.isPending ? (
        <Skeleton className="h-24 w-full" />
      ) : q.isError ? (
        <div className="flex items-center gap-2 text-2sm text-danger-text">
          密钥加载失败：{(q.error as Error).message}
          <Button variant="outline" size="sm" onClick={() => void q.refetch()}>重试</Button>
        </div>
      ) : rows.length === 0 ? (
        <p className="py-6 text-center text-2sm text-faint">还没有密钥；至少保留一把密钥后才能保存与调用。</p>
      ) : (
        <KeysTable
          rows={rows}
          selected={selected}
          onToggle={toggle}
          onToggleAll={(checked) => setSelected(checked ? new Set(rows.map((row) => row.id)) : new Set())}
          selectable
          actions={(row) => (
            <div className="flex flex-wrap gap-1">
              <Button
                variant="outline"
                size="dense"
                disabled={testKeys.isPending}
                title="对本上游全部密钥逐把发起最小鉴权请求"
                onClick={() => testKeys.mutate()}
              >
                {testKeys.isPending ? "测试中…" : "测试"}
              </Button>
              <Button
                variant="ghost"
                size="dense"
                onClick={() => {
                  setRenaming(keys.find((key) => key.id === row.id)!);
                  setRenameLabel(row.label);
                }}
              >
                重命名
              </Button>
              <Button variant="ghost" size="dense" className="text-danger-text" onClick={() => setDeleting(keys.find((key) => key.id === row.id)!)}>
                删除
              </Button>
            </div>
          )}
        />
      )}

      {adding ? (
        <AddKeyDialog
          busy={add.isPending}
          onConfirm={(label, apiKey) => add.mutate({ label, apiKey })}
          onClose={() => setAdding(false)}
        />
      ) : null}
      {batching ? (
        <BatchPasteDialog
          existingPlain={[]}
          busy={batchAdd.isPending}
          onConfirm={(entries) => batchAdd.mutate(entries)}
          onClose={() => setBatching(false)}
        />
      ) : null}

      <Dialog open={renaming !== null} onOpenChange={(open) => { if (!open) setRenaming(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>重命名密钥</DialogTitle>
          </DialogHeader>
          <div className="space-y-1">
            <Label htmlFor="up-key-rename">备注</Label>
            <Input id="up-key-rename" value={renameLabel} onChange={(e) => setRenameLabel(e.target.value)} />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setRenaming(null)}>取消</Button>
            <Button
              disabled={renameLabel.trim() === "" || rename.isPending}
              onClick={() => rename.mutate()}
            >
              保存
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={deleting !== null}
        onOpenChange={(open) => { if (!open) setDeleting(null); }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除密钥 {deleting?.label || deleting?.masked}？</AlertDialogTitle>
            <AlertDialogDescription>
              删除不可撤销；至少保留一把密钥（最后一把会被拒绝）。被删除密钥展开的 AG 上游将随下一次配置下发移除。
            </AlertDialogDescription>
          </AlertDialogHeader>
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

      <AlertDialog
        open={batchDeleteConfirm}
        onOpenChange={(open) => { if (!open) setBatchDeleteConfirm(false); }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>批量删除 {selectedCount} 把密钥？</AlertDialogTitle>
            <AlertDialogDescription>
              删除不可撤销，逐把返回结果；至少保留一把密钥（最后一把会被拒绝）。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              className="bg-danger text-white hover:bg-danger/90"
              onClick={() => batchDelete.mutate()}
            >
              确认删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/** 新建未保存时的密钥草稿：行只存内存，保存时第一把随创建提交，其余逐条补录。 */
export function PendingKeysPanel({
  keys,
  onChange,
}: {
  keys: PendingKey[];
  onChange: (keys: PendingKey[]) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [batching, setBatching] = useState(false);

  const addPending = (label: string, apiKey: string) => {
    onChange([
      ...keys,
      { localId: "pending_" + Date.now().toString(36) + "_" + keys.length, label, apiKey },
    ]);
  };

  return (
    <div className="space-y-2">
      <PanelHeader
        count={keys.length}
        limit={KEY_LIMIT}
        hint="每把密钥=一个独立 AG 上游，平权分流；先登记在本地草稿，保存时随创建提交。"
        onAdd={() => setAdding(true)}
        onBatch={() => setBatching(true)}
        addDisabled={keys.length >= KEY_LIMIT}
      />
      {keys.length === 0 ? (
        <p className="py-6 text-center text-2sm text-faint">
          至少添加一把密钥才能保存；测试连接与获取模型都会用到其中一把。
        </p>
      ) : (
        <KeysTable
          rows={keys.map((key) => ({
            id: key.localId,
            label: key.label,
            masked: maskPreview(key.apiKey),
            createdText: "保存后生成",
            lastTest: null,
            lastTestAtMs: 0,
            pending: true,
          }))}
          selected={new Set()}
          onToggle={() => undefined}
          onToggleAll={() => undefined}
          selectable={false}
          actions={(row) => (
            <div className="flex flex-wrap gap-1">
              <Button
                variant="ghost"
                size="dense"
                className="text-danger-text"
                onClick={() => onChange(keys.filter((key) => key.localId !== row.id))}
              >
                删除
              </Button>
            </div>
          )}
        />
      )}

      {adding ? (
        <AddKeyDialog
          busy={false}
          onConfirm={(label, apiKey) => {
            addPending(label, apiKey);
            setAdding(false);
          }}
          onClose={() => setAdding(false)}
        />
      ) : null}
      {batching ? (
        <BatchPasteDialog
          existingPlain={keys.map((key) => key.apiKey.trim())}
          busy={false}
          onConfirm={(entries) => {
            const base = keys.length;
            onChange([
              ...keys,
              ...entries.map((entry, index) => ({
                localId: "pending_" + Date.now().toString(36) + "_" + (base + index),
                label: entry.label,
                apiKey: entry.apiKey,
              })),
            ]);
            setBatching(false);
          }}
          onClose={() => setBatching(false)}
        />
      ) : null}
    </div>
  );
}
