import { useRef, useState } from "react";
import {
  Check,
  Copy,
  Download,
  Pencil,
  Plus,
  RotateCcw,
  Trash2,
  Upload,
  X,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Empty } from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

import {
  MAX_PLAYGROUND_SESSIONS,
  sortSessions,
  type PlaygroundSession,
} from "@/components/playground/sessions";

/** 相对时间：会话列表里只需要「刚刚 / N 分钟前」这种粗粒度。 */
function timeLabel(timestamp: number): string {
  const diff = Date.now() - timestamp;
  if (diff < 60_000) return "刚刚";
  if (diff < 3_600_000) return Math.round(diff / 60_000) + " 分钟前";
  if (diff < 86_400_000) return Math.round(diff / 3_600_000) + " 小时前";
  return Math.round(diff / 86_400_000) + " 天前";
}

export interface SessionListProps {
  sessions: PlaygroundSession[];
  activeId: string;
  onSelect: (id: string) => void;
  onNew: () => void;
  onRename: (id: string, title: string) => void;
  onDelete: (id: string) => void;
  onCopy: (session: PlaygroundSession) => void;
  onRetry: (session: PlaygroundSession) => void;
  onClear: () => void;
  onExport: () => void;
  onImport: (file: File) => void;
  busy: boolean;
}

export function SessionList({
  sessions,
  activeId,
  onSelect,
  onNew,
  onRename,
  onDelete,
  onCopy,
  onRetry,
  onClear,
  onExport,
  onImport,
  busy,
}: SessionListProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const importRef = useRef<HTMLInputElement>(null);

  const startRename = (session: PlaygroundSession) => {
    setEditingId(session.id);
    setDraft(session.title);
    setConfirmDeleteId(null);
  };

  const commitRename = () => {
    if (!editingId) return;
    const title = draft.trim();
    if (title) onRename(editingId, title);
    setEditingId(null);
    setDraft("");
  };

  const ordered = sortSessions(sessions);
  const activeMessages = sessions.find((session) => session.id === activeId)?.messages.length ?? 0;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-1 px-1 pb-2">
        <span className="whitespace-nowrap text-2xs font-medium text-faint tnum">
          会话 {sessions.length}/{MAX_PLAYGROUND_SESSIONS}
        </span>
        <div className="ml-auto flex items-center gap-0.5">
          <input
            ref={importRef}
            type="file"
            accept=".json,application/json"
            className="hidden"
            aria-label="导入会话文件"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) onImport(file);
              event.target.value = "";
            }}
          />
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            title="导入会话 JSON"
            aria-label="导入会话 JSON"
            disabled={busy}
            onClick={() => importRef.current?.click()}
          >
            <Upload className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            title="导出全部会话"
            aria-label="导出全部会话"
            disabled={sessions.length === 0}
            onClick={onExport}
          >
            <Download className="h-3.5 w-3.5" />
          </Button>
          <Button variant="ghost" size="sm" className="h-7 px-1.5" onClick={onNew} disabled={busy}>
            <Plus className="h-3.5 w-3.5" />
            新建
          </Button>
        </div>
      </div>

      <div className="min-h-0 flex-1 space-y-1 overflow-y-auto pr-0.5">
        {ordered.length === 0 ? (
          <Empty text="还没有会话" className="py-6" />
        ) : (
          ordered.map((session) => {
            const active = session.id === activeId;
            const editing = session.id === editingId;
            const confirming = session.id === confirmDeleteId;
            const canRetry = session.messages.some((message) => message.role === "user");
            return (
              <div
                key={session.id}
                className={cn(
                  "group rounded-md border px-2 py-1.5 transition-colors",
                  active
                    ? "border-primary/40 bg-primary-soft"
                    : "border-transparent hover:border-border hover:bg-surface-2",
                )}
              >
                {editing ? (
                  <div className="flex items-center gap-1">
                    <Input
                      value={draft}
                      autoFocus
                      aria-label="会话名称"
                      onChange={(event) => setDraft(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") commitRename();
                        if (event.key === "Escape") setEditingId(null);
                      }}
                      className="h-7 py-0 text-2xs"
                    />
                    <Button variant="ghost" size="icon" title="保存名称" aria-label="保存名称" onClick={commitRename}>
                      <Check className="h-3.5 w-3.5" />
                    </Button>
                    <Button variant="ghost" size="icon" title="取消" aria-label="取消重命名" onClick={() => setEditingId(null)}>
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ) : (
                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      className="h-auto w-full min-w-0 flex-1 shrink flex-col items-stretch justify-start gap-0 px-0 py-0 text-left font-normal whitespace-normal"
                      onClick={() => {
                        onSelect(session.id);
                        setConfirmDeleteId(null);
                        setConfirmClear(false);
                      }}
                    >
                      <span
                        className={cn(
                          "block truncate text-2sm",
                          active ? "font-medium text-primary" : "text-body",
                        )}
                      >
                        {session.title}
                      </span>
                      <span className="block text-2xs text-faint">
                        {timeLabel(session.updatedAt)} · {session.messages.length} 条
                      </span>
                    </Button>
                    <div className="flex items-center gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6"
                        title="复制会话"
                        aria-label="复制会话"
                        disabled={busy}
                        onClick={() => onCopy(session)}
                      >
                        <Copy className="h-3 w-3" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6"
                        title="重试最近一轮"
                        aria-label="重试最近一轮"
                        disabled={busy || !canRetry}
                        onClick={() => onRetry(session)}
                      >
                        <RotateCcw className="h-3 w-3" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6"
                        title="重命名会话"
                        aria-label="重命名会话"
                        onClick={() => startRename(session)}
                      >
                        <Pencil className="h-3 w-3" />
                      </Button>
                      {confirming ? (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6 text-danger-text"
                          title="确认删除"
                          aria-label="确认删除"
                          onClick={() => {
                            onDelete(session.id);
                            setConfirmDeleteId(null);
                          }}
                        >
                          <Check className="h-3 w-3" />
                        </Button>
                      ) : (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6"
                          title="删除会话"
                          aria-label="删除会话"
                          disabled={sessions.length <= 1 || busy}
                          onClick={() => setConfirmDeleteId(session.id)}
                        >
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      <div className="mt-2 flex items-center gap-2 border-t border-border pt-2">
        <Badge tone="neutral" className="tnum">
          {activeMessages} 条消息
        </Badge>
        {confirmClear ? (
          <>
            <Button
              variant="danger"
              size="sm"
              className="ml-auto"
              onClick={() => {
                onClear();
                setConfirmClear(false);
              }}
            >
              确认清空
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setConfirmClear(false)}>
              取消
            </Button>
          </>
        ) : (
          <Button
            variant="outline"
            size="sm"
            className="ml-auto"
            disabled={activeMessages === 0 || busy}
            onClick={() => setConfirmClear(true)}
          >
            清空当前会话
          </Button>
        )}
      </div>
    </div>
  );
}
