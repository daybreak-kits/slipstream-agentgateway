import { useEffect, useState } from "react";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SELECT_NONE_VALUE } from "@/lib/select-sentinels";

export interface CreateUserValues {
  name: string;
  /** 留空 = 后端按用户名称派生（ADR-019：username 唯一且不可改，创建后无法再改） */
  username: string;
  role: string;
  parentUserId: string | null;
}

interface CreateUserDialogProps {
  open: boolean;
  pending: boolean;
  errorText: string | null;
  roles: Array<{ key: string; name: string }>;
  parents: Array<{ id: string; name: string; depth: number }>;
  onClose: () => void;
  onSubmit: (values: CreateUserValues) => void;
}

/** 创建用户（ADR-019）：不填密码，后端生成 12 位随机 initial_password 一次性返回。 */
export function CreateUserDialog({
  open,
  pending,
  errorText,
  roles,
  parents,
  onClose,
  onSubmit,
}: CreateUserDialogProps) {
  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  const [role, setRole] = useState("");
  const [parentId, setParentId] = useState<string>(SELECT_NONE_VALUE);
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName("");
    setUsername("");
    setRole("");
    setParentId(SELECT_NONE_VALUE);
    setTouched(false);
  }, [open]);

  // 角色列表异步到达（或当前选中项不在列表里）时兜底一次初值
  useEffect(() => {
    if (!open) return;
    if (role === "" || !roles.some((item) => item.key === role)) {
      setRole(roles[0]?.key ?? "customer");
    }
  }, [open, roles, role]);

  const nameInvalid = touched && name.trim().length === 0;
  const submit = () => {
    setTouched(true);
    if (name.trim().length === 0) return;
    onSubmit({
      name: name.trim(),
      username: username.trim(),
      role,
      parentUserId: parentId === SELECT_NONE_VALUE ? null : parentId,
    });
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
          <DialogTitle>新建用户</DialogTitle>
          <DialogDescription>
            创建成功后会生成 12 位随机初始密码，仅弹窗展示一次；登录帐户创建后不可修改。
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {errorText !== null && <Alert variant="destructive"><span>{errorText}</span></Alert>}

          <div className="space-y-1.5">
            <Label htmlFor="create-user-name">用户名称</Label>
            <Input
              id="create-user-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="例如 数据分析组"
              maxLength={255}
              disabled={pending}
              autoComplete="off"
            />
            {nameInvalid && <p className="text-2xs text-danger-text">请输入用户名称</p>}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="create-user-username">登录帐户（可选）</Label>
            <Input
              id="create-user-username"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              placeholder="留空则按用户名称自动生成"
              maxLength={128}
              disabled={pending}
              autoComplete="off"
            />
            <p className="text-2xs text-faint">登录帐户唯一且不可修改（ADR-019）。</p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="create-user-role">角色</Label>
            <Select value={role} onValueChange={setRole}>
              <SelectTrigger id="create-user-role" className="w-full">
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

          <div className="space-y-1.5">
            <Label htmlFor="create-user-parent">上级用户（可选）</Label>
            <Select value={parentId} onValueChange={setParentId}>
              <SelectTrigger id="create-user-parent" className="w-full">
                <SelectValue placeholder="自动挂靠" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={SELECT_NONE_VALUE}>自动挂靠（按当前账号层级）</SelectItem>
                {parents.map((item) => (
                  <SelectItem key={item.id} value={item.id}>
                    {"　".repeat(item.depth) + (item.depth > 0 ? "└ " : "") + item.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={pending}>
            取消
          </Button>
          <Button onClick={submit} disabled={pending || name.trim().length === 0}>
            {pending ? "创建中…" : "创建用户"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
