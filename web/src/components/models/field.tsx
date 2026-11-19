import { Label } from "@/components/ui/label";

/** 弹窗表单字段：标签 + 控件 + 可选说明（models 各编辑弹窗共用）。 */
export function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <Label>{label}</Label>
      {children}
      {hint ? <p className="text-2xs text-faint">{hint}</p> : null}
    </div>
  );
}
