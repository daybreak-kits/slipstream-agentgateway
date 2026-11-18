/** 用户 / 账本接口给的是毫秒时间戳；统一按本地时区展示到秒。 */
export function fmtMs(ms: number | null | undefined): string {
  if (!ms) return "—";
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    d.getFullYear() +
    "-" +
    pad(d.getMonth() + 1) +
    "-" +
    pad(d.getDate()) +
    " " +
    pad(d.getHours()) +
    ":" +
    pad(d.getMinutes()) +
    ":" +
    pad(d.getSeconds())
  );
}

/** ISO 字符串（旧 mock / 部分只读字段）折成毫秒；解析失败给 undefined。 */
export function isoMs(iso: string | null | undefined): number | undefined {
  if (!iso) return undefined;
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? undefined : ms;
}

/** 金额一律整数 micro（1 元 = 1_000_000 micro），展示统一折成元、保留两位小数。 */
export function fmtYuan(micro: number): string {
  return "¥" + (micro / 1_000_000).toFixed(2);
}

/** 输入框按“元”收，落库前转 micro；最多 6 位小数（1 micro 精度）。 */
export function parseYuanToMicro(input: string): number | null {
  const text = input.replace(/[,，\s]/g, "").replace(/^¥/, "");
  if (!/^\d+(\.\d{1,6})?$/.test(text)) return null;
  const micro = Math.round(Number(text) * 1_000_000);
  if (!Number.isFinite(micro) || micro <= 0) return null;
  return micro;
}

/** 0 元也合法的场景（如初始余额），单独放开下界。 */
export function parseYuanToMicroAllowZero(input: string): number | null {
  const text = input.replace(/[,，\s]/g, "").replace(/^¥/, "");
  if (text === "" || text === "0") return 0;
  return parseYuanToMicro(text);
}

/** 金额输入框回填：micro -> 元（两位小数足够人工编辑）。 */
export function yuanInput(micro: number): string {
  return (micro / 1_000_000).toFixed(2);
}

/** 账本变动：正数带 +，负数带 −（真减号，配合 .tnum 对齐）。 */
export function fmtSignedMicro(delta: number): string {
  if (delta === 0) return "¥0.00";
  return (delta > 0 ? "+" : "−") + "¥" + (Math.abs(delta) / 1_000_000).toFixed(2);
}
