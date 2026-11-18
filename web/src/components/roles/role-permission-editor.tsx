import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import type { PermissionGroup } from "@/lib/roles";

interface RolePermissionEditorProps {
  /** GET /admin/permissions 的分组（后端注册表，前端不硬编键名） */
  groups: PermissionGroup[];
  /** 已勾选的权限键 */
  value: ReadonlySet<string>;
  onChange: (next: string[]) => void;
  /** 内置角色只读展示 */
  readOnly?: boolean;
}

/**
 * 权限编辑器（ADR-023）：按后端分组的 7 个小节渲染 checkbox 列表，
 * 每组带全选/清空；绝不渲染角色 × 权限的大矩阵。
 */
export function RolePermissionEditor({ groups, value, onChange, readOnly = false }: RolePermissionEditorProps) {
  const toggle = (key: string) => {
    if (readOnly) return;
    const next = new Set(value);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    onChange([...next].sort());
  };

  const selectGroup = (group: PermissionGroup, selected: boolean) => {
    if (readOnly) return;
    const next = new Set(value);
    for (const entry of group.permissions) {
      if (selected) next.add(entry.key);
      else next.delete(entry.key);
    }
    onChange([...next].sort());
  };

  return (
    <div className="space-y-4">
      {groups.map((group) => {
        const granted = group.permissions.filter((entry) => value.has(entry.key)).length;
        return (
          <section key={group.group} className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <h4 className="text-2sm font-semibold text-title">{group.group}</h4>
              <span className="tnum text-2xs text-faint">
                {granted}/{group.permissions.length}
              </span>
              {!readOnly && (
                <span className="ml-auto flex items-center gap-1">
                  <Button variant="ghost" size="sm" onClick={() => selectGroup(group, true)}>
                    全选
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => selectGroup(group, false)}>
                    清空
                  </Button>
                </span>
              )}
            </div>
            <div className="grid gap-x-6 gap-y-1.5 sm:grid-cols-2">
              {group.permissions.map((entry) => (
                <label
                  key={entry.key}
                  className={
                    "flex cursor-pointer items-start gap-2 rounded-control px-1 py-0.5 transition-colors hover:bg-surface-2" +
                    (readOnly ? " cursor-default hover:bg-transparent" : "")
                  }
                >
                  <Checkbox
                    className="mt-0.5"
                    checked={value.has(entry.key)}
                    onCheckedChange={() => toggle(entry.key)}
                    disabled={readOnly}
                    aria-label={entry.label + "（" + entry.key + "）"}
                  />
                  <span className="min-w-0">
                    <span className="block truncate text-2sm text-body">{entry.label}</span>
                    <span className="block truncate font-mono text-2xs text-faint" title={entry.description}>
                      {entry.key}
                    </span>
                  </span>
                </label>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
