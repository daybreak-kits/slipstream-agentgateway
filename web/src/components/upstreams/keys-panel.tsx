import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
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
import { api, ENDPOINTS } from "@/lib/api";
import { formatDateTime, useTimezone } from "@/lib/time";
import type { UpstreamKey, UpstreamKeyList } from "@/types";

type FormMode = "add" | "rename" | "rotate";

interface FormState {
  mode: FormMode;
  key: UpstreamKey | null;
}

const FORM_TITLE: Record<FormMode, string> = {
  add: "添加密钥",
  rename: "重命名密钥",
  rotate: "轮换主密钥",
};

export function UpstreamKeysPanel({ upstreamId }: { upstreamId: string }) {
  const qc = useQueryClient();
  const { mode: timezone } = useTimezone();
  const q = useQuery({
    queryKey: ["upstream-keys", upstreamId],
    queryFn: () => api.get<UpstreamKeyList>(ENDPOINTS.upstreamKeys(upstreamId)),
  });
  const keys = q.data?.items ?? [];
  const limit = q.data?.limit ?? 20;

  const [form, setForm] = useState<FormState | null>(null);
  const [label, setLabel] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [setPrimary, setSetPrimary] = useState(false);
  const [deleting, setDeleting] = useState<UpstreamKey | null>(null);
  const [deleteError, setDeleteError] = useState("");

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["upstream-keys", upstreamId] });
    void qc.invalidateQueries({ queryKey: ["upstream", upstreamId] });
    void qc.invalidateQueries({ queryKey: ["upstreams"] });
  };

  const openForm = (next: FormState) => {
    setForm(next);
    setLabel(next.key?.label ?? "");
    setApiKey("");
    setSetPrimary(false);
  };

  const save = useMutation({
    mutationFn: () => {
      if (!form) throw new Error("表单未打开");
      if (form.mode === "add") {
        return api.post<UpstreamKey>(ENDPOINTS.upstreamKeys(upstreamId), {
          label: label.trim(),
          api_key: apiKey.trim(),
          set_primary: setPrimary,
        });
      }
      if (form.mode === "rename" && form.key) {
        return api.patch<UpstreamKey>(ENDPOINTS.upstreamKey(upstreamId, form.key.id), {
          label: label.trim(),
        });
      }
      return api.post<UpstreamKey>(ENDPOINTS.rotateUpstreamKey(upstreamId), {
        api_key: apiKey.trim(),
      });
    },
    onSuccess: () => {
      toast.success(
        form?.mode === "add"
          ? "密钥已添加"
          : form?.mode === "rename"
            ? "标签已更新"
            : "主密钥已轮换",
      );
      setForm(null);
      refresh();
    },
    onError: (e: Error) => toast.error("保存失败", { description: e.message }),
  });

  const promote = useMutation({
    mutationFn: (key: UpstreamKey) =>
      api.patch<UpstreamKey>(ENDPOINTS.upstreamKey(upstreamId, key.id), {
        is_primary: true,
      }),
    onSuccess: () => {
      toast.success("已设为主密钥", {
        description: "数据面下一个配置周期起使用这把密钥。",
      });
      refresh();
    },
    onError: (e: Error) => toast.error("设置失败", { description: e.message }),
  });

  const del = useMutation({
    mutationFn: (key: UpstreamKey) =>
      api.del<{ deleted: string }>(ENDPOINTS.upstreamKey(upstreamId, key.id)),
    onSuccess: () => {
      toast.success("密钥已删除");
      setDeleting(null);
      setDeleteError("");
      refresh();
    },
    onError: (e: Error) => setDeleteError(e.message),
  });

  const canSave =
    form !== null &&
    (form.mode === "rename"
      ? label.trim() !== ""
      : apiKey.trim() !== "");

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="text-2xs text-faint">
          共 <span className="tnum">{keys.length}</span> / {limit} 把密钥；数据面只取用主密钥，
          备用密钥先「设为主密钥」再轮换。明文只在提交时传输，控制台永不回显。
        </p>
        <Button
          size="sm"
          disabled={keys.length >= limit}
          onClick={() => openForm({ mode: "add", key: null })}
        >
          <Plus className="h-3.5 w-3.5" /> 添加密钥
        </Button>
      </div>

      <TableWrap className="rounded-lg border border-border bg-surface">
        <Table>
          <THead>
            <tr>
              <TH>标签</TH>
              <TH>密钥</TH>
              <TH>状态</TH>
              <TH>创建时间</TH>
              <TH>操作</TH>
            </tr>
          </THead>
          <tbody>
            {q.isPending ? (
              <TR>
                <TD colSpan={5}>
                  <Skeleton className="h-4 w-full max-w-60" />
                </TD>
              </TR>
            ) : q.isError ? (
              <TR>
                <TD colSpan={5}>
                  <div className="flex items-center gap-2 py-4 text-2sm text-danger-text">
                    加载失败：{(q.error as Error).message}
                    <Button variant="outline" size="sm" onClick={() => void q.refetch()}>
                      重试
                    </Button>
                  </div>
                </TD>
              </TR>
            ) : keys.length === 0 ? (
              <TR>
                <TD colSpan={5} className="text-2sm text-faint">
                  该上游没有密钥记录（历史数据可能只有内联密文，添加密钥后自动迁移）。
                </TD>
              </TR>
            ) : (
              keys.map((key) => (
                <TR key={key.id}>
                  <TD>
                    <span className="font-medium text-title">{key.label || "未命名"}</span>
                    {key.legacy ? <Badge tone="neutral">内联</Badge> : null}
                  </TD>
                  <TD>
                    <span className="tnum font-mono text-2xs">{key.masked}</span>
                  </TD>
                  <TD>
                    {key.is_primary ? (
                      <Badge tone="success">主密钥</Badge>
                    ) : (
                      <Badge tone="neutral">备用</Badge>
                    )}
                  </TD>
                  <TD>
                    <span className="tnum text-2xs text-body">
                      {formatDateTime(key.created_at_ms, timezone)}
                    </span>
                  </TD>
                  <TD>
                    <div className="flex flex-wrap gap-1">
                      {key.is_primary ? null : (
                        <Button
                          variant="outline"
                          size="dense"
                          disabled={promote.isPending}
                          onClick={() => promote.mutate(key)}
                        >
                          设为主密钥
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="dense"
                        onClick={() => openForm({ mode: "rename", key })}
                      >
                        重命名
                      </Button>
                      {key.is_primary ? (
                        <Button
                          variant="ghost"
                          size="dense"
                          onClick={() => openForm({ mode: "rotate", key })}
                        >
                          轮换
                        </Button>
                      ) : null}
                      <Button
                        variant="ghost"
                        size="dense"
                        className="text-danger-text"
                        onClick={() => {
                          setDeleting(key);
                          setDeleteError("");
                        }}
                      >
                        删除
                      </Button>
                    </div>
                  </TD>
                </TR>
              ))
            )}
          </tbody>
        </Table>
      </TableWrap>

      <Dialog
        open={form !== null}
        onOpenChange={(open) => {
          if (!open) setForm(null);
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{form ? FORM_TITLE[form.mode] : ""}</DialogTitle>
            <DialogDescription>
              {form?.mode === "rotate"
                ? "用新明文替换当前主密钥；行数不变，旧值立即失效。"
                : "密钥以密文落库，列表只显示尾 4 位。"}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            {form?.mode !== "rotate" ? (
              <div className="space-y-1">
                <Label htmlFor="key-label">标签</Label>
                <Input
                  id="key-label"
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  placeholder="如 主账号 / 备用账号"
                />
              </div>
            ) : null}
            {form?.mode !== "rename" ? (
              <div className="space-y-1">
                <Label htmlFor="key-secret">API Key</Label>
                <Input
                  id="key-secret"
                  type="password"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder="仅提交后保存为密文"
                />
              </div>
            ) : null}
            {form?.mode === "add" ? (
              <label className="flex items-center gap-2 text-2sm text-body">
                <Checkbox checked={setPrimary} onCheckedChange={(checked) => setSetPrimary(checked === true)} />
                添加后设为主密钥
              </label>
            ) : null}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setForm(null)}>
              取消
            </Button>
            <Button disabled={!canSave || save.isPending} onClick={() => save.mutate()}>
              {save.isPending ? "保存中…" : "保存"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open) {
            setDeleting(null);
            setDeleteError("");
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除密钥 {deleting?.label || deleting?.masked}？</AlertDialogTitle>
            <AlertDialogDescription>
              删除不可撤销；至少保留一把密钥。删除主密钥后最早添加的备用密钥自动接任。
            </AlertDialogDescription>
          </AlertDialogHeader>
          {deleteError ? (
            <p className="text-2sm text-danger-text">删除失败：{deleteError}</p>
          ) : null}
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (deleting) del.mutate(deleting);
              }}
            >
              确认删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
