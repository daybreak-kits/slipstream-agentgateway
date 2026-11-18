import { Fragment } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableWrap, TD, TH, THead, TR } from "@/components/ui/table";
import type { PermissionGroup, RoleDefinition } from "@/lib/roles";

interface PermissionMatrixProps {
  roles: RoleDefinition[];
  groups: PermissionGroup[];
  canEdit: boolean;
  savingKey: string | null;
  onToggle: (role: RoleDefinition, permission: string) => void;
  onDelete: (role: RoleDefinition) => void;
}

/**
 * 角色 × 权限矩阵：行是 resource:action 权限键（按组），列是角色。
 * 内置角色不可改（admin 为全部权限），自定义角色可由管理用户逐条勾选。
 */
export function PermissionMatrix({
  roles,
  groups,
  canEdit,
  savingKey,
  onToggle,
  onDelete,
}: PermissionMatrixProps) {
  return (
    <div className="space-y-2">
      <TableWrap className="rounded-md border border-border">
        <Table>
          <THead>
            <tr>
              <TH className="w-56">权限</TH>
              {roles.map((role) => (
                <TH key={role.id} className="min-w-36">
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span>{role.name}</span>
                        {role.builtin ? <Badge tone="neutral">内置</Badge> : null}
                        {role.all_permissions ? <Badge tone="primary">全部</Badge> : null}
                      </div>
                      <div className="truncate font-mono text-2xs font-normal text-faint">
                        {role.key} · {role.member_count} 人
                      </div>
                    </div>
                    {!role.builtin && canEdit ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 px-1.5 text-2xs text-danger-text"
                        disabled={role.member_count > 0 || savingKey === role.id}
                        title={
                          role.member_count > 0
                            ? "角色仍有成员，先转移成员再删除"
                            : "删除自定义角色"
                        }
                        onClick={() => onDelete(role)}
                      >
                        删除
                      </Button>
                    ) : null}
                  </div>
                </TH>
              ))}
            </tr>
          </THead>
          <tbody>
            {groups.map((group) => (
              <Fragment key={group.group}>
                <TR className="bg-surface-2/60 hover:bg-surface-2/60">
                  <TD colSpan={1 + roles.length} className="text-2xs font-medium text-faint">
                    {group.group}
                  </TD>
                </TR>
                {group.permissions.map((permission) => (
                  <TR key={permission.key}>
                    <TD>
                      <div className="flex items-baseline gap-1.5">
                        <span className="text-title">{permission.label}</span>
                        <span className="font-mono text-2xs text-faint">{permission.key}</span>
                      </div>
                    </TD>
                    {roles.map((role) => {
                      const granted =
                        role.all_permissions || role.permissions.includes(permission.key);
                      const editable = canEdit && !role.builtin && !role.all_permissions;
                      return (
                        <TD key={role.id} className="text-center">
                          <Checkbox
                            checked={granted}
                            disabled={!editable || savingKey === role.id}
                            onCheckedChange={() => onToggle(role, permission.key)}
                            aria-label={role.name + " · " + permission.key}
                          />
                        </TD>
                      );
                    })}
                  </TR>
                ))}
              </Fragment>
            ))}
          </tbody>
        </Table>
      </TableWrap>
      <p className="text-2xs text-faint">
        权限键格式为 resource:action，由后端注册表统一校验；勾选后立即 PATCH /admin/roles 生效。
        内置角色不可修改（管理用户恒为全部权限），自定义角色需先清空成员才能删除。
      </p>
    </div>
  );
}
