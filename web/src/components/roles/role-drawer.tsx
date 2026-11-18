import { useEffect, useMemo, useState } from "react";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import type { PermissionGroup, RoleDefinition } from "@/lib/roles";

import { RolePermissionEditor } from "./role-permission-editor";

export interface RoleFormValues {
  name: string;
  /** 仅创建时可填；留空 = 后端自动生成 custom_xxx */
  key: string;
  description: string;
  permissions: string[];
}

interface RoleDrawerProps {
  open: boolean;
  /** null = 创建模式；非 null = 编辑（内置角色只读） */
  role: RoleDefinition | null;
  groups: PermissionGroup[];
  groupsPending: boolean;
  pending: boolean;
  errorText: string | null;
  onClose: () => void;
  onSubmit: (values: RoleFormValues) => void;
}

/**
 * 角色新建/编辑抽屉：基本信息 + 分节权限编辑器。
 * 内置角色只读（权限清单照常展示，checkbox 禁用）；自定义角色可全选/清空每组。
 */
export function RoleDrawer({
  open,
  role,
  groups,
  groupsPending,
  pending,
  errorText,
  onClose,
  onSubmit,
}: RoleDrawerProps) {
  const [name, setName] = useState("");
  const [key, setKey] = useState("");
  const [description, setDescription] = useState("");
  const [permissions, setPermissions] = useState<ReadonlySet<string>>(new Set());

  const isOpen = open;
  const readOnly = role !== null && role.builtin;
  const isCreate = role === null;

  useEffect(() => {
    if (!isOpen) return;
    setName(role?.name ?? "");
    setKey("");
    setDescription(role?.description ?? "");
    setPermissions(new Set(role?.permissions ?? []));
  }, [isOpen, role]);

  const grantedCount = useMemo(() => permissions.size, [permissions]);

  const submit = () => {
    if (readOnly) return;
    const cleanedName = name.trim();
    if (cleanedName.length === 0) return;
    onSubmit({
      name: cleanedName,
      key: key.trim(),
      description: description.trim(),
      permissions: [...permissions].sort(),
    });
  };

  return (
    <Sheet
      open={isOpen}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <SheetContent className="flex flex-col gap-3 overflow-y-auto sm:max-w-xl">
        <SheetHeader className="pr-8">
          <SheetTitle>
            {isCreate ? "新建角色" : readOnly ? "内置角色（只读）" : "编辑角色"}
          </SheetTitle>
          <SheetDescription>
            {isCreate
              ? "创建自定义角色并勾选权限；权限键以后端注册表为准。"
              : readOnly
                ? "内置角色权限固定，不可修改或删除。"
                : "调整名称与权限后保存，变更立即对使用该角色的账号生效。"}
          </SheetDescription>
        </SheetHeader>

        {errorText !== null && <Alert variant="destructive"><span>{errorText}</span></Alert>}

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="role-name">角色名称</Label>
            <Input
              id="role-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={64}
              disabled={pending || readOnly}
              autoComplete="off"
            />
          </div>

          {isCreate ? (
            <div className="space-y-1.5">
              <Label htmlFor="role-key">角色标识（可选）</Label>
              <Input
                id="role-key"
                value={key}
                onChange={(event) => setKey(event.target.value)}
                placeholder="留空自动生成（custom_xxxx）；3-32 位小写字母开头"
                maxLength={32}
                disabled={pending}
                autoComplete="off"
                className="font-mono"
              />
              <p className="text-2xs text-faint">标识创建后不可修改，用户表的 role 字段存的就是它。</p>
            </div>
          ) : (
            <div className="space-y-1.5">
              <Label htmlFor="role-key">角色标识</Label>
              <Input id="role-key" value={role?.key ?? ""} disabled className="font-mono" />
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="role-description">描述</Label>
            <Textarea
              id="role-description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              rows={2}
              maxLength={255}
              disabled={pending || readOnly}
              placeholder="这个角色负责什么"
            />
          </div>

          <div className="space-y-2 border-t border-border pt-3">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold text-title">权限</h3>
              <span className="tnum text-2xs text-faint">已选 {grantedCount} 项</span>
            </div>
            {groupsPending ? (
              <div className="space-y-1.5">
                {Array.from({ length: 6 }, (_, index) => (
                  <Skeleton key={index} className="h-7 w-full" />
                ))}
              </div>
            ) : (
              <RolePermissionEditor
                groups={groups}
                value={permissions}
                onChange={(next) => setPermissions(new Set(next))}
                readOnly={readOnly}
              />
            )}
          </div>
        </div>

        {!readOnly && (
          <div className="mt-auto flex items-center justify-end gap-1.5 border-t border-border pt-3">
            <Button variant="outline" onClick={onClose} disabled={pending}>
              取消
            </Button>
            <Button onClick={submit} disabled={pending || name.trim().length === 0}>
              {pending ? (isCreate ? "创建中…" : "保存中…") : isCreate ? "创建角色" : "保存"}
            </Button>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
