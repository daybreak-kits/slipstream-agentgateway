/**
 * 12 位随机密码生成（ADR-019 密码策略：大小写 + 数字 + 符号）。
 * 用于「重置密码」：后端 PUT /admin/users/{id}/password 要求调用方提交新密码
 * 且不回显，因此由前端生成、展示一次。crypto.getRandomValues 拒绝采样避免模偏差。
 */
const UPPER = "ABCDEFGHJKLMNPQRSTUVWXYZ";
const LOWER = "abcdefghijkmnopqrstuvwxyz";
const DIGIT = "23456789";
const SYMBOL = "!@#$%^&*-_=+";
const ALL = UPPER + LOWER + DIGIT + SYMBOL;

function randomIndex(bound: number): number {
  const buffer = new Uint32Array(1);
  const limit = Math.floor(0xffffffff / bound) * bound;
  let value = 0;
  do {
    crypto.getRandomValues(buffer);
    value = buffer[0];
  } while (value >= limit);
  return value % bound;
}

function pick(source: string): string {
  return source[randomIndex(source.length)];
}

export function generatePassword(length = 12): string {
  // 每类至少一个，其余从全集随机取，最后 Fisher–Yates 打乱
  const chars = [pick(UPPER), pick(LOWER), pick(DIGIT), pick(SYMBOL)];
  for (let i = chars.length; i < length; i += 1) chars.push(pick(ALL));
  for (let i = chars.length - 1; i > 0; i -= 1) {
    const j = randomIndex(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join("");
}
