import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowDown, Sparkles } from "lucide-react";
import { toast } from "@/lib/notify";

import { Composer } from "@/components/playground/composer";
import { MessageList } from "@/components/playground/message-list";
import { ModelDialog } from "@/components/playground/model-dialog";
import { ParamsPanel } from "@/components/playground/params-panel";
import {
  EMPTY_PLAYGROUND_PARAMS,
  type PlaygroundParamsState,
} from "@/lib/playground-params";
import { SessionList } from "@/components/playground/session-list";
import {
  createSession,
  deriveSessionTitle,
  duplicateSession,
  loadSessionState,
  MAX_PLAYGROUND_SESSIONS,
  mergeImportedSessions,
  parseSessionFile,
  saveSessionState,
  serializeSessionFile,
  type PlaygroundSession,
  type SessionState,
} from "@/components/playground/sessions";
import { Button } from "@/components/ui/button";
import { api, ENDPOINTS } from "@/lib/api";
import { formatDuration } from "@/lib/format";
import { AUTH_ME_QUERY_KEY, fetchMe } from "@/lib/auth";
import { useMock } from "@/lib/mock";
import {
  buildUsage,
  buildUserContent,
  chatParamsFromInput,
  describeChatError,
  describeThinking,
  isAbortError,
  listPlaygroundModels,
  normalizeDeclaredDefault,
  REASONING_LEVEL_LABELS,
  sendChatStream,
  summarizeChatParams,
  toRequestMessages,
  validateChatParams,
  type PlaygroundAttachment,
  type PlaygroundMessage,
  type PlaygroundUsage,
} from "@/lib/playground";
import type { MyModelOut } from "@/types";
import { PageHeader } from "@/components/layout/page-header";

/** 后端 /admin/logs 只接受 25/50/100/200 四档 page_size（api deps.page_params）。 */
const USAGE_LOG_PAGE_SIZE = 25;

/** /admin/logs 里用到的字段（账本口径：金额是整数微单位）。 */
interface UsageLogRow {
  event_id: string;
  started_at_ms: number;
  public_model: string;
  duration_ms: number;
  time_to_first_token_ms: number;
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  cost_micro: number | null;
  charge_micro: number | null;
  currency: string;
}

interface UsageLogPage {
  total: number;
  items: UsageLogRow[];
  next_offset: number | null;
}

/** 附件上限：只读文本，256 KB / 最多 5 个，够贴日志和代码片段。 */
const MAX_ATTACHMENT_BYTES = 256 * 1024;
const MAX_ATTACHMENTS = 5;
const TEXT_FILE_PATTERN =
  /\.(txt|md|markdown|json|jsonl|csv|tsv|log|ya?ml|xml|html?|css|jsx?|tsx?|py|go|rs|sh|sql|toml|ini)$/i;

function newMessageId(): string {
  return "pg-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 7);
}

/** 上游没回 usage 时的兜底估算：中文约 1.5 字/token，英文约 4 字符/token。 */
function estimateTokens(text: string): number {
  return Math.max(1, Math.round(text.length / 4));
}

const SAMPLE_PROMPTS = [
  "用三句话解释什么是模型接口网关",
  "把这段日志按错误码归类并给出排查顺序",
  "写一个最小可用的 SSE 解析器，并说明边界情况",
];

/** 把 /admin/logs 里刚落地的那条记录并进用量：成本/花费只有账本才有。 */
function mergeLedgerUsage(usage: PlaygroundUsage, row: UsageLogRow): PlaygroundUsage {
  return {
    ...usage,
    promptTokens: row.input_tokens || usage.promptTokens,
    completionTokens: row.output_tokens || usage.completionTokens,
    totalTokens: row.total_tokens || usage.totalTokens,
    ttftMs: row.time_to_first_token_ms || usage.ttftMs,
    elapsedMs: row.duration_ms || usage.elapsedMs,
    costMicro: row.cost_micro,
    chargeMicro: row.charge_micro,
    currency: row.currency,
    estimated: false,
  };
}

