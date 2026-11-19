import type {
  FlowLink,
  FlowReport,
  HeatmapRange,
  HeatmapReport,
  LatencyReport,
  ReportTotals,
  ReportsOverview,
  RevisionLike,
  TimeseriesMember,
  TimeseriesPoint,
  TimeseriesReport,
  TrendDimension,
  TrendMetric,
} from "./report-types";
import type { TimeWindow } from "@/components/time-range-picker";

const ESTIMATE = "mock 数据：词元含缓存估算（阶段 B 待接入）";
const CURRENCY = "CNY";

/** 固定种子的线性同余，保证 mock 每次渲染数值一致，截图可复现。 */
function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

const HOUR = 3_600_000;
const DAY = 86_400_000;

const RANGE_BUCKETS: Record<Exclude<TimeWindow, { kind: "custom" }>["value"], number> = {
  today: 13,
  "24h": 24,
  "7d": 7,
  "30d": 30,
};

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function dayLabel(at: Date): string {
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`;
}

/** 与后端一致：today/24h 走小时桶，其余按天；自定义窗 ≤48h 小时桶否则天桶（后端 F auto 规则）。 */
function bucketsFor(window: TimeWindow): Array<{ startMs: number; label: string; bucket: "hour" | "day" }> {
  const now = Date.now();
  if (window.kind === "range") {
    const count = RANGE_BUCKETS[window.value];
    const bucket: "hour" | "day" = window.value === "today" || window.value === "24h" ? "hour" : "day";
    const step = bucket === "day" ? DAY : HOUR;
    const labels: Array<{ startMs: number; label: string; bucket: "hour" | "day" }> = [];
    for (let index = count - 1; index >= 0; index -= 1) {
      const at = new Date(now - index * step);
      const day = dayLabel(at);
      labels.push({
        startMs: at.getTime(),
        label: bucket === "day" ? day : `${day} ${pad(at.getHours())}:00`,
        bucket,
      });
    }
    return labels;
  }
  const span = window.toMs - window.fromMs;
  const bucket: "hour" | "day" = span <= 48 * HOUR ? "hour" : "day";
  const step = bucket === "day" ? DAY : HOUR;
  const labels: Array<{ startMs: number; label: string; bucket: "hour" | "day" }> = [];
  // 起点对齐到桶边界（天桶对齐 00:00，小时桶对齐整点），末端补一个正在进行的桶。
  const cursor = new Date(window.fromMs);
  if (bucket === "day") cursor.setHours(0, 0, 0, 0);
  else cursor.setMinutes(0, 0, 0);
  while (cursor.getTime() <= window.toMs) {
    const at = new Date(cursor);
    const day = dayLabel(at);
    labels.push({
      startMs: at.getTime(),
      label: bucket === "day" ? day : `${day} ${pad(at.getHours())}:00`,
      bucket,
    });
    cursor.setTime(cursor.getTime() + step);
  }
  if (labels.length === 0) {
    const at = new Date(window.fromMs);
    labels.push({ startMs: at.getTime(), label: dayLabel(at), bucket });
  }
  return labels;
}

const MEMBERS: Record<TrendDimension, Array<{ id: string; label: string }>> = {
  combo: [
    { id: "combo:glm-5.3@智谱", label: "glm-5.3 · 智谱" },
    { id: "combo:claude-sonnet-4.5@OpenRouter", label: "claude-sonnet-4.5 · OpenRouter" },
    { id: "combo:gpt-5.2@青岚云", label: "gpt-5.2 · 青岚云" },
    { id: "combo:qwen3-max@阿里云百炼", label: "qwen3-max · 阿里云百炼" },
    { id: "combo:deepseek-v3.2@火山方舟", label: "deepseek-v3.2 · 火山方舟" },
    { id: "combo:fast@智谱", label: "fast · 智谱" },
    { id: "combo:claude-haiku@OpenRouter", label: "claude-haiku · OpenRouter" },
  ],
  upstream: [
    { id: "umodel:glm-5.3", label: "glm-5.3" },
    { id: "umodel:claude-sonnet-4.5", label: "claude-sonnet-4.5" },
    { id: "umodel:gpt-5.2", label: "gpt-5.2" },
    { id: "umodel:qwen3-max", label: "qwen3-max" },
    { id: "umodel:deepseek-v3.2", label: "deepseek-v3.2" },
    { id: "umodel:glm-5.3-flash", label: "glm-5.3-flash" },
  ],
  channel: [
    { id: "channel:智谱", label: "智谱" },
    { id: "channel:OpenRouter", label: "OpenRouter" },
    { id: "channel:青岚云", label: "青岚云" },
    { id: "channel:阿里云百炼", label: "阿里云百炼" },
    { id: "channel:火山方舟", label: "火山方舟" },
  ],
};

function metricOf(metric: TrendMetric, weight: number, rand: () => number): number {
  const noise = 0.72 + rand() * 0.56;
  switch (metric) {
    case "requests":
      return Math.round(420 * weight * noise);
    case "tokens":
      return Math.round(268_000 * weight * noise);
    case "money":
      return Math.round(1_860_000 * weight * noise);
    default:
      return Math.round(420 * weight * noise);
  }
}

/** 词元拆分（GLOSSARY §5）：input 为折算口径（含缓存），入=input−cache、缓=cache_read+cache_write。 */
function tokenSplit(tokenTotal: number) {
  const output = Math.round(tokenTotal * 0.24);
  const input = tokenTotal - output;
  const cacheRead = Math.round(tokenTotal * 0.15);
  const cacheWrite = Math.round(tokenTotal * 0.05);
  return { input, output, cacheRead, cacheWrite };
}

/** mock 趋势：形状对齐 normalizeTimeseries 的规范形，members 按指标降序。 */
export function mockTimeseries(
  window: TimeWindow,
  dimension: TrendDimension,
  metric: TrendMetric,
): TimeseriesReport {
  const buckets = bucketsFor(window);
  const bucket = buckets[0]?.bucket ?? "day";
  const definitions = MEMBERS[dimension];
  const rand = seeded(dimension.length * 7919 + String(window.kind).length * 104_729 + metric.length * 6151);

  const perMember = definitions.map((member, index) => {
    const weight = 1 - index * 0.13;
    const requests = buckets.map(() => Math.max(1, metricOf("requests", weight, rand)));
    const tokens = buckets.map(() => metricOf("tokens", weight, rand));
    const cost = buckets.map(() => metricOf("money", weight, rand));
    const charge = cost.map((value) => Math.round(value * (1.42 + rand() * 0.18)));
    return { member, weight, requests, tokens, cost, charge };
  });

  const requestTotal = perMember.reduce((sum, entry) => sum + entry.requests.reduce((a, b) => a + b, 0), 0);
  const tokenTotal = perMember.reduce((sum, entry) => sum + entry.tokens.reduce((a, b) => a + b, 0), 0);
  const costTotal = perMember.reduce((sum, entry) => sum + entry.cost.reduce((a, b) => a + b, 0), 0);
  const chargeTotal = perMember.reduce((sum, entry) => sum + entry.charge.reduce((a, b) => a + b, 0), 0);
  const cacheSplit = tokenSplit(tokenTotal);
  const windowMinutes = Math.max(1, Math.round((buckets[buckets.length - 1]!.startMs - buckets[0]!.startMs) / 60_000) + (bucket === "hour" ? 60 : 1440));

  const members: TimeseriesMember[] = perMember.map((entry) => {
    const mTokens = entry.tokens.reduce((a, b) => a + b, 0);
    const mRequests = entry.requests.reduce((a, b) => a + b, 0);
    const mCost = entry.cost.reduce((a, b) => a + b, 0);
    const mCharge = entry.charge.reduce((a, b) => a + b, 0);
    const split = tokenSplit(mTokens);
    return {
      id: entry.member.id,
      label: entry.member.label,
      total: metric === "money" ? mCost : metric === "tokens" ? mTokens : mRequests,
      share: 0,
      requests: mRequests,
      input_tokens: split.input,
      output_tokens: split.output,
      tokens: mTokens,
      cost_micro: mCost,
      charge_micro: mCharge,
      totals: metric === "money" ? { cost_micro: mCost, charge_micro: mCharge } : undefined,
    };
  });
  const metricTotal = members.reduce((sum, member) => sum + member.total, 0);
  for (const member of members) member.share = metricTotal > 0 ? member.total / metricTotal : 0;
  members.sort((left, right) => right.total - left.total);

  const points: TimeseriesPoint[] = buckets.map((slot, index) => {
    const values: Record<string, number> = {};
    let cost = 0;
    let charge = 0;
    let total = 0;
    for (const entry of perMember) {
      const mTokens = entry.tokens[index] ?? 0;
      values[entry.member.id] =
        metric === "money" ? entry.cost[index] ?? 0 : metric === "tokens" ? mTokens : entry.requests[index] ?? 0;
      cost += entry.cost[index] ?? 0;
      charge += entry.charge[index] ?? 0;
      total += values[entry.member.id] ?? 0;
    }
    return metric === "money"
      ? { bucket_start_ms: slot.startMs, label: slot.label, total, values: {}, cost_micro: cost, charge_micro: charge }
      : { bucket_start_ms: slot.startMs, label: slot.label, total, values };
  });

  const activeMinutesTotal = Math.min(windowMinutes, Math.max(1, Math.round(requestTotal / 11)));
  const totals: ReportTotals = {
    requests: requestTotal,
    input_tokens: cacheSplit.input,
    output_tokens: cacheSplit.output,
    tokens: tokenTotal,
    error_count: Math.round(requestTotal * 0.021),
    active_minutes: activeMinutesTotal,
    // 单分钟峰值（GLOSSARY §5 最高峰）：取均值的 1.8–3 倍，mock 形状合理即可
    peak_rpm: Math.max(
      1,
      Math.round((requestTotal / Math.max(1, activeMinutesTotal)) * (1.8 + rand() * 1.2)),
    ),
    peak_tpm: Math.max(
      1,
      Math.round((tokenTotal / Math.max(1, activeMinutesTotal)) * (1.8 + rand() * 1.2)),
    ),
    cache_read_tokens: cacheSplit.cacheRead,
    cache_write_tokens: cacheSplit.cacheWrite,
    cost_micro: costTotal,
    charge_micro: chargeTotal,
  };

  return {
    range: window.kind === "custom" ? "custom" : window.value,
    bucket,
    dimension,
    metric,
    from_ms: points[0]?.bucket_start_ms ?? Date.now(),
    to_ms: window.kind === "custom" ? window.toMs : Date.now(),
    timezone: "Asia/Shanghai",
    currency: CURRENCY,
    points,
    members,
    totals,
    metric_total: metricTotal,
    folded_members: 0,
    fx_missing: [],
    estimate_note: ESTIMATE,
  };
}

export function mockLatency(window: TimeWindow): LatencyReport {
  const seed = window.kind === "custom" ? Math.round(window.fromMs / DAY) : window.value.length * 4517;
  const rand = seeded(seed);
  const jitter = 0.8 + rand() * 0.5;
  const block = (p50: number, p75: number, p95: number, p99: number) => ({
    samples: 17_820,
    p50_ms: Math.round(p50 * jitter),
    p75_ms: Math.round(p75 * jitter),
    p95_ms: Math.round(p95 * jitter),
    p99_ms: Math.round(p99 * jitter),
  });
  return {
    range: window.kind === "custom" ? "custom" : window.value,
    paired_samples: 17_820,
    min_samples: 5,
    ttft: block(231, 348, 512, 890),
    total: block(642, 1_180, 2_140, 3_980),
    timezone: "Asia/Shanghai",
    currency: CURRENCY,
    estimate_note: ESTIMATE,
  };
}

const HEATMAP_MODE: Record<HeatmapRange, { mode: "weekday_hour" | "date_hour"; days: number }> = {
  "7d": { mode: "weekday_hour", days: 7 },
  "30d": { mode: "date_hour", days: 30 },
  "365d": { mode: "date_hour", days: 365 },
};

/** mock 热力图：7D 按星期×小时，30D/365D 按日期×小时，空格子保持 0。 */
export function mockHeatmap(range: HeatmapRange, metric: "tokens" | "cost" | "spend"): HeatmapReport {
  const config = HEATMAP_MODE[range];
  const rand = seeded(range.length * 3137 + metric.length * 977);
  const weekday = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];
  const base = metric === "tokens" ? 42_000 : metric === "cost" ? 420_000 : 690_000;
  const now = new Date();
  const rows = Array.from({ length: config.days }, (_unused, index) => {
    const at = new Date(now.getTime() - (config.days - 1 - index) * DAY);
    const key = dayLabel(at);
    const values = Array.from({ length: 24 }, (_slot, hour) => {
      // 凌晨低、白天高，零星空格子模拟无请求时段
      if (rand() < 0.08) return 0;
      const curve = 0.35 + Math.sin(((hour - 4) / 24) * Math.PI) * 0.85;
      return Math.round(base * curve * (0.6 + rand() * 0.8));
    });
    return {
      key: config.mode === "weekday_hour" ? String(index + 1) : key,
      label: config.mode === "weekday_hour" ? (weekday[index] ?? key) : config.days <= 30 ? key.slice(5) : key,
      values,
    };
  });
  const max = rows.reduce((peak, row) => Math.max(peak, ...row.values), 0);
  return {
    range,
    mode: config.mode,
    metric: metric === "cost" ? "cost_micro" : metric === "spend" ? "charge_micro" : "tokens",
    from_ms: now.getTime() - config.days * DAY,
    to_ms: now.getTime(),
    timezone: "Asia/Shanghai",
    currency: CURRENCY,
    columns: Array.from({ length: 24 }, (_unused, hour) => ({ key: String(hour), label: pad(hour) })),
    rows,
    max,
    total: rows.reduce((sum, row) => sum + row.values.reduce((inner, value) => inner + value, 0), 0),
    fx_missing: [],
    estimate_note: ESTIMATE,
  };
}

const FLOW_USERS = ["user:alice", "user:bob", "user:carol"];
const FLOW_KEYS = ["key:sk-a1", "key:sk-b2", "key:sk-c3"];
const FLOW_MODELS = ["model:glm", "model:fast", "model:claude"];
const FLOW_UMODELS = ["umodel:glm-5.3", "umodel:claude-sonnet-4.5", "umodel:gpt-5.2", "umodel:qwen3-max"];
const FLOW_CHANNELS = ["channel:智谱", "channel:OpenRouter", "channel:青岚云"];

/** mock 分流：五段 用户 → 连接密钥 → 公开模型 → 上游模型 → 上游渠道。 */
export function mockFlow(metric: "requests" | "tokens"): FlowReport {
  const rand = seeded(metric.length * 20261117);
  const links: FlowLink[] = [];
  const node_meta: FlowReport["node_meta"] = {};
  const values = new Map<string, number>();

  const label = (id: string): string => id.slice(id.indexOf(":") + 1);
  const stageOf = (id: string): FlowReport["node_meta"][string]["stage"] => {
    if (id.startsWith("user:")) return "user";
    if (id.startsWith("key:")) return "key";
    if (id.startsWith("model:")) return "model";
    if (id.startsWith("umodel:")) return "umodel";
    return "channel";
  };
  const register = (id: string) => {
    if (!node_meta[id]) node_meta[id] = { id, label: label(id), stage: stageOf(id), value: 0 };
  };
  const push = (source: string, target: string, requests: number) => {
    const tokens = Math.round(requests * (620 + rand() * 260));
    const value = metric === "tokens" ? tokens : requests;
    register(source);
    register(target);
    values.set(source, (values.get(source) ?? 0) + value);
    values.set(target, (values.get(target) ?? 0) + value);
    links.push({ source, target, requests, tokens, value });
  };

  FLOW_USERS.forEach((user, index) =>
    push(user, FLOW_KEYS[index % FLOW_KEYS.length] ?? "key:sk-a1", Math.round(240 + rand() * 420)),
  );
  const weights = [0.42, 0.33, 0.25];
  FLOW_KEYS.forEach((key, keyIndex) =>
    FLOW_MODELS.forEach((model, modelIndex) => {
      const weight = weights[modelIndex] ?? 0.2;
      push(key, model, Math.round((520 + keyIndex * 90) * weight));
    }),
  );
  // 每个公开模型显式挂到上游模型：漏挂的节点在桑基图里会孤立到第 0 列（红点），
  // 所以这里必须覆盖 FLOW_UMODELS 的全部四项。
  const MODEL_TO_UMODELS: Record<string, string[]> = {
    "model:glm": ["umodel:glm-5.3"],
    "model:fast": ["umodel:qwen3-max"],
    "model:claude": ["umodel:claude-sonnet-4.5", "umodel:gpt-5.2"],
  };
  FLOW_MODELS.forEach((model) => {
    for (const target of MODEL_TO_UMODELS[model] ?? [FLOW_UMODELS[0] ?? "umodel:glm-5.3"]) {
      push(model, target, Math.round(260 + rand() * 220));
    }
  });
  FLOW_UMODELS.forEach((model, index) => {
    const target = FLOW_CHANNELS[index % FLOW_CHANNELS.length] ?? FLOW_CHANNELS[0];
    if (target) push(model, target, Math.round(160 + rand() * 180));
  });

  for (const [id, meta] of Object.entries(node_meta)) {
    meta.value = values.get(id) ?? 0;
  }

  const totals = {
    requests: links.filter((link) => link.source.startsWith("user:")).reduce((sum, link) => sum + link.requests, 0),
    tokens: links.filter((link) => link.source.startsWith("user:")).reduce((sum, link) => sum + link.tokens, 0),
    cost_micro: 62_400_000,
    charge_micro: 96_800_000,
  };

  return {
    metric,
    nodes: Object.keys(node_meta),
    node_meta,
    links,
    stages: [
      { id: "user", label: "用户" },
      { id: "key", label: "连接密钥" },
      { id: "model", label: "公开模型" },
      { id: "umodel", label: "上游模型" },
      { id: "channel", label: "上游渠道" },
    ],
    totals,
    currency: CURRENCY,
    fx_missing: [],
    estimate_note: ESTIMATE,
  };
}

export function mockOverview(): ReportsOverview {
  const cost = 62_400_000;
  const charge = 96_800_000;
  return {
    requests: 18_642,
    error_count: 391,
    active_minutes: 1_386,
    input_tokens: 2_846_000,
    output_tokens: 918_000,
    cache_read_tokens: 427_000,
    cache_write_tokens: 142_000,
    charge_micro: charge,
    cost_micro: cost,
    margin_micro: charge - cost,
    currency: CURRENCY,
    fx_missing: [],
    money_scope: "converted",
    latency_p50_ms: 642,
    latency_p95_ms: 2_140,
    ttft_p50_ms: 231,
    latency: {
      paired_samples: 17_820,
      min_samples: 5,
      ttft: { samples: 17_820, p50_ms: 231, p75_ms: 348, p95_ms: 512, p99_ms: 890 },
      total: { samples: 17_820, p50_ms: 642, p75_ms: 1_180, p95_ms: 2_140, p99_ms: 3_980 },
    },
    estimate_note: ESTIMATE,
  };
}

export function mockRevisions(): RevisionLike[] {
  const now = Date.now();
  return [
    { id: "rev_104", artifact_hash: "9f2c41d7ab0e", adapter_id: "agentgateway", operator: "alice", reason: "新增公开模型 fast", status: "active", created_at_ms: now - 42 * 60_000 },
    { id: "rev_103", artifact_hash: "5b81ce90d224", adapter_id: "agentgateway", operator: "bob", reason: "上游 zai-01 换密钥", status: "superseded", created_at_ms: now - 5 * 3_600_000 },
    { id: "rev_102", artifact_hash: "31d0a77bc9f5", adapter_id: "agentgateway", operator: "alice", reason: "调整 priority 1→2", status: "superseded", created_at_ms: now - 27 * 3_600_000 },
  ];
}
