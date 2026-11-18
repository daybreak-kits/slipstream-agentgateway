import { useEffect, useState } from "react";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
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

import type { RoleDefinition } from "@/lib/roles";

import { roleHint, roleLabel } from "./roles";
import type { AdminAccount, AdminRole } from "./types";

export interface AdminFormValues {
  username?: string;
  password?: string;
  role: AdminRole;
}

interface AdminFormDialogProps {
  open: boolean;
  mode: "create" | "edit";
  admin: AdminAccount | null;
  roles: RoleDefinition[];
  pending: boolean;
  errorText: string | null;
  onClose: () => void;
  onSubmit: (values: AdminFormValues) => void;
}

export interface RoleCreateValues {
  name: string;
  description: string;
}

interface RoleCreateDialogProps {
  open: boolean;
  pending: boolean;
  errorText: string | null;
  onClose: () => void;
  onSubmit: (values: RoleCreateValues) => void;
}

/** 新建自定义角色：权限先留空，创建后在矩阵里逐条勾选。 */
export function RoleCreateDialog({
  open,
  pending,
  errorText,
  onClose,
  onSubmit,
}: RoleCreateDialogProps) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setName("");
    setDescription("");
    setError(null);
  }, [open]);

  const submit = () => {
    const trimmed = name.trim();
    if (trimmed.length < 2) {
      setError("角色名至少 2 个字符");
      return;
    }
    setError(null);
    onSubmit({ name: trimmed, description: description.trim() });
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>新建角色</DialogTitle>
          <DialogDescription>
            自定义角色的权限从零开始，创建后在矩阵中勾选；成员通过「管理员」页分配角色。
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          {errorText !== null && (
            <Alert variant="destructive">
              <span>{errorText}</span>
            </Alert>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="role-name">角色名</Label>
            <Input
              id="role-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="例如 审计员"
              maxLength={32}
              disabled={pending}
            />
            {error !== null && <p className="text-2xs text-danger-text">{error}</p>}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="role-description">说明（可选）</Label>
            <Input
              id="role-description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="这个角色负责什么"
              maxLength={200}
              disabled={pending}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={pending}>
            取消
          </Button>
          <Button variant="primary" onClick={submit} disabled={pending}>
            {pending ? "创建中…" : "创建角色"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** 新建 / 编辑管理员共用一个表单；编辑时登录名锁定、密码留空表示不改。 */
export function AdminFormDialog({
  open,
  mode,
  admin,
  roles,
  pending,
  errorText,
  onClose,
  onSubmit,
}: AdminFormDialogProps) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<AdminRole>("user");
  const [errors, setErrors] = useState<Record<string, string>>({});

  const adminId = admin?.id;
  const adminRole = admin?.role;

  useEffect(() => {
    if (!open) return;
    setUsername(admin?.username ?? "");
    setRole(adminRole ?? "user");
    setPassword("");
    setErrors({});
    // 只在打开或切换目标时重置：避免后台 refetch 把用户正在输入的内容冲掉
  }, [open, adminId, adminRole, admin?.username]);

  const isEdit = mode === "edit";

  const submit = () => {
    const next: Record<string, string> = {};
    if (!isEdit && username.trim().length === 0) next.username = "请输入登录名";
    if (!isEdit && password.length < 8) next.password = "初始密码至少 8 位";
    if (isEdit && password.length > 0 && password.length < 8) next.password = "新密码至少 8 位";
    setErrors(next);
    if (Object.keys(next).length > 0) return;
    onSubmit(
      isEdit
        ? { role, password: password.length > 0 ? password : undefined }
        : { username: username.trim(), password, role },
    );
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{isEdit ? "编辑管理员" : "新建管理员"}</DialogTitle>
          <DialogDescription>
            {isEdit
              ? "可调整角色或重置密码；登录名创建后不可修改，角色权限立即生效。"
              : "创建后即可用该账号访问控制面；角色决定权限，权限矩阵见页面下方。"}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {errorText !== null && (
            <Alert variant="destructive">
              <span>{errorText}</span>
            </Alert>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="admin-username">登录名</Label>
            <Input
              id="admin-username"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              disabled={isEdit || pending}
              placeholder="例如 alice"
              maxLength={128}
              autoComplete="off"
            />
            {errors.username !== undefined && <p className="text-2xs text-danger-text">{errors.username}</p>}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="admin-password">{isEdit ? "新密码（留空则不修改）" : "初始密码"}</Label>
            <Input
              id="admin-password"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              disabled={pending}
              placeholder="至少 8 位"
              autoComplete="new-password"
            />
            {errors.password !== undefined && <p className="text-2xs text-danger-text">{errors.password}</p>}
          </div>

          <div className="space-y-1.5">
            <Label>角色</Label>
            <Select value={role} onValueChange={(value) => setRole(value as AdminRole)} disabled={pending}>
              <SelectTrigger>
                <SelectValue placeholder="选择角色" />
              </SelectTrigger>
              <SelectContent>
                {roles.map((item) => (
                  <SelectItem key={item.key} value={item.key}>
                    {item.name || roleLabel(item.key)}
                    <span className="ml-2 text-2xs text-faint">{roleHint(item.key)}</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-2xs text-faint">
              角色来自 admin_roles：内置三角色 + 管理用户自建角色；细粒度权限在页面下方矩阵勾选。
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={pending}>
            取消
          </Button>
          <Button variant="primary" onClick={submit} disabled={pending}>
            {pending ? "提交中…" : isEdit ? "保存修改" : "创建"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
