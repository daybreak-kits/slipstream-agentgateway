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
  const limit = Math.floor(0x1_0000_0000 / bound) * bound;
  for (;;) {
    crypto.getRandomValues(buffer);
    const value: number = buffer[0] ?? 0;
    if (value < limit) return value % bound;
  }
}

function pick(source: string): string {
  return source.charAt(randomIndex(source.length));
}

export function generatePassword(length = 12): string {
  // 每类至少一个：先把全集填满，再把保证位放到随机位置（避免 Fisher–Yates 的索引读数）
  const chars: string[] = [];
  for (let i = 0; i < length; i += 1) chars.push(pick(ALL));
  const required: string[] = [pick(UPPER), pick(LOWER), pick(DIGIT), pick(SYMBOL)];
  const positions = new Set<number>();
  while (positions.size < required.length) positions.add(randomIndex(length));
  let slot = 0;
  for (const position of positions) {
    chars[position] = required[slot] ?? pick(ALL);
    slot += 1;
  }
  return chars.join("");
}
