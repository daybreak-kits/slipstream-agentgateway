/**
 * 使用日志域的内存实现（W4 票04）：筛选/排序/分页复用 fixtures.queryMockLogs，
 * 详情与路由链复用 mockLogs / mockAttempts；错误同样是统一 ApiError。
 */

import type { LogQuerySyntaxOut } from "@/generated/contract";
import type { LogDetail, LogPayload } from "@/components/logs/types";

import { ApiError } from "./errors";
import * as fixtures from "./memory/fixtures";
import type { LogListQuery, LogsOperations } from "./operations/logs";

function paramsOf(query: LogListQuery): URLSearchParams {
  const params = new URLSearchParams({
    query: query.query,
    page_size: String(query.pageSize),
    offset: String(query.offset),
    sort: query.sort,
    order: query.order,
  });
  if (query.fromMs !== undefined) params.set("from_ms", String(query.fromMs));
  if (query.toMs !== undefined) params.set("to_ms", String(query.toMs));
  if (query.hasError !== undefined) params.set("has_error", String(query.hasError));
  return params;
}

function requireLog(eventId: string): LogDetail {
  const row = fixtures.mockLogs.find((item) => item.event_id === eventId);
  if (!row) throw new ApiError(404, "not_found", "日志不存在：" + eventId);
  return structuredClone(row);
}

export function createMemoryLogs(): LogsOperations {
  return {
    list: async (query) => {
      const page = fixtures.queryMockLogs(paramsOf(query));
      return { total: page.total, items: page.items, next_offset: page.next_offset };
    },
    detail: async (eventId) => requireLog(eventId),
    payload: async (eventId) => {
      const row = requireLog(eventId);
      if (!row.has_payload) {
        throw new ApiError(404, "not_found", "该请求未记录正文（或正文留存已关闭）");
      }
      const payload: LogPayload = {
        event_id: row.event_id,
        request_prompt_json: JSON.stringify({
          model: row.requested_model || row.public_model,
          messages: [{ role: "user", content: "演示请求：请用一句话说明这条日志的用途。" }],
          temperature: 0.7,
        }),
        response_completion_json: JSON.stringify({
          id: "chatcmpl_mock_" + row.event_id,
          choices: [{ index: 0, message: { role: "assistant", content: "演示响应正文（mock 数据，不代表真实模型输出）。" } }],
        }),
      };
      return payload;
    },
    attempts: async (eventId) => {
      const row = requireLog(eventId);
      const detail = fixtures.mockAttempts[row.correlation_key];
      if (!detail) return { event_id: eventId, correlation_key: "", attempts: [] };
      return { ...structuredClone(detail), event_id: eventId };
    },
    querySyntax: async (): Promise<LogQuerySyntaxOut> => ({
      tokens: [
        { token: "model:<子串>", meaning: "按公开模型或上游模型名过滤", example: "model:glm-5.3" },
        { token: "upstream:<子串>", meaning: "按上游名称或上游模型过滤", example: "upstream:zai" },
        { token: "user:<子串>", meaning: "按用户 id 或名称过滤", example: "user:u1" },
        { token: "key:<子串>", meaning: "按连接密钥备注过滤", example: "key:prod" },
        { token: "status<op><值>", meaning: "按 HTTP 状态过滤（:=、>、<、>=、<=）", example: "status>=400" },
        { token: "stream:true", meaning: "只保留流式请求", example: "stream:true" },
        { token: "latency<op><毫秒>", meaning: "按总耗时过滤", example: "latency>3000" },
        { token: "ttft<op><毫秒>", meaning: "按首字耗时过滤", example: "ttft>500" },
        { token: "cache<op><百分数>", meaning: "按缓存命中率过滤", example: "cache>50" },
      ],
    }),
  };
}
