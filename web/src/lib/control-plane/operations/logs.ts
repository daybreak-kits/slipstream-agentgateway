/**
 * 使用日志域的 typed operations（W4 票04）：日志列表 / 详情 / 正文 / 路由链 / query 语法帮助。
 *
 * 筛选条件用领域参数对象表达，query 串与端点路径由适配器负责；响应类型是手写领域
 * 类型（后端这些路由返回 dict，未声明 response_model），attempts/query-syntax 用生成契约。
 */

import type { LogAttemptsOut, LogQuerySyntaxOut } from "@/generated/contract";
import type { LogDetail, LogListResponse, LogPayload } from "@/components/logs/types";

import type { OperationOptions } from "../types";

/** 日志列表筛选与分页（字段语义见 routers_ops.search_logs）。 */
export interface LogListQuery {
  query: string;
  pageSize: number;
  offset: number;
  sort: string;
  order: string;
  fromMs?: number;
  toMs?: number;
  hasError?: boolean;
}

export interface LogsOperations {
  list(query: LogListQuery, options?: OperationOptions): Promise<LogListResponse>;
  detail(eventId: string, options?: OperationOptions): Promise<LogDetail>;
  payload(eventId: string, options?: OperationOptions): Promise<LogPayload>;
  attempts(eventId: string, options?: OperationOptions): Promise<LogAttemptsOut>;
  querySyntax(options?: OperationOptions): Promise<LogQuerySyntaxOut>;
}
