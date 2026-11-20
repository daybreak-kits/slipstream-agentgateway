import { Children, cloneElement, isValidElement, useId, type ReactElement } from "react";

import { Label } from "@/components/ui/label";

/**
 * 弹窗表单字段：标签 + 控件 + 可选说明（models 各编辑弹窗共用）。
 *
 * 单个子元素且自身没有 id 时自动注入 id，并让 <Label htmlFor> 指向它——
 * 表单 label 与控件因此有可访问性关联（读屏与 Playwright getByLabel 都能定位）。
 * 多子元素、Fragment 或已有 id 的控件保持原样，不改变现有结构。
 */
export function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  // useId 产物含框架特殊字符（如 :r0:），转成可安全放进 id/htmlFor 的片段。
  const autoId = "field-" + useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const child =
    Children.count(children) === 1 && isValidElement(children)
      ? (children as ReactElement<{ id?: string }>)
      : null;
  const childId = child ? child.props.id : undefined;
  const canInject = Boolean(child) && childId === undefined && typeof child?.type !== "symbol";
  const id = childId ?? (canInject ? autoId : undefined);
  const control = canInject ? cloneElement(child as ReactElement<{ id?: string }>, { id: autoId }) : children;
  return (
    <div className="space-y-1">
      <Label htmlFor={id}>{label}</Label>
      {control}
      {hint ? <p className="text-2xs text-faint">{hint}</p> : null}
    </div>
  );
}
