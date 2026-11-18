import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

interface RawJsonEditorProps {
  value: string;
  onChange: (next: string) => void;
  error?: string;
  disabled?: boolean;
  description?: string;
  className?: string;
}

/** Advanced editor: the textarea is the document; parse errors block saving. */
export function RawJsonEditor({
  value,
  onChange,
  error,
  disabled = false,
  description,
  className,
}: RawJsonEditorProps) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <Textarea
        value={value}
        onChange={(event) => onChange(event.target.value)}
        spellCheck={false}
        disabled={disabled}
        aria-label="原始 JSON 配置"
        className={cn(
          "min-h-[320px] font-mono text-xs leading-relaxed",
          error !== undefined && "border-danger",
        )}
      />
      {error !== undefined ? (
        <p className="text-2xs text-danger-text">{error}</p>
      ) : (
        <p className="text-2xs text-faint">
          {description ?? "直接编辑后端文档；保存前会在浏览器做 JSON 语法校验，服务端仍会做 IR/AG 1.7 校验。"}
        </p>
      )}
    </div>
  );
}
