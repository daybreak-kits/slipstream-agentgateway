/**
 * JSON 校验共用的「普通对象」判定（非 null、非数组）：价目文档与改写规则文档
 * 都按「顶层/字段必须是对象」校验，避免两套 codec 各写一份（W8 复审 judgement）。
 */
export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
