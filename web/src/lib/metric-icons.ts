import {
  Activity,
  Boxes,
  CircleAlert,
  KeyRound,
  Layers,
  Plug,
  Receipt,
  Server,
  ShieldCheck,
  Timer,
  TrendingUp,
  TriangleAlert,
  Users,
  Wallet,
  Zap,
  type LucideIcon,
} from "lucide-react";

/**
 * 指标卡的图标与语义色单一来源（ticket 22）。
 *
 * 页面只从这里取 icon/tone，不要在页面里各写一套 glyph 与配色：
 * 同一个指标在 overview / dashboard / cost / revenue 里必须是同一个图标与同一种语义色。
 * tone 只表达「哪一类账」，不表达好坏；好坏由页面的 tone 覆盖（如毛利率为负时传 danger）。
 */
export type MetricTone = "primary" | "success" | "warning" | "danger" | "info" | "neutral";

export interface MetricVisual {
  icon: LucideIcon;
  tone: MetricTone;
}

export const METRIC_ICONS = {
  /** 请求量 / 流水条数 */
  requests: { icon: Activity, tone: "primary" },
  /** 词元用量（输入 + 输出） */
  tokens: { icon: Layers, tone: "primary" },
  /** 上游成本（cost 账） */
  cost: { icon: Wallet, tone: "warning" },
  /** 对外花费（charge 账） */
  charge: { icon: Receipt, tone: "success" },
  /** 毛利 / 毛利率 */
  margin: { icon: TrendingUp, tone: "success" },
  /** 延迟分位 */
  latency: { icon: Timer, tone: "info" },
  /** 缓存命中 */
  cache: { icon: Zap, tone: "info" },
  /** 错误 / 5xx */
  errors: { icon: TriangleAlert, tone: "danger" },
  /** 待补价流水 */
  unpriced: { icon: CircleAlert, tone: "warning" },
  /** 可用率 */
  availability: { icon: ShieldCheck, tone: "success" },
  /** 上游实例 */
  upstreams: { icon: Server, tone: "primary" },
  /** 模型数 */
  models: { icon: Boxes, tone: "primary" },
  /** 用户数 */
  users: { icon: Users, tone: "info" },
  /** 连接密钥 */
  keys: { icon: KeyRound, tone: "info" },
  /** 接口风格 */
  apiStyle: { icon: Plug, tone: "info" },
} as const satisfies Record<string, MetricVisual>;

export type MetricKey = keyof typeof METRIC_ICONS;
