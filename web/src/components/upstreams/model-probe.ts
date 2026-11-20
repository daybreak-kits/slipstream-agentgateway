/** 模型探测（POST /admin/upstreams/{id}/models/probe，W5 ticket 05/07）的会话状态与纯逻辑。
 *
 *  - 结果只在本页会话内保存，不写库（后端明确不持久化）；
 *  - 串行逐模型发起一次请求：进度可见、可中止（AbortController 透传 api）、>20 个模型也不失控；
 *  - 失败行的错误信息来自后端已截断脱敏的 message，前端只负责按语义色展示。
 *  展示组件在同目录 model-probe-view.tsx（保持 react-refresh 的文件职责）。 */

import { useCallback, useEffect, useRef, useState } from "react";

import { api, ApiError, ENDPOINTS } from "@/lib/api";

/** 后端 probe 单项：{model_id, model, ok, status, latency_ms, error_type, message}。 */
export interface ModelProbeItem {
  model_id: string;
  model: string;
  ok: boolean;
  status: number;
  latency_ms: number;
  /** "" | "http" | "timeout" | "connection" */
  error_type: string;
  /** 后端截断 + 脱敏后的一行说明 */
  message: string;
}

export interface ModelProbeResponse {
  upstream_id: string;
  key_id: string;
  items: ModelProbeItem[];
}

/** 单模型请求的超时上限：后端每个模型 20s，留出控制面余量。 */
export const MODEL_PROBE_REQUEST_TIMEOUT_MS = 25_000;

export interface ModelProbeSession {
  /** "" = 默认（第一把密钥）；否则为选中的密钥行 id。 */
  keyId: string;
  running: boolean;
  total: number;
  done: number;
  currentModelId: string | null;
  /** model_id → 本次会话的探测结果 */
  results: Record<string, ModelProbeItem>;
  cancelled: boolean;
  /** 批次级错误（权限/网络等非单模型失败） */
  error: string;
}

export function emptyProbeSession(): ModelProbeSession {
  return {
    keyId: "",
    running: false,
    total: 0,
    done: 0,
    currentModelId: null,
    results: {},
    cancelled: false,
    error: "",
  };
}

export type ModelProbeAction =
  /** reset=false 时保留本次会话既有结果（单模型「测试」只更新一行；「全部测试」整体重测）。 */
  | { type: "start"; total: number; keyId: string; reset?: boolean }
  | { type: "begin"; modelId: string }
  | { type: "item"; item: ModelProbeItem }
  | { type: "finish"; cancelled?: boolean }
  | { type: "error"; message: string }
  | { type: "reset" };

export function probeReducer(state: ModelProbeSession, action: ModelProbeAction): ModelProbeSession {
  switch (action.type) {
    case "start":
      return {
        ...emptyProbeSession(),
        results: action.reset === false ? state.results : {},
        keyId: action.keyId,
        total: action.total,
        running: action.total > 0,
      };
    case "begin":
      return state.running ? { ...state, currentModelId: action.modelId } : state;
    case "item": {
      const results = { ...state.results, [action.item.model_id]: action.item };
      return {
        ...state,
        results,
        done: state.done + 1,
        currentModelId: null,
      };
    }
    case "finish":
      return { ...state, running: false, currentModelId: null, cancelled: action.cancelled === true };
    case "error":
      return { ...state, running: false, currentModelId: null, error: action.message };
    case "reset":
      return emptyProbeSession();
  }
}

export interface ModelProbeResultView {
  label: string;
  tone: "success" | "warning" | "danger";
  latencyText: string;
  detail: string;
}

/** 单项结果 → 徽章文案/语义色/延迟/脱敏错误行。 */
export function probeResultView(item: ModelProbeItem): ModelProbeResultView {
  const latencyText = item.latency_ms > 0 ? item.latency_ms + " ms" : "";
  const detail = (item.message ?? "").trim();
  if (item.ok) return { label: "连通", tone: "success", latencyText, detail: "" };
  if (item.error_type === "timeout") return { label: "超时", tone: "warning", latencyText, detail };
  if (item.error_type === "connection") return { label: "连接失败", tone: "danger", latencyText, detail };
  return { label: "失败", tone: "danger", latencyText, detail };
}

export interface ModelProbeSummary {
  total: number;
  done: number;
  ok: number;
  failed: number;
  percent: number;
}

export function probeSummary(session: ModelProbeSession): ModelProbeSummary {
  const items = Object.values(session.results);
  const ok = items.filter((item) => item.ok).length;
  return {
    total: session.total,
    done: session.done,
    ok,
    failed: items.length - ok,
    percent: session.total > 0 ? Math.round((session.done / session.total) * 100) : 0,
  };
}

/** 批次级错误的人话说明（api.ts 已统一 toast，这里只给行内摘要）。 */
export function probeErrorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  const message = error instanceof Error ? error.message : String(error);
  return message.trim() === "" ? "测试请求失败" : message;
}

export interface ModelProbeTarget {
  id: string;
  name: string;
}

export interface ModelProbeController {
  session: ModelProbeSession;
  /** "" = 默认第一把密钥 */
  keyId: string;
  setKeyId: (value: string) => void;
  running: boolean;
  run: (targets: ModelProbeTarget[]) => void;
  cancel: () => void;
  clear: () => void;
}

/** 会话内模型探测：串行逐模型请求，进度/中止/清空；切换页签不丢（状态挂在详情页）。 */
export function useModelProbe(upstreamId: string): ModelProbeController {
  const [session, setSession] = useState<ModelProbeSession>(emptyProbeSession);
  const [keyId, setKeyId] = useState("");
  const abortRef = useRef<AbortController | null>(null);
  const runningRef = useRef(false);

  const run = useCallback(
    (targets: ModelProbeTarget[]) => {
      if (upstreamId === "" || targets.length === 0) return;
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      runningRef.current = true;
      // 「全部测试」整批重测；行内单模型「测试」只更新该行，保留本次会话其他结果。
      setSession((prev) => probeReducer(prev, { type: "start", total: targets.length, keyId, reset: targets.length > 1 }));
      void (async () => {
        for (const target of targets) {
          if (controller.signal.aborted) break;
          setSession((prev) => probeReducer(prev, { type: "begin", modelId: target.id }));
          try {
            const body: { model_ids: string[]; key_id?: string } = { model_ids: [target.id] };
            if (keyId !== "") body.key_id = keyId;
            const result = await api.post<ModelProbeResponse>(
              ENDPOINTS.upstreamModelsProbe(upstreamId),
              body,
              { signal: controller.signal, timeoutMs: MODEL_PROBE_REQUEST_TIMEOUT_MS },
            );
            const item = result.items[0];
            if (item) setSession((prev) => probeReducer(prev, { type: "item", item }));
          } catch (error) {
            // 用户中止：静默退出；其余批次级错误（权限/网络）保留摘要并停止。
            if (controller.signal.aborted) break;
            setSession((prev) => probeReducer(prev, { type: "error", message: probeErrorMessage(error) }));
            break;
          }
        }
        runningRef.current = false;
        setSession((prev) => probeReducer(prev, { type: "finish", cancelled: controller.signal.aborted }));
      })();
    },
    [upstreamId, keyId],
  );

  const cancel = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  // 离开页面时中止在途的串行探测，避免后台请求继续占用连接。
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  const clear = useCallback(() => {
    if (runningRef.current) return;
    setSession(emptyProbeSession());
  }, []);

  return { session, keyId, setKeyId, running: session.running, run, cancel, clear };
}
