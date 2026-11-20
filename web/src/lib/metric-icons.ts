import {
  Activity,
  Boxes,
  CircleAlert,
  CircleDollarSign,
  Database,
  Gauge,
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
  Zap,
  type LucideIcon,
} from "lucide-react";

import type { IconTone } from "@/components/ui/icon-badge";

/**
 * 指标卡的图标与分类色单一来源（ticket 22 / W5 ticket 10）。
 *
 * 图标形状本身就是语义编码：活动=请求、层=词元、数据库=缓存、收据=费用、
 * 钱币=成本、仪表=延迟分位、计时器=请求速率、闪电=词元吞吐。八张 KPI 卡
 * 形状互不相同，配合文字标签形成「形状 + 颜色/文字」双编码，不只靠颜色区分。
 *
 * 配色只取 ui/icon-badge 的轻盈分类 tint（--badge-*-bg/fg：浅色 wash + 深色主题
 * 独立亮度），不再所有卡共用 primary，也不把状态语义色（info/success/warning）
 * 借给指标：请求/速率=flow、词元/吞吐=token、缓存=cache、费用/成本=cost、
 * 延迟=latency、毛利率/成本=brand。tone 只表达「哪一类账」，不表达好坏。
 */
export type MetricTone = IconTone;

export interface MetricVisual {
  icon: LucideIcon;
  tone: MetricTone;
}

export const METRIC_ICONS = {
  /** 请求量 / 流水条数 */
  requests: { icon: Activity, tone: "flow" },
  /** 请求速率（次 / 分钟） */
  rpm: { icon: Timer, tone: "flow" },
  /** 词元用量（输入 + 输出） */
  tokens: { icon: Layers, tone: "token" },
  /** 词元速率（词元 / 分钟） */
  tpm: { icon: Zap, tone: "token" },
  /** 缓存命中量 / 命中率（存储复用语义，不用闪电/速度图标） */
  cache: { icon: Database, tone: "cache" },
  /** 对外花费（charge 账） */
  charge: { icon: Receipt, tone: "cost" },
  /** 上游成本（cost 账） */
  cost: { icon: CircleDollarSign, tone: "brand" },
  /** 毛利 / 毛利率 */
  margin: { icon: TrendingUp, tone: "brand" },
  /** 延迟分位（P50/P95 用仪表；Timer 留给冷却/速率语义） */
  latency: { icon: Gauge, tone: "latency" },
  /** 错误 / 5xx */
  errors: { icon: TriangleAlert, tone: "error" },
  /** 待补价流水 */
  unpriced: { icon: CircleAlert, tone: "cost" },
  /** 可用率 */
  availability: { icon: ShieldCheck, tone: "latency" },
  /** 上游实例 */
  upstreams: { icon: Server, tone: "brand" },
  /** 模型数 */
  models: { icon: Boxes, tone: "token" },
  /** 用户数 */
  users: { icon: Users, tone: "flow" },
  /** 连接密钥 */
  keys: { icon: KeyRound, tone: "cost" },
  /** 接口风格 */
  apiStyle: { icon: Plug, tone: "neutral" },
} as const satisfies Record<string, MetricVisual>;

export type MetricKey = keyof typeof METRIC_ICONS;
