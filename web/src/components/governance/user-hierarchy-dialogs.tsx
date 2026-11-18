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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { UserTreeNode } from "@/types";

import { parseYuanToMicroAllowZero } from "./format";

/** Radix Select 不接受空字符串值：用哨兵表示“自动 / 树根”。 */
const AUTO_PARENT = "__auto_parent__";

export interface RoleOption {
  key: string;
  name: string;
}

export interface ParentOption {
  id: string;
  name: string;
  depth: number;
}

interface CreateUserDialogProps {
  open: boolean;
  pending: boolean;
  errorText: string | null;
  roles: RoleOption[];
  parents: ParentOption[];
  onClose: () => void;
  onSubmit: (values: {
    name: string;
    role: string;
    parentUserId: string | null;
    status: "active" | "disabled";
    balanceMicro: number;
  }) => void;
}

/** 新建用户：代理用户不选父级时自动挂到自己的节点下（后端决定）。 */
export function CreateHierarchyUserDialog({
  open,
  pending,
  errorText,
  roles,
  parents,
  onClose,
  onSubmit,
}: CreateUserDialogProps) {
  const [name, setName] = useState("");
  const [role, setRole] = useState("user");
  const [parent, setParent] = useState(AUTO_PARENT);
  const [status, setStatus] = useState<"active" | "disabled">("active");
  const [balance, setBalance] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!open) return;
    setName("");
    setRole("user");
    setParent(AUTO_PARENT);
    setStatus("active");
    setBalance("");
    setErrors({});
  }, [open]);

  const submit = () => {
    const next: Record<string, string> = {};
    if (name.trim().length === 0) next.name = "请输入用户名称";
    const balanceMicro = parseYuanToMicroAllowZero(balance);
    if (balanceMicro === null) next.balance = "请输入不小于 0 的金额";
    setErrors(next);
    if (Object.keys(next).length > 0 || balanceMicro === null) return;
    onSubmit({
      name: name.trim(),
      role,
      parentUserId: parent === AUTO_PARENT ? null : parent,
      status,
      balanceMicro,
    });
  };

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>新建用户</DialogTitle>
          <DialogDescription>
            用户按父子层级组织：代理用户创建的下级自动挂在自己名下，管理用户默认挂到根用户 D。
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {errorText !== null && (
            <Alert variant="destructive"><span>{errorText}</span></Alert>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="hier-user-name">名称</Label>
            <Input
              id="hier-user-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="例如 青岚云-华东代理"
              maxLength={255}
              disabled={pending}
              autoComplete="off"
            />
            {errors.name !== undefined && <p className="text-2xs text-danger-text">{errors.name}</p>}
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1.5">
              <Label>角色</Label>
              <Select value={role} onValueChange={setRole} disabled={pending}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {roles.map((item) => (
                    <SelectItem key={item.key} value={item.key}>{item.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>状态</Label>
              <Select
                value={status}
                onValueChange={(value) => setStatus(value as "active" | "disabled")}
                disabled={pending}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">启用</SelectItem>
                  <SelectItem value="disabled">停用</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>父级用户</Label>
            <Select value={parent} onValueChange={setParent} disabled={pending}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={AUTO_PARENT}>自动（代理用户=自己，管理用户=根用户 D）</SelectItem>
                {parents.map((item) => (
                  <SelectItem key={item.id} value={item.id}>
                    {"　".repeat(item.depth)}
                    {item.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="hier-user-balance">初始余额（元，可留空）</Label>
            <Input
              id="hier-user-balance"
              value={balance}
              onChange={(event) => setBalance(event.target.value)}
              placeholder="0.00"
              inputMode="decimal"
              disabled={pending}
              autoComplete="off"
            />
            {errors.balance !== undefined && (
              <p className="text-2xs text-danger-text">{errors.balance}</p>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={pending}>取消</Button>
          <Button variant="primary" onClick={submit} disabled={pending}>
            {pending ? "创建中…" : "创建用户"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface EditUserDialogProps {
  user: UserTreeNode | null;
  open: boolean;
  pending: boolean;
  errorText: string | null;
  roles: RoleOption[];
  parents: ParentOption[];
  onClose: () => void;
  onSubmit: (values: {
    name: string;
    role: string;
    parentUserId: string | null;
    status: "active" | "disabled";
  }) => void;
}

/** 编辑用户：改名 / 调角色 / 改父级（禁止挂到自己的子树下，后端校验）/ 停用。 */
export function EditUserDialog({
  user,
  open,
  pending,
  errorText,
  roles,
  parents,
  onClose,
  onSubmit,
}: EditUserDialogProps) {
  const [name, setName] = useState("");
  const [role, setRole] = useState("user");
  const [parent, setParent] = useState(AUTO_PARENT);
  const [status, setStatus] = useState<"active" | "disabled">("active");

  useEffect(() => {
    if (!open || user === null) return;
    setName(user.name);
    setRole(user.role || "user");
    setParent(user.parent_user_id ?? AUTO_PARENT);
    setStatus(user.status === "disabled" ? "disabled" : "active");
  }, [open, user]);

  const submit = () => {
    if (name.trim().length === 0) return;
    onSubmit({
      name: name.trim(),
      role,
      parentUserId: parent === AUTO_PARENT ? null : parent,
      status,
    });
  };

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>编辑用户 · {user?.name ?? ""}</DialogTitle>
          <DialogDescription>
            父级为“自动”表示挂到根用户 D；不能把用户挂到自己的子树下。
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {errorText !== null && (
            <Alert variant="destructive"><span>{errorText}</span></Alert>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="edit-user-name">名称</Label>
            <Input
              id="edit-user-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={255}
              disabled={pending}
              autoComplete="off"
            />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1.5">
              <Label>角色</Label>
              <Select value={role} onValueChange={setRole} disabled={pending}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {roles.map((item) => (
                    <SelectItem key={item.key} value={item.key}>{item.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>状态</Label>
              <Select
                value={status}
                onValueChange={(value) => setStatus(value as "active" | "disabled")}
                disabled={pending}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">启用</SelectItem>
                  <SelectItem value="disabled">停用</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>父级用户</Label>
            <Select value={parent} onValueChange={setParent} disabled={pending}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={AUTO_PARENT}>根用户 D</SelectItem>
                {parents
                  .filter((item) => item.id !== user?.id)
                  .map((item) => (
                    <SelectItem key={item.id} value={item.id}>
                      {"　".repeat(item.depth)}
                      {item.name}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={pending}>取消</Button>
          <Button variant="primary" onClick={submit} disabled={pending || name.trim().length === 0}>
            {pending ? "保存中…" : "保存"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
