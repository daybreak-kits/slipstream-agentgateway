import { ApiError } from "@/lib/api";

/**
 * API 错误的可读文案（DESIGN-AUDIT 三期规范 §4：API 错误统一 describeApiError）。
 * 后端 message 本身已是中文可读（如「仍有 N 个用户使用该角色，无法删除」）；
 * 校验类错误把 details.errors 逐行拼上，避免只看到笼统的「参数错误」。
 *
 * 位置说明：DESIGN-AUDIT 把它归在 lib，但本工单 lib/** 禁碰，先落在本目录，
 * 后续工位可原样挪入 lib/format 或 lib/api。
 */
export function describeApiError(error: unknown): string {
  if (error instanceof ApiError) {
    const lines = error.errorLines();
    return lines.length > 0 ? error.message + "：" + lines.join("；") : error.message;
  }
  if (error instanceof Error) return error.message;
  return String(error);
}
