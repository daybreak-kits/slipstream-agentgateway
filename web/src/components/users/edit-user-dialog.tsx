import { useEffect, useState } from "react";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { DirtyField, DirtyFooter, DirtySaveButton } from "@/components/ui/dirty-field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ACTION_ICONS } from "@/lib/icons";
import { SELECT_NONE_VALUE } from "@/lib/select-sentinels";
import { useDirtyFields } from "@/lib/use-dirty-fields";
import type { UserTreeNode } from "@/types";

export interface EditUserValues {
  name: string;
  role: string;
  parentUserId: string | null;
  status: "active" | "disabled";
}

interface EditUserDialogProps {
  user: UserTreeNode | null;
  open: boolean;
  pending: boolean;
  errorText: string | null;
  roles: Array<{ key: string; name: string }>;
  parents: Array<{ id: string; name: string; depth: number }>;
  /** 层级根（通常是初始管理用户）：后端拒绝关闭，前端给提示 */
  rootIds: readonly string[];
  onClose: () => void;
  onSubmit: (values: EditUserValues) => void;
}

/** 编辑用户：显示名/角色/上级/状态；登录名不可改（ADR-019），只读展示。 */
export function EditUserDialog({
  user,
  open,
  pending,
  errorText,
  roles,
  parents,
  rootIds,
  onClose,
  onSubmit,
}: EditUserDialogProps) {
  const [name, setName] = useState("");
  const [role, setRole] = useState("");
  const [parentId, setParentId] = useState<string>(SELECT_NONE_VALUE);
  const [status, setStatus] = useState<"active" | "disabled">("active");

  const isOpen = open && user !== null;
  useEffect(() => {
    if (!isOpen || user === null) return;
    setName(user.name);
    setRole(user.role);
    setParentId(user.parent_user_id ?? SELECT_NONE_VALUE);
    setStatus(user.status === "disabled" ? "disabled" : "active");
  }, [isOpen, user]);

  // 角色列表异步到达（或当前角色已不在可选列表）时兜底
  useEffect(() => {
    if (!isOpen) return;
    if (role === "" || !roles.some((item) => item.key === role)) {
      setRole(roles[0]?.key ?? "user");
    }
  }, [isOpen, roles, role]);

  // baseline = 打开时的快照；role 与打开 effect 用同一兜底值，避免「角色已不在可选列表」
  // 被误判为脏（effect 会把 role 自动改成 roles[0]）。
  const baselineRole =
    user !== null && roles.some((item) => item.key === user.role)
      ? user.role
      : (roles[0]?.key ?? user?.role ?? "");
  const baseline =
    isOpen && user !== null
      ? {
          name: user.name,
          role: baselineRole,
          parentId: user.parent_user_id ?? SELECT_NONE_VALUE,
          status: user.status === "disabled" ? ("disabled" as const) : ("active" as const),
        }
      : null;
  const { dirtyCount, isDirty, isDirtyField } = useDirtyFields(baseline, { name, role, parentId, status });

  const resetField = (field: "name" | "role" | "parentId" | "status") => {
    if (!baseline) return;
    if (field === "name") setName(baseline.name);
    else if (field === "role") setRole(baseline.role);
    else if (field === "parentId") setParentId(baseline.parentId);
    else setStatus(baseline.status);
  };

  const resetAll = () => {
    if (!baseline) return;
    setName(baseline.name);
    setRole(baseline.role);
    setParentId(baseline.parentId);
    setStatus(baseline.status);
  };

  const isRoot = user !== null && rootIds.includes(user.id);

  const submit = () => {
    if (user === null) return;
    onSubmit({
      name: name.trim() || user.name,
      role,
      parentUserId: parentId === SELECT_NONE_VALUE ? null : parentId,
      status,
    });
  };

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>编辑用户</DialogTitle>
          <DialogDescription>
            {user?.name ?? ""}（{user?.username ?? ""}）——登录名不可修改，改动立即生效。
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {errorText !== null && <Alert variant="destructive"><span>{errorText}</span></Alert>}

          <DirtyField dirty={isDirtyField("name")} onReset={() => resetField("name")} resetLabel="恢复显示名">
            <div className="space-y-1.5">
              <Label htmlFor="edit-user-name">显示名</Label>
              <Input
                id="edit-user-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                maxLength={255}
                disabled={pending}
                autoComplete="off"
              />
            </div>
          </DirtyField>

          <DirtyField dirty={isDirtyField("role")} onReset={() => resetField("role")} resetLabel="恢复角色">
            <div className="space-y-1.5">
              <Label htmlFor="edit-user-role">角色</Label>
              <Select value={role} onValueChange={setRole}>
                <SelectTrigger id="edit-user-role" className="w-full">
                  <SelectValue placeholder="选择角色" />
                </SelectTrigger>
                <SelectContent>
                  {roles.map((item) => (
                    <SelectItem key={item.key} value={item.key}>
                      {item.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </DirtyField>

          <DirtyField
            dirty={isDirtyField("parentId")}
            onReset={() => resetField("parentId")}
            resetLabel="恢复上级用户"
          >
            <div className="space-y-1.5">
              <Label htmlFor="edit-user-parent">上级用户</Label>
              <Select value={parentId} onValueChange={setParentId}>
                <SelectTrigger id="edit-user-parent" className="w-full">
                  <SelectValue placeholder="选择上级" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={SELECT_NONE_VALUE}>挂到根层级</SelectItem>
                  {parents
                    .filter((item) => item.id !== user?.id)
                    .map((item) => (
                      <SelectItem key={item.id} value={item.id}>
                        {"　".repeat(item.depth) + (item.depth > 0 ? "└ " : "") + item.name}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
          </DirtyField>

          <DirtyField dirty={isDirtyField("status")} onReset={() => resetField("status")} resetLabel="恢复状态">
            <div className="space-y-1.5">
              <Label htmlFor="edit-user-status">状态</Label>
              <Select
                value={status}
                onValueChange={(next) => setStatus(next === "disabled" ? "disabled" : "active")}
              >
                <SelectTrigger id="edit-user-status" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">
                    <span className="inline-flex items-center gap-1.5">
                      <ACTION_ICONS.enable aria-hidden="true" className="h-3.5 w-3.5 text-success-text" />
                      启用
                    </span>
                  </SelectItem>
                  <SelectItem value="disabled" disabled={isRoot}>
                    <span className="inline-flex items-center gap-1.5">
                      <ACTION_ICONS.disable aria-hidden="true" className="h-3.5 w-3.5 text-warning-text" />
                      关闭
                    </span>
                  </SelectItem>
                </SelectContent>
              </Select>
              {isRoot && <p className="text-2xs text-faint">根用户不可关闭。</p>}
            </div>
          </DirtyField>
        </div>

        <DirtyFooter count={dirtyCount} onResetAll={resetAll} saving={pending}>
          <Button variant="outline" onClick={onClose} disabled={pending}>
            取消
          </Button>
          <DirtySaveButton dirty={isDirty} pending={pending} onClick={submit}>
            保存
          </DirtySaveButton>
        </DirtyFooter>
      </DialogContent>
    </Dialog>
  );
}