function ChatHero({ hasModel, onPick }: { hasModel: boolean; onPick: (text: string) => void }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-6 py-10 text-center">
      <div className="rounded-full bg-primary-soft p-3">
        <Sparkles className="h-5 w-5 text-primary" />
      </div>
      <p className="text-sm font-medium text-title">开始一段对话</p>
      <p className="max-w-md text-2xs leading-relaxed text-faint">
        20 项采样/输出参数全部透传，悬停标签看取值范围；每条回复回显词元、TTFT、耗时、吞吐与成本。
        会话只存在这个浏览器里，可复制、重试、导入导出。
      </p>
      {hasModel ? (
        <div className="flex flex-wrap justify-center gap-1.5">
          {SAMPLE_PROMPTS.map((prompt) => (
            <Button key={prompt} variant="outline" size="sm" onClick={() => onPick(prompt)}>
              {prompt}
            </Button>
          ))}
        </div>
      ) : (
        <p className="text-2xs text-warning-text">先在右下角选择一个公开模型</p>
      )}
    </div>
  );
}

export function PlaygroundPage() {
  const [state, setState] = useState<SessionState>(() => loadSessionState());
  const [params, setParams] = useState<PlaygroundParamsState>(EMPTY_PLAYGROUND_PARAMS);
  const [draft, setDraft] = useState("");
  const [attachments, setAttachments] = useState<PlaygroundAttachment[]>([]);
  const [modelDialogOpen, setModelDialogOpen] = useState(false);
  const [streamingId, setStreamingId] = useState<string | null>(null);
  const [atBottom, setAtBottom] = useState(true);
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const stickRef = useRef(true);
  const streaming = streamingId !== null;

  const activeSession = useMemo<PlaygroundSession>(() => {
    const found = state.sessions.find((session) => session.id === state.activeId);
    if (found) return found;
    return state.sessions[0] ?? createSession();
  }, [state]);

  useEffect(() => {
    // 流式期间每帧都会 setState，落盘做 350ms 去抖，避免每帧同步写 localStorage。
    const timer = window.setTimeout(() => saveSessionState(state), 350);
    return () => window.clearTimeout(timer);
  }, [state]);

  const modelsQuery = useQuery({
    queryKey: ["playground", "models"],
    queryFn: listPlaygroundModels,
    staleTime: 60_000,
  });

  const meQuery = useQuery({
    queryKey: AUTH_ME_QUERY_KEY,
    queryFn: fetchMe,
    staleTime: 60_000,
  });

  // W4-H：登录用户可见的启用公开模型参数（/admin/my/models，无金额键）；失败静默隐藏。
  const myModelsQuery = useQuery({
    queryKey: ["my-models"],
    queryFn: () => api.get<MyModelOut[]>(ENDPOINTS.myModels),
    staleTime: 60_000,
    retry: false,
  });
  const activeModelInfo = useMemo(
    () => myModelsQuery.data?.find((item) => item.name === params.model) ?? null,
    [myModelsQuery.data, params.model],
  );
  // 票18：切换模型后思考档位回到该模型声明的默认档；未声明回退 default（不发送）。
  // 依赖只用原始值：my/models 重新拉取产生新对象时不会重置用户手选的档位。
  const modelInfoName = activeModelInfo?.name;
  const declaredDefault = activeModelInfo?.parameters.default_reasoning_level;
  useEffect(() => {
    setParams((prev) => ({ ...prev, thinkingMode: normalizeDeclaredDefault(declaredDefault) }));
  }, [modelInfoName, declaredDefault]);

  const permissions = meQuery.data?.permissions ?? [];
  const canSeeCost =
    permissions.length > 0
      ? permissions.includes("billing:cost")
      : meQuery.data?.role === "admin";

  useEffect(() => {
    const list = modelsQuery.data;
    const first = list?.[0];
    if (!first) return;
    if (!params.model || !list.some((model) => model.name === params.model)) {
      setParams((prev) => (prev.model === first.name ? prev : { ...prev, model: first.name }));
    }
  }, [modelsQuery.data, params.model]);

  const patchSession = useCallback(
    (sessionId: string, update: (session: PlaygroundSession) => PlaygroundSession, touch = true) => {
      setState((prev) => ({
        ...prev,
        sessions: prev.sessions.map((session) =>
          session.id === sessionId
            ? { ...update(session), updatedAt: touch ? Date.now() : session.updatedAt }
            : session,
        ),
      }));
    },
    [],
  );

  const patchMessage = useCallback(
    (sessionId: string, messageId: string, update: (message: PlaygroundMessage) => PlaygroundMessage) => {
      patchSession(
        sessionId,
        (session) => ({
          ...session,
          messages: session.messages.map((message) => (message.id === messageId ? update(message) : message)),
        }),
        false,
      );
    },
    [patchSession],
  );

  const enrichUsage = useCallback(
    async (sessionId: string, messageId: string, model: string, startedAt: number, usage: PlaygroundUsage) => {
      if (useMock) return;
      try {
        const page = await api.get<UsageLogPage>("/admin/logs?page_size=" + USAGE_LOG_PAGE_SIZE + "&offset=0");
        const row = page.items.find(
          (item) =>
            item.public_model === model &&
            item.started_at_ms >= startedAt - 5_000 &&
            item.started_at_ms <= Date.now() + 5_000,
        );
        if (!row) return;
        patchMessage(sessionId, messageId, (message) => ({
          ...message,
          usage: mergeLedgerUsage(usage, row),
        }));
      } catch {
        // 日志尚未落库或当前账号没有 usage:read：保留浏览器侧估算，不打断对话。
      }
    },
    [patchMessage],
  );

  const runTurn = useCallback(
    async (sessionId: string, history: PlaygroundMessage[], userMessage?: PlaygroundMessage) => {
      const model = params.model;
      if (!model) {
        toast.error("先选择公开模型");
        return;
      }
      // 票19：上限用所选模型登记的 max_output_tokens；无登记数据时校验层回退
      // 安全默认（与面板口径一致），后端还有按登记值的兜底 422。
      const validation = validateChatParams(params, {
        maxOutputTokens: activeModelInfo?.parameters.max_output_tokens,
      });
      if (!validation.valid) {
        toast.error("参数不合法", { description: validation.message });
        return;
      }
      const chatParams = chatParamsFromInput(params);
      const base = userMessage ? [...history, userMessage] : history;
      if (!base.some((message) => message.role === "user")) {
        toast.error("没有可发送的用户消息");
        return;
      }

      const assistantId = newMessageId();
      const assistantMessage: PlaygroundMessage = {
        id: assistantId,
        role: "assistant",
        content: "",
        model,
        createdAt: Date.now(),
        streaming: true,
        streamed: params.streaming,
      };

      patchSession(sessionId, (session) => ({
        ...session,
        title:
          userMessage && session.messages.length === 0 ? deriveSessionTitle(base) : session.title,
        messages: [...base, assistantMessage],
      }));
      setStreamingId(assistantId);
      const controller = new AbortController();
      abortRef.current = controller;
      const startedAt = Date.now();
      let liveContent = "";
      let liveReasoning = "";

      try {
        const stats = await sendChatStream(model, toRequestMessages(base, params.systemPrompt), {
          signal: controller.signal,
          params: chatParams,
          apiKey: params.apiKey,
          stream: params.streaming,
          onDelta: (text) => {
            liveContent = text;
            if (params.streaming) {
              patchMessage(sessionId, assistantId, (message) => ({ ...message, content: text }));
            }
          },
          onReasoning: (text) => {
            liveReasoning = text;
            if (params.streaming) {
              patchMessage(sessionId, assistantId, (message) => ({ ...message, reasoning: text }));
            }
          },
        });

        const usage: PlaygroundUsage = stats.usage
          ? buildUsage({
              promptTokens: stats.usage.prompt_tokens ?? 0,
              completionTokens: stats.usage.completion_tokens ?? 0,
              totalTokens: stats.usage.total_tokens ?? 0,
              ttftMs: stats.ttftMs,
              elapsedMs: stats.elapsedMs,
              throughput:
                stats.elapsedMs > 0
                  ? (stats.usage.completion_tokens ?? 0) / (stats.elapsedMs / 1000)
                  : null,
              estimated: false,
            })
          : buildUsage({
              promptTokens: toRequestMessages(base, params.systemPrompt).reduce(
                (sum, message) => sum + estimateTokens(message.content),
                0,
              ),
              completionTokens: estimateTokens(stats.content),
              ttftMs: stats.ttftMs,
              elapsedMs: stats.elapsedMs,
              throughput:
                stats.elapsedMs > 0 ? estimateTokens(stats.content) / (stats.elapsedMs / 1000) : null,
              estimated: true,
            });

        patchMessage(sessionId, assistantId, (message) => ({
          ...message,
          content: stats.content,
          reasoning: stats.reasoning,
          thinkingLabel: describeThinking(chatParams, stats.reasoning, stats.carrier)?.label,
          requestId: stats.requestId,
          usage,
          streaming: false,
        }));
        toast.success("回复完成", {
          description: usage.totalTokens + " 词元 · " + formatDuration(stats.elapsedMs),
        });
        void enrichUsage(sessionId, assistantId, model, startedAt, usage);
      } catch (error) {
        if (isAbortError(error)) {
          patchMessage(sessionId, assistantId, (message) => ({
            ...message,
            content: liveContent || message.content,
            reasoning: liveReasoning || message.reasoning,
            streaming: false,
            stopped: true,
          }));
          toast("已停止生成");
        } else {
          const reason = describeChatError(error);
          patchMessage(sessionId, assistantId, (message) => ({
            ...message,
            content: liveContent || message.content,
            streaming: false,
            error: reason,
          }));
          toast.error("生成失败", { description: reason });
        }
      } finally {
        setStreamingId(null);
        abortRef.current = null;
      }
    },
    [enrichUsage, params, patchMessage, patchSession, activeModelInfo],
  );

  const send = () => {
    if (streaming) return;
    const text = draft.trim();
    if (!text && attachments.length === 0) {
      toast.error("先输入内容或添加附件");
      return;
    }
    if (!params.model) {
      toast.error("先选择公开模型");
      return;
    }
    const validation = validateChatParams(params, {
      maxOutputTokens: activeModelInfo?.parameters.max_output_tokens,
    });
    if (!validation.valid) {
      toast.error("参数不合法", { description: validation.message });
      return;
    }
    const content = buildUserContent(text, attachments);
    if (!content.trim()) {
      toast.error("消息内容为空");
      return;
    }
    const userMessage: PlaygroundMessage = {
      id: newMessageId(),
      role: "user",
      content,
      createdAt: Date.now(),
      attachments: attachments.length ? attachments : undefined,
    };
    const history = activeSession.messages;
    setDraft("");
    setAttachments([]);
    stickRef.current = true;
    setAtBottom(true);
    void runTurn(activeSession.id, history, userMessage);
  };

  const retryMessage = (message: PlaygroundMessage) => {
    if (streaming) {
      toast.error("生成中不能重试");
      return;
    }
    const messages = activeSession.messages;
    const index = messages.indexOf(message);
    if (index < 0) return;
    if (message.role === "user") {
      void runTurn(activeSession.id, messages.slice(0, index), message);
      return;
    }
    const history = messages.slice(0, index);
    if (!history.some((item) => item.role === "user")) {
      toast.error("这条回复之前没有用户消息");
      return;
    }
    void runTurn(activeSession.id, history);
  };

  const deleteMessage = (message: PlaygroundMessage) => {
    if (streaming) {
      toast.error("生成中不能删除消息");
      return;
    }
    patchSession(activeSession.id, (session) => ({
      ...session,
      messages: session.messages.filter((item) => item.id !== message.id),
    }));
    toast.success("已删除消息");
  };

  const stop = () => {
    abortRef.current?.abort();
  };

  const scrollToBottom = useCallback(() => {
    const node = scrollRef.current;
    if (!node) return;
    node.scrollTop = node.scrollHeight;
    stickRef.current = true;
    setAtBottom(true);
  }, []);

  const lastMessage = activeSession.messages[activeSession.messages.length - 1];
  useEffect(() => {
    if (!stickRef.current) return;
    const node = scrollRef.current;
    if (!node) return;
    node.scrollTop = node.scrollHeight;
  }, [activeSession.id, activeSession.messages.length, lastMessage?.content.length, streamingId]);

  const handleScroll = () => {
    const node = scrollRef.current;
    if (!node) return;
    const distance = node.scrollHeight - node.scrollTop - node.clientHeight;
    const bottom = distance < 80;
    stickRef.current = bottom;
    setAtBottom(bottom);
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && abortRef.current) abortRef.current.abort();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const handleFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const next = [...attachments];
    for (const file of Array.from(files)) {
      if (next.length >= MAX_ATTACHMENTS) {
        toast.error("附件最多 " + MAX_ATTACHMENTS + " 个");
        break;
      }
      if (file.size > MAX_ATTACHMENT_BYTES) {
        toast.error("附件太大", { description: file.name + " 超过 256 KB" });
        continue;
      }
      if (!file.type.startsWith("text/") && !TEXT_FILE_PATTERN.test(file.name)) {
        toast.error("只支持文本附件", { description: file.name });
        continue;
      }
      if (next.some((item) => item.name === file.name && item.size === file.size)) continue;
      try {
        next.push({ name: file.name, size: file.size, text: await file.text() });
      } catch {
        toast.error("读取附件失败", { description: file.name });
      }
    }
    setAttachments(next);
  };

  const removeAttachment = (index: number) => {
    setAttachments((prev) => prev.filter((_, itemIndex) => itemIndex !== index));
  };

  const newSession = () => {
    if (streaming) {
      toast.error("生成中不能新建会话");
      return;
    }
    const session = createSession();
    setState((prev) => ({
      sessions: [session, ...prev.sessions].slice(0, MAX_PLAYGROUND_SESSIONS),
      activeId: session.id,
    }));
    setDraft("");
    setAttachments([]);
    toast.success("已新建会话");
  };

  const selectSession = (id: string) => {
    if (streaming && id !== state.activeId) {
      toast.error("生成中不能切换会话");
      return;
    }
    stickRef.current = true;
    setAtBottom(true);
    setState((prev) => ({ ...prev, activeId: id }));
  };

  const renameSession = (id: string, title: string) => {
    setState((prev) => ({
      ...prev,
      sessions: prev.sessions.map((session) => (session.id === id ? { ...session, title } : session)),
    }));
    toast.success("已重命名会话");
  };

  const deleteSession = (id: string) => {
    if (streaming) {
      toast.error("生成中不能删除会话");
      return;
    }
    setState((prev) => {
      const rest = prev.sessions.filter((session) => session.id !== id);
      const first = rest[0];
      if (!first) {
        const fresh = createSession();
        return { sessions: [fresh], activeId: fresh.id };
      }
      return { sessions: rest, activeId: prev.activeId === id ? first.id : prev.activeId };
    });
    toast.success("已删除会话");
  };

  const copySession = (session: PlaygroundSession) => {
    if (streaming) {
      toast.error("生成中不能复制会话");
      return;
    }
    const copy = duplicateSession(session);
    setState((prev) => ({
      sessions: [copy, ...prev.sessions].slice(0, MAX_PLAYGROUND_SESSIONS),
      activeId: copy.id,
    }));
    setDraft("");
    setAttachments([]);
    toast.success("已复制会话");
  };

  const retrySession = (session: PlaygroundSession) => {
    if (streaming) {
      toast.error("生成中不能重试");
      return;
    }
    const lastUser = [...session.messages].reverse().find((message) => message.role === "user");
    if (!lastUser) {
      toast.error("这个会话还没有用户消息");
      return;
    }
    const index = session.messages.indexOf(lastUser);
    setState((prev) => ({ ...prev, activeId: session.id }));
    stickRef.current = true;
    setAtBottom(true);
    void runTurn(session.id, session.messages.slice(0, index), lastUser);
  };

  const clearSession = () => {
    if (streaming) {
      toast.error("生成中不能清空会话");
      return;
    }
    patchSession(activeSession.id, (session) => ({ ...session, messages: [], title: "新会话" }));
    setDraft("");
    setAttachments([]);
    toast.success("已清空当前会话");
  };

  const exportSessions = () => {
    try {
      const blob = new Blob([serializeSessionFile(state.sessions)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = "slipstream-playground-" + new Date().toISOString().slice(0, 10) + ".json";
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
      toast.success("已导出全部会话");
    } catch {
      toast.error("导出失败");
    }
  };

  const importSessions = (file: File) => {
    if (streaming) {
      toast.error("生成中不能导入会话");
      return;
    }
    void (async () => {
      try {
        const parsed = parseSessionFile(await file.text());
        if (parsed.error) {
          toast.error("导入失败", { description: parsed.error });
          return;
        }
        setState((prev) => mergeImportedSessions(prev, parsed.sessions));
        toast.success("已导入 " + parsed.sessions.length + " 个会话");
      } catch {
        toast.error("导入失败", { description: "读取文件时出错" });
      }
    })();
  };

  const models = modelsQuery.data;
  const modelReady = Boolean(params.model);
  const thinkingLabel = REASONING_LEVEL_LABELS[params.thinkingMode];

  return (
    <div className="space-y-3">
      <PageHeader
        title="模型试验"
        description="用公开模型发起真实对话，验证参数与输出；会话只保存在本机浏览器。"
      />
      <div className="flex min-h-0 flex-col gap-3 lg:h-[calc(100vh-11rem)] lg:flex-row">
      <aside className="order-2 flex min-h-0 flex-col rounded-lg border border-border bg-surface p-2 lg:order-1 lg:w-60 lg:shrink-0">
        <SessionList
          sessions={state.sessions}
          activeId={activeSession.id}
          onSelect={selectSession}
          onNew={newSession}
          onRename={renameSession}
          onDelete={deleteSession}
          onCopy={copySession}
          onRetry={retrySession}
          onClear={clearSession}
          onExport={exportSessions}
          onImport={importSessions}
          busy={streaming}
        />
      </aside>

      <section className="order-1 flex min-h-[60vh] min-w-0 flex-1 flex-col overflow-hidden rounded-lg border border-border bg-surface lg:min-h-0">
        <div className="relative min-h-0 flex-1">
          <div ref={scrollRef} onScroll={handleScroll} className="h-full overflow-y-auto">
            {activeSession.messages.length === 0 ? (
              <ChatHero hasModel={modelReady} onPick={setDraft} />
            ) : (
              <MessageList
                messages={activeSession.messages}
                streamingId={streamingId}
                canSeeCost={canSeeCost}
                onRetryMessage={retryMessage}
                onDeleteMessage={deleteMessage}
              />
            )}
          </div>
          {!atBottom && activeSession.messages.length > 0 ? (
            <Button
              variant="outline"
              size="sm"
              className="absolute bottom-3 right-3 gap-1 shadow-md"
              onClick={scrollToBottom}
            >
              <ArrowDown className="h-3.5 w-3.5" />
              回到底部
            </Button>
          ) : null}
        </div>
        <Composer
          value={draft}
          onChange={setDraft}
          onSend={send}
          onStop={stop}
          onFiles={handleFiles}
          onRemoveAttachment={removeAttachment}
          attachments={attachments}
          streaming={streaming}
          disabled={!modelReady || streaming}
          modelReady={modelReady}
          model={params.model}
          thinkingLabel={thinkingLabel}
          summary={summarizeChatParams(params)}
          onOpenModels={() => setModelDialogOpen(true)}
        />
      </section>

      <aside className="order-3 flex min-h-0 flex-col lg:w-[24rem] lg:shrink-0 xl:w-[26rem]">
        <ParamsPanel
          value={params}
          onChange={setParams}
          disabled={streaming}
          mockMode={useMock}
          onOpenModels={() => setModelDialogOpen(true)}
          modelInfo={activeModelInfo}
        />
      </aside>

      <ModelDialog
        open={modelDialogOpen}
        onOpenChange={setModelDialogOpen}
        models={models}
        pending={modelsQuery.isPending}
        failed={modelsQuery.isError}
        onRetry={() => void modelsQuery.refetch()}
        value={params.model}
        onSelect={(name) => setParams((prev) => ({ ...prev, model: name }))}
        thinkingMode={params.thinkingMode}
        onThinkingModeChange={(mode) => setParams((prev) => ({ ...prev, thinkingMode: mode }))}
        modelInfo={activeModelInfo}
      />
      </div>
    </div>
  );
}
