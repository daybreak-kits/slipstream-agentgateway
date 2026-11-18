import { useRef } from "react";
import { Boxes, ChevronDown, Paperclip, Send, Square, X } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { PlaygroundAttachment } from "@/lib/playground";

const ACCEPT =
  ".txt,.md,.markdown,.json,.jsonl,.csv,.tsv,.log,.yaml,.yml,.xml,.html,.css,.js,.jsx,.ts,.tsx,.py,.go,.rs,.sh,.sql,.toml,.ini,text/*";

function formatSize(bytes: number): string {
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
  return (bytes / (1024 * 1024)).toFixed(1) + " MB";
}

export interface ComposerProps {
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  onStop: () => void;
  onFiles: (files: FileList | null) => void;
  onRemoveAttachment: (index: number) => void;
  attachments: PlaygroundAttachment[];
  streaming: boolean;
  disabled: boolean;
  modelReady: boolean;
  model: string;
  thinkingLabel: string;
  summary: string;
  onOpenModels: () => void;
}

export function Composer({
  value,
  onChange,
  onSend,
  onStop,
  onFiles,
  onRemoveAttachment,
  attachments,
  streaming,
  disabled,
  modelReady,
  model,
  thinkingLabel,
  summary,
  onOpenModels,
}: ComposerProps) {
  const fileRef = useRef<HTMLInputElement>(null);

  return (
    <div className="shrink-0 border-t border-border bg-surface px-4 py-3">
      <div className="mx-auto w-full max-w-3xl">
        {attachments.length > 0 ? (
          <div className="mb-2 flex flex-wrap gap-1">
            {attachments.map((file, index) => (
              <Badge key={file.name + "-" + index} tone="neutral" className="gap-1 pr-0.5">
                <Paperclip className="h-3 w-3" />
                <span className="max-w-40 truncate">{file.name}</span>
                <span className="tnum text-faint">{formatSize(file.size)}</span>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6"
                  aria-label={"移除附件 " + file.name}
                  onClick={() => onRemoveAttachment(index)}
                >
                  <X className="h-3 w-3" />
                </Button>
              </Badge>
            ))}
          </div>
        ) : null}

        <Textarea
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing || event.keyCode === 229) return;
            if (event.key === "Enter" && !event.shiftKey && !event.altKey) {
              event.preventDefault();
              if (!disabled) onSend();
              return;
            }
            if (event.key === "Escape" && streaming) {
              event.preventDefault();
              onStop();
            }
          }}
          rows={3}
          placeholder={
            modelReady
              ? "输入消息，Enter 发送，Shift + Enter 换行"
              : "先在右下角选择公开模型"
          }
          className="resize-none"
          aria-label="消息输入框"
        />

        <input
          ref={fileRef}
          type="file"
          multiple
          accept={ACCEPT}
          className="hidden"
          aria-label="添加文本附件"
          onChange={(event) => {
            onFiles(event.target.files);
            event.target.value = "";
          }}
        />

        <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1.5 text-2xs text-faint">
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            title="添加文本附件"
            aria-label="添加文本附件"
            disabled={disabled}
            onClick={() => fileRef.current?.click()}
          >
            <Paperclip className="h-3.5 w-3.5" />
          </Button>
          <span className="min-w-0 max-w-[42%] truncate" title={summary}>
            {summary}
          </span>
          <span aria-hidden="true">·</span>
          <span>{streaming ? "生成中" : "Enter 发送"}</span>
          <span className="tnum">{value.length} 字</span>

          <div className="ml-auto flex items-center gap-1.5">
            <Button
              variant="outline"
              size="sm"
              className="max-w-64 gap-1.5"
              title="选择公开模型与思考等级"
              onClick={onOpenModels}
            >
              <Boxes className="h-3.5 w-3.5" />
              <span className="truncate">{model || "选择模型"}</span>
              <span className="hidden text-2xs text-faint sm:inline">· {thinkingLabel}</span>
              <ChevronDown className="h-3 w-3 opacity-60" />
            </Button>
            {streaming ? (
              <Button variant="outline" size="sm" onClick={onStop}>
                <Square className="h-3.5 w-3.5" />
                停止生成
              </Button>
            ) : (
              <Button size="sm" onClick={onSend} disabled={disabled}>
                <Send className="h-3.5 w-3.5" />
                发送
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
