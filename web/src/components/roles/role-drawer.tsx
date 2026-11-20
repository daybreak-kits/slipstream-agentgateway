import { useEffect, useMemo, useState } from "react";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { DirtyCountBadge, DirtyField, DirtyFooter, DirtySaveButton } from "@/components/ui/dirty-field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { sameSet } from "@/lib/dirty-fields";
import type { PermissionGroup, RoleDefinition } from "@/lib/roles";
import { useDirtyFields } from "@/lib/use-dirty-fields";

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
  // W4-G：关闭前与打开时的基线比较，dirty 时先确认再放弃（Esc/遮罩/取消都汇入 requestClose）。
  const [baseline, setBaseline] = useState<{ name: string; key: string; description: string; permissions: ReadonlySet<string> } | null>(null);
  const [confirmDiscard, setConfirmDiscard] = useState(false);

  const isOpen = open;
  const readOnly = role !== null && role.builtin;
  const isCreate = role === null;

  useEffect(() => {
    if (!isOpen) {
      setBaseline(null);
      setConfirmDiscard(false);
      return;
    }
    const initial = {
      name: role?.name ?? "",
      key: "",
      description: role?.description ?? "",
      permissions: new Set<string>(role?.permissions ?? []),
    };
    setName(initial.name);
    setKey(initial.key);
    setDescription(initial.description);
    setPermissions(initial.permissions);
    setBaseline(initial);
  }, [isOpen, role]);

  const grantedCount = useMemo(() => permissions.size, [permissions]);

  // 字段级脏标记：baseline = 打开时的快照；保存成功后父级回填 role，重开即清零。
  const { dirtyCount, isDirty, isDirtyField } = useDirtyFields(
    readOnly ? null : baseline,
    { name, key, description, permissions },
    { equals: { permissions: sameSet } },
  );

  // 权限区块标题的未保存数量 = 新增 + 移除的权限键数，而不是「勾选了 N 项」。
  const permissionChangeCount = useMemo(() => {
    if (!baseline || !isDirtyField("permissions")) return 0;
    let changes = 0;
    for (const permission of permissions) if (!baseline.permissions.has(permission)) changes += 1;
    for (const permission of baseline.permissions) if (!permissions.has(permission)) changes += 1;
    return changes;
  }, [baseline, isDirtyField, permissions]);

  const resetField = (field: "name" | "key" | "description" | "permissions") => {
    if (!baseline) return;
    if (field === "name") setName(baseline.name);
    else if (field === "key") setKey(baseline.key);
    else if (field === "description") setDescription(baseline.description);
    else setPermissions(new Set(baseline.permissions));
  };

  const resetAll = () => {
    if (!baseline) return;
    setName(baseline.name);
    setKey(baseline.key);
    setDescription(baseline.description);
    setPermissions(new Set(baseline.permissions));
  };

  const requestClose = () => {
    if (isDirty) {
      setConfirmDiscard(true);
      return;
    }
    onClose();
  };

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
    <>
    <Sheet
      open={isOpen}
      onOpenChange={(next) => {
        if (!next) requestClose();
      }}
    >
      <SheetContent className="flex flex-col gap-3 overflow-y-auto sm:max-w-xl">
        <SheetHeader className="pr-8">
          <SheetTitle>
            {isCreate ? "新建角色" : readOnly ? "内置角色权限摘要" : "编辑角色"}
          </SheetTitle>
          <SheetDescription>
            {isCreate
              ? "创建自定义角色并勾选权限；权限键以后端注册表为准。"
              : readOnly
                ? "内置角色权限由后端锁定，仅供查看，不可修改或删除。"
                : "调整名称与权限后保存，变更立即对使用该角色的账号生效。"}
          </SheetDescription>
        </SheetHeader>

        {errorText !== null && <Alert variant="destructive"><span>{errorText}</span></Alert>}

        <div className="space-y-3">
          <DirtyField dirty={isDirtyField("name")} onReset={() => resetField("name")} resetLabel="恢复角色名称">
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
          </DirtyField>

          <DirtyField dirty={isDirtyField("key")} onReset={() => resetField("key")} resetLabel="恢复角色标识">
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
          </DirtyField>

          <DirtyField
            dirty={isDirtyField("description")}
            onReset={() => resetField("description")}
            resetLabel="恢复角色描述"
          >
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
          </DirtyField>

          <DirtyField
            dirty={isDirtyField("permissions")}
            onReset={() => resetField("permissions")}
            resetLabel="恢复权限勾选"
          >
            <div className="space-y-2 border-t border-border pt-3">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-sm font-semibold text-title">权限</h3>
                <span className="tnum text-2xs text-faint">已选 {grantedCount} 项</span>
                <DirtyCountBadge count={permissionChangeCount} />
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
          </DirtyField>
        </div>

        {!readOnly && (
          <DirtyFooter count={dirtyCount} onResetAll={resetAll} saving={pending} className="mt-auto">
            <Button variant="outline" onClick={requestClose} disabled={pending}>
              取消
            </Button>
            <DirtySaveButton
              dirty={isDirty}
              pending={pending}
              savingLabel={isCreate ? "创建中…" : "保存中…"}
              onClick={submit}
              disabled={name.trim().length === 0}
            >
              {isCreate ? "创建角色" : "保存"}
            </DirtySaveButton>
          </DirtyFooter>
        )}
      </SheetContent>
    </Sheet>
    {confirmDiscard ? (
      <ConfirmDialog
        open
        onOpenChange={(next) => { if (!next) setConfirmDiscard(false); }}
        title="放弃修改？"
        description="抽屉内有未保存的修改（名称、描述或权限勾选），关闭后将丢失。"
        confirmLabel="放弃修改"
        destructive
        onConfirm={() => {
          setConfirmDiscard(false);
          onClose();
        }}
      />
    ) : null}
    </>
  );
}
