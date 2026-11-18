import {
  PLAYGROUND_HISTORY_KEY,
  parsePlaygroundHistory,
  serializePlaygroundHistory,
  type PlaygroundMessage,
} from "@/lib/playground";

/** 一个会话：全部内容只存在浏览器本地，切换/重命名/清空都不经过后端。 */
export interface PlaygroundSession {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: PlaygroundMessage[];
}

export interface SessionState {
  sessions: PlaygroundSession[];
  activeId: string;
}

/** 存储键与 lib 侧常量共用一处，避免两处字符串漂移。 */
export const PLAYGROUND_SESSIONS_KEY = PLAYGROUND_HISTORY_KEY;

/** 只保留最近若干会话，防止 localStorage 越用越大（ticket 15：200 条）。 */
export const MAX_PLAYGROUND_SESSIONS = 200;

export function newSessionId(): string {
  return "ps-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 6);
}

function newMessageId(): string {
  return "pm-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 7);
}

export function createSession(title = "新会话"): PlaygroundSession {
  const now = Date.now();
  return { id: newSessionId(), title, createdAt: now, updatedAt: now, messages: [] };
}

/** 复制会话：新 id + 新消息 id，标题带「副本」，不共享流式临时状态。 */
export function duplicateSession(session: PlaygroundSession): PlaygroundSession {
  const now = Date.now();
  return {
    id: newSessionId(),
    title: session.title + " 副本",
    createdAt: now,
    updatedAt: now,
    messages: session.messages.map((message) => ({
      ...message,
      id: newMessageId(),
      streaming: false,
    })),
  };
}

/** 会话标题：取第一条用户消息，超长截断；没有消息就叫「新会话」。 */
export function deriveSessionTitle(messages: PlaygroundMessage[]): string {
  const first = messages.find((message) => message.role === "user" && message.content.trim());
  if (!first) return "新会话";
  const text = first.content.replace(/\s+/g, " ").trim();
  return text.length > 20 ? text.slice(0, 20) + "…" : text;
}

function toSession(value: unknown): PlaygroundSession | null {
  if (typeof value !== "object" || value === null) return null;
  const row = value as {
    id?: unknown;
    title?: unknown;
    createdAt?: unknown;
    updatedAt?: unknown;
    messages?: unknown;
  };
  if (typeof row.id !== "string" || typeof row.title !== "string") return null;
  const messages = Array.isArray(row.messages)
    ? parsePlaygroundHistory(JSON.stringify(row.messages))
    : [];
  const createdAt = typeof row.createdAt === "number" ? row.createdAt : Date.now();
  return {
    id: row.id,
    title: row.title || deriveSessionTitle(messages),
    createdAt,
    updatedAt: typeof row.updatedAt === "number" ? row.updatedAt : createdAt,
    messages,
  };
}

/** 读本地会话；坏数据整段丢弃，至少保证有一个可用的空会话。 */
export function loadSessionState(): SessionState {
  const fallback = (): SessionState => {
    const session = createSession();
    return { sessions: [session], activeId: session.id };
  };
  if (typeof window === "undefined") return fallback();
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(PLAYGROUND_SESSIONS_KEY);
  } catch {
    return fallback();
  }
  if (!raw) return fallback();
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return fallback();
    const data = parsed as { sessions?: unknown; activeId?: unknown };
    const rows = Array.isArray(data.sessions) ? data.sessions : [];
    const sessions = rows
      .map(toSession)
      .filter((row): row is PlaygroundSession => row !== null)
      .slice(0, MAX_PLAYGROUND_SESSIONS);
    const firstSession = sessions[0];
    if (!firstSession) return fallback();
    const wanted = typeof data.activeId === "string" ? data.activeId : "";
    const activeId = sessions.some((row) => row.id === wanted) ? wanted : firstSession.id;
    return { sessions, activeId };
  } catch {
    return fallback();
  }
}

/** 落盘：临时流式状态清掉，单会话消息数与总会话数都按上限截断。 */
export function saveSessionState(state: SessionState): void {
  if (typeof window === "undefined") return;
  const sessions = [...state.sessions]
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, MAX_PLAYGROUND_SESSIONS)
    .map((session) => ({
      ...session,
      messages: JSON.parse(serializePlaygroundHistory(session.messages)) as PlaygroundMessage[],
    }));
  try {
    window.localStorage.setItem(
      PLAYGROUND_SESSIONS_KEY,
      JSON.stringify({ sessions, activeId: state.activeId }),
    );
  } catch {
    // 配额满或隐私模式下写不进去：界面照常可用，只是刷新后不保留。
  }
}

/** 导出文件：带版本与导出时间，导入端只认 sessions 数组。 */
export function serializeSessionFile(sessions: PlaygroundSession[]): string {
  return JSON.stringify(
    {
      version: 1,
      exportedAt: new Date().toISOString(),
      sessions: sessions.slice(0, MAX_PLAYGROUND_SESSIONS).map((session) => ({
        ...session,
        messages: JSON.parse(serializePlaygroundHistory(session.messages)) as PlaygroundMessage[],
      })),
    },
    null,
    2,
  );
}

export interface SessionFileParseResult {
  sessions: PlaygroundSession[];
  error: string | null;
}

/** 导入文件：接受导出信封或裸数组；坏行丢弃，整份不可用才报错。 */
export function parseSessionFile(raw: string): SessionFileParseResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { sessions: [], error: "不是合法的 JSON 文件。" };
  }
  let rows: unknown[] | null = null;
  if (Array.isArray(parsed)) {
    rows = parsed;
  } else if (typeof parsed === "object" && parsed !== null) {
    const data = parsed as { sessions?: unknown };
    if (Array.isArray(data.sessions)) rows = data.sessions;
  }
  if (!rows) return { sessions: [], error: "文件里没有 sessions 数组。" };
  const sessions = rows
    .map(toSession)
    .filter((row): row is PlaygroundSession => row !== null)
    .slice(0, MAX_PLAYGROUND_SESSIONS);
  if (sessions.length === 0) return { sessions: [], error: "没有找到可导入的会话。" };
  return { sessions, error: null };
}

/** 合并导入：id 冲突就换新 id，导入的会话排在前面并选中第一个。 */
export function mergeImportedSessions(
  current: SessionState,
  imported: PlaygroundSession[],
): SessionState {
  const ids = new Set(current.sessions.map((session) => session.id));
  const now = Date.now();
  const added = imported.map((session, index) => {
    let id = session.id;
    if (ids.has(id)) id = newSessionId();
    ids.add(id);
    return {
      ...session,
      id,
      title: session.title || "导入的会话",
      updatedAt: now - index,
      messages: session.messages.map((message) => ({ ...message, streaming: false })),
    };
  });
  const sessions = [...added, ...current.sessions].slice(0, MAX_PLAYGROUND_SESSIONS);
  const first = sessions[0];
  return { sessions, activeId: first ? first.id : current.activeId };
}

/** 会话列表按最近更新排序。 */
export function sortSessions(sessions: PlaygroundSession[]): PlaygroundSession[] {
  return [...sessions].sort((a, b) => b.updatedAt - a.updatedAt);
}
