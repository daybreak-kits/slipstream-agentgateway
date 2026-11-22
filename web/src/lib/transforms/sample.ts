/**
 * 样例测试的粘贴输入解析：头按 Name: Value 行、体按 JSON。解析失败必须带行号/字段
 * 标签回显给用户，不能静默丢数据；这里只做输入形状转换，规则应用在后端（同一 codec）。
 */

export interface HeaderLinesResult {
  /** 头名归一为小写（HTTP 头名大小写不敏感），值保留原样。 */
  headers: Record<string, string>;
  /** 首个格式错误；null 表示整段可解析。 */
  error: string | null;
}

export function parseHeaderLines(text: string): HeaderLinesResult {
  const headers: Record<string, string> = {};
  let error: string | null = null;
  const lines = text.split(/\r?\n/);
  lines.forEach((rawLine, index) => {
    const line = rawLine.trim();
    if (!line) return;
    const colon = line.indexOf(":");
    if (colon < 0) {
      error = error ?? "第 " + String(index + 1) + " 行缺少冒号（应为 Name: Value）";
      return;
    }
    const name = line.slice(0, colon).trim();
    if (!name) {
      error = error ?? "第 " + String(index + 1) + " 行缺少头名称";
      return;
    }
    if (error) return;
    headers[name.toLowerCase()] = line.slice(colon + 1).trim();
  });
  return { headers, error };
}

export interface JsonSampleResult {
  value: unknown;
  error: string | null;
}

/** body 为空表示没有 body（null）；其余必须是合法 JSON。 */
export function parseJsonSample(text: string, label: string): JsonSampleResult {
  if (!text.trim()) return { value: null, error: null };
  try {
    return { value: JSON.parse(text) as unknown, error: null };
  } catch (error) {
    return {
      value: null,
      error: label + " JSON 解析失败：" + (error instanceof Error ? error.message : String(error)),
    };
  }
}

/** 字段 diff 的值展示：缺失用中文占位，字符串不加引号，其余走 JSON。 */
export function formatSampleValue(value: unknown): string {
  if (value === null || value === undefined) return "（无）";
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}
