import type { ReactNode } from "react";
import { AlertCircle, Copy, RotateCcw, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { fmtCny, fmtInt } from "@/lib/format";
import type { PlaygroundMessage, PlaygroundUsage } from "@/lib/playground";
import { cn } from "@/lib/utils";

const INLINE_PATTERN = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)]+\))/g;

/** 行内语法：加粗 / 行内代码 / 链接。够用即可，不引第三方 markdown。 */
function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let cursor = 0;
  let index = 0;
  for (const match of text.matchAll(INLINE_PATTERN)) {
    const start = match.index ?? 0;
    if (start > cursor) nodes.push(text.slice(cursor, start));
    const token = match[0];
    const key = keyPrefix + "-i" + index++;
    if (token.startsWith("**")) {
      nodes.push(
        <strong key={key} className="font-semibold text-title">
          {token.slice(2, -2)}
        </strong>,
      );
    } else if (token.startsWith("`")) {
      nodes.push(
        <code key={key} className="rounded bg-surface-2 px-1 py-0.5 font-mono text-2xs text-title">
          {token.slice(1, -1)}
        </code>,
      );
    } else {
      const link = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(token);
      if (link) {
        nodes.push(
          <a
            key={key}
            href={link[2]}
            target="_blank"
            rel="noreferrer"
            className="text-primary underline underline-offset-2"
          >
            {link[1]}
          </a>,
        );
      } else {
        nodes.push(token);
      }
    }
    cursor = start + token.length;
  }
  if (cursor < text.length) nodes.push(text.slice(cursor));
  return nodes;
}

