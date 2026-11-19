/**
 * 图表专用：金额/计数格式化统一上收 lib/format（单点实现），这里只保留
 * 图表时间轴标签等报表域知识；通用函数再导出，dashboard/billing 调用方引用不变。
 */
export { compactMoney, currencySymbol, fmtMoney, fmtMicroYuan } from "@/lib/format";

/** 时间桶标签：接口已按报表时区切桶并给出 label，这里只裁掉年份/秒。 */
export function shortBucketLabel(label: string, bucket: "hour" | "day"): string {
  if (!label) return "";
  if (label.includes(" ")) {
    const [, time] = label.split(" ");
    return (time ?? "").slice(0, 5);
  }
  if (bucket === "day") return label.length >= 10 ? label.slice(5) : label;
  return label;
}