/** 段落 / 列表 / 小标题。刻意保持简单：聊天回复里这些足够表达。 */
function Prose({ text }: { text: string }) {
  const nodes: ReactNode[] = [];
  let paragraph: string[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;

  const flushParagraph = () => {
    if (paragraph.length === 0) return;
    const key = "p" + nodes.length;
    nodes.push(
      <p key={key} className="whitespace-pre-wrap">
        {renderInline(paragraph.join("\n"), key)}
      </p>,
    );
    paragraph = [];
  };
  const flushList = () => {
    if (!list) return;
    const key = "l" + nodes.length;
    const Tag = list.ordered ? "ol" : "ul";
    nodes.push(
      <Tag
        key={key}
        className={cn("my-1 space-y-0.5 pl-4", list.ordered ? "list-decimal" : "list-disc")}
      >
        {list.items.map((item, itemIndex) => (
          <li key={key + "-" + itemIndex}>{renderInline(item, key + "-" + itemIndex)}</li>
        ))}
      </Tag>,
    );
    list = null;
  };

  for (const rawLine of text.split("\n")) {
    const line = rawLine.trimEnd();
    if (!line.trim()) {
      flushParagraph();
      flushList();
      continue;
    }
    const heading = /^(#{1,3})\s+(.*)$/.exec(line);
    if (heading && heading[2] !== undefined) {
      flushParagraph();
      flushList();
      const key = "h" + nodes.length;
      nodes.push(
        <p key={key} className="mt-1 font-semibold text-title">
          {renderInline(heading[2], key)}
        </p>,
      );
      continue;
    }
    const bullet = /^[-*]\s+(.*)$/.exec(line);
    if (bullet && bullet[1] !== undefined) {
      flushParagraph();
      if (!list || list.ordered) {
        flushList();
        list = { ordered: false, items: [] };
      }
      list.items.push(bullet[1]);
      continue;
    }
    const ordered = /^\d+[.)]\s+(.*)$/.exec(line);
    if (ordered && ordered[1] !== undefined) {
      flushParagraph();
      if (!list || !list.ordered) {
        flushList();
        list = { ordered: true, items: [] };
      }
      list.items.push(ordered[1]);
      continue;
    }
    flushList();
    paragraph.push(line);
  }
  flushParagraph();
  flushList();
  return <>{nodes}</>;
}

/** 简版 markdown：围栏代码块 + 段落级语法。 */
export function MarkdownLite({ text, className }: { text: string; className?: string }) {
  const blocks: ReactNode[] = [];
  const fence = /```([A-Za-z0-9_+-]*)\n([\s\S]*?)```/g;
  let cursor = 0;
  for (const match of text.matchAll(fence)) {
    const start = match.index ?? 0;
    if (start > cursor) blocks.push(<Prose key={"t" + blocks.length} text={text.slice(cursor, start)} />);
    blocks.push(
      <pre
        key={"c" + blocks.length}
        className="my-2 overflow-x-auto rounded-md border border-border bg-surface-2 p-2 text-2xs"
      >
        <code className="font-mono text-title">{(match[2] ?? "").replace(/\n$/, "")}</code>
      </pre>,
    );
    cursor = start + match[0].length;
  }
  if (cursor < text.length) blocks.push(<Prose key={"t" + blocks.length} text={text.slice(cursor)} />);
  return <div className={cn("space-y-1.5 text-2sm leading-relaxed text-body", className)}>{blocks}</div>;
}

function costLabel(usage: PlaygroundUsage): string {
  if (typeof usage.costMicro === "number") return "成本 " + fmtCny(usage.costMicro);
  if (typeof usage.costUsd === "number" && usage.costUsd > 0) {
    return "成本 $" + usage.costUsd.toFixed(6).replace(/0+$/, "").replace(/\.$/, "");
  }
  return "成本 —";
}

function UsageLine({ usage, canSeeCost }: { usage: PlaygroundUsage; canSeeCost: boolean }) {
  const parts: string[] = [
    "输入 " + fmtInt(usage.promptTokens),
    "输出 " + fmtInt(usage.completionTokens),
    "总计 " + fmtInt(usage.totalTokens),
  ];
  if (canSeeCost) parts.push(costLabel(usage));
  parts.push("TTFT " + (usage.ttftMs === null ? "—" : fmtInt(usage.ttftMs) + "ms"));
  parts.push(
    "总耗时 " + (usage.elapsedMs === null ? "—" : (usage.elapsedMs / 1000).toFixed(2) + "s"),
  );
  parts.push(
    "吞吐 " +
      (usage.throughput === null ? "—" : fmtInt(Math.round(usage.throughput)) + " tok/s"),
  );
  if (canSeeCost && typeof usage.chargeMicro === "number") {
    parts.push("花费 " + fmtCny(usage.chargeMicro));
  }
  return (
    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-border pt-1.5 text-2xs text-faint tnum">
      {parts.map((part) => (
        <span key={part}>{part}</span>
      ))}
      {usage.estimated ? <Badge tone="neutral">用量估算</Badge> : null}
      {!canSeeCost ? <span className="text-faint/80">成本需 billing:cost 权限</span> : null}
    </div>
  );
}

async function copyText(text: string) {
  try {
    if (!navigator.clipboard || typeof navigator.clipboard.writeText !== "function") {
      throw new Error("clipboard unavailable");
    }
    await navigator.clipboard.writeText(text);
    toast.success("已复制到剪贴板");
  } catch {
    toast.error("复制失败", { description: "浏览器拒绝写入剪贴板，请手动选中复制" });
  }
}

export interface MessageListProps {
  messages: PlaygroundMessage[];
  streamingId: string | null;
  canSeeCost: boolean;
  onRetryMessage: (message: PlaygroundMessage) => void;
  onDeleteMessage: (message: PlaygroundMessage) => void;
}

export function MessageList({
  messages,
  streamingId,
  canSeeCost,
  onRetryMessage,
  onDeleteMessage,
}: MessageListProps) {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-4 py-5">
      {messages.map((message) => {
        if (message.role === "system") return null;
        const isUser = message.role === "user";
        const streaming = message.id === streamingId;
        return (
          <article
            key={message.id}
            data-message-role={message.role}
            className={cn("group flex flex-col gap-1", isUser && "items-end")}
          >
            <div className="flex w-full items-center gap-2 text-2xs text-faint">
              <span className="font-medium text-body">{isUser ? "你" : "助手"}</span>
              {message.model ? <span className="tnum">{message.model}</span> : null}
              {message.streamed ? <Badge tone="info">流式</Badge> : null}
              {!isUser && message.usage && !message.streamed ? (
                <Badge tone="neutral">整段</Badge>
              ) : null}
              {message.stopped ? <Badge tone="warning">已停止</Badge> : null}
              {streaming ? <Badge tone="primary">生成中</Badge> : null}
              {message.attachments?.length ? (
                <Badge tone="neutral">{message.attachments.length} 个附件</Badge>
              ) : null}
              {message.requestId ? (
                <span
                  className="max-w-40 truncate font-mono text-[10px] text-faint"
                  title={message.requestId}
                >
                  请求 {message.requestId.slice(0, 12)}
                </span>
              ) : null}
              <div className="ml-auto flex items-center gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  title="复制这条消息"
                  aria-label="复制这条消息"
                  onClick={() => void copyText(message.content)}
                >
                  <Copy className="h-3.5 w-3.5" />
                </Button>
                {!streaming ? (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    title={isUser ? "重试这条消息" : "重新生成"}
                    aria-label={isUser ? "重试这条消息" : "重新生成"}
                    onClick={() => onRetryMessage(message)}
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                  </Button>
                ) : null}
                {!streaming ? (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-danger-text"
                    title="删除这条消息"
                    aria-label="删除这条消息"
                    onClick={() => onDeleteMessage(message)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                ) : null}
              </div>
            </div>

            {message.reasoning ? (
              <details className="w-full rounded-md border border-border bg-surface-2/60 px-2.5 py-1.5 text-2xs text-faint">
                <summary className="cursor-pointer select-none text-body">
                  思考过程{message.thinkingLabel ? "（" + message.thinkingLabel + "）" : ""}
                </summary>
                <div className="mt-1 whitespace-pre-wrap leading-relaxed">{message.reasoning}</div>
              </details>
            ) : null}

            <div
              className={cn(
                "max-w-full rounded-lg border px-3 py-2",
                isUser
                  ? "border-primary/30 bg-primary-soft text-title"
                  : "border-border bg-surface text-body",
              )}
            >
              {message.content ? (
                <MarkdownLite text={message.content} className={isUser ? "text-title" : undefined} />
              ) : streaming ? (
                <span className="text-2xs text-faint">{message.streamed ? "等待首个 token…" : "正在生成整段回复…"}</span>
              ) : null}
              {streaming ? (
                <span className="ml-0.5 inline-block h-3.5 w-1 animate-pulse bg-primary align-text-bottom" />
              ) : null}
            </div>

            {message.error ? (
              <div className="flex w-full items-start gap-1.5 rounded-md border border-danger/40 bg-danger-soft px-2.5 py-1.5 text-2xs text-danger-text">
                <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span className="break-words">{message.error}</span>
              </div>
            ) : null}

            {message.usage ? <UsageLine usage={message.usage} canSeeCost={canSeeCost} /> : null}
          </article>
        );
      })}
    </div>
  );
}
