"""Response models for the dashboard report endpoints (ticket 03).

The five v2 report routes and the /admin/overview alias declare these models as
their ``response_model``; ops/contract/gen_ts.py renders them into
web/src/generated/contract.ts, so the dashboard compiles against the same wire
shape the backend validates.

Money fields (cost_micro / charge_micro / margin_micro) are declared with a 0
default even though the routes always compute them: the money-visibility
middleware deletes those keys for callers without billing:cost / billing:spend
(field_filter.py), so presence is permission-dependent and the generated
TypeScript marks them optional. They must never be nullable - a hidden amount is
an absent key, not null (docs/api-contract.md §0.5).

The shape rules are pinned by api/tests/integration/test_reports_contract.py and
web/src/generated/contract.ts; the latency blocks keep null quantiles below
MIN_PERCENTILE_SAMPLES (aggregates.py) because "样本不足" is a real state there.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel

# Window echo values: preset range keys (aggregates.RANGE_KEYS) plus the two
# synthetic echoes an explicit millisecond window / an all-time request produce.
ReportRange = Literal["today", "24h", "7d", "30d", "365d", "custom"]
FlowReportRange = Literal["today", "24h", "7d", "30d", "365d", "custom", "all"]
HeatmapReportRange = Literal["7d", "30d", "365d", "custom"]
# Canonical metric names the routes echo back (aggregates._METRIC_FIELDS); the
# user-facing aliases (cost/spend/token) never reach the wire.
ReportMetric = Literal[
    "requests", "tokens", "input_tokens", "output_tokens", "cost_micro", "charge_micro"
]
ReportDimension = Literal["combo", "upstream", "channel"]
ReportBucket = Literal["hour", "day"]
HeatmapMetric = Literal["tokens", "cost_micro", "charge_micro"]


class LatencyBlockOut(BaseModel):
    """配对样本分位块（ttft>0 且 duration>0）；样本不足 5 条时各分位为 None。"""

    samples: int
    p50_ms: int | None
    p75_ms: int | None
    p95_ms: int | None
    p99_ms: int | None


class AllSamplesBlockOut(BaseModel):
    """全样本分位块（W4-F）：不过滤 ttft>0 配对，只回 p50/p75/p95。"""

    samples: int
    p50_ms: int | None
    p75_ms: int | None
    p95_ms: int | None


class AllSamplesLatencyOut(BaseModel):
    """all 口径：同一窗口内全部事件的 TTFT / 总耗时。"""

    samples: int
    ttft: AllSamplesBlockOut
    total: AllSamplesBlockOut


class LatencyStatsOut(BaseModel):
    """overview 内嵌的延迟块（与 /latency 同口径，不含窗口回显字段）。"""

    paired_samples: int
    min_samples: int
    ttft: LatencyBlockOut
    total: LatencyBlockOut
    all: AllSamplesLatencyOut


class ReportsOverviewOut(BaseModel):
    """GET /admin/reports/overview 响应（/admin/overview 别名同形）。"""

    requests: int
    error_count: int
    active_minutes: int
    input_tokens: int
    output_tokens: int
    cache_read_tokens: int
    cache_write_tokens: int
    # Money: present only with billing:spend / billing:cost - absence, not null.
    charge_micro: int = 0
    cost_micro: int = 0
    margin_micro: int = 0
    currency: str
    money_scope: Literal["converted", "report_currency_only"]
    fx_missing: list[str]
    latency_p50_ms: int
    latency_p95_ms: int
    ttft_p50_ms: int
    latency: LatencyStatsOut
    estimate_note: str


class LatencyReportOut(BaseModel):
    """GET /admin/reports/latency 响应（W4-F：配对块 + all 全样本块）。"""

    range: FlowReportRange
    from_ms: int
    to_ms: int
    timezone: str
    paired_samples: int
    min_samples: int
    ttft: LatencyBlockOut
    total: LatencyBlockOut
    all: AllSamplesLatencyOut
    estimate_note: str


class ReportTotalsOut(BaseModel):
    """timeseries totals：无论请求哪些指标都带齐全部键，形状稳定。"""

    requests: int
    input_tokens: int
    output_tokens: int
    cache_read_tokens: int
    cache_write_tokens: int
    tokens: int
    cost_micro: int = 0
    charge_micro: int = 0
    error_count: int
    active_minutes: int
    peak_rpm: int
    peak_tpm: int


class TimeseriesMemberOut(BaseModel):
    """timeseries 成员合计；多指标请求时 totals 才出现（单指标缺省，不是 null）。"""

    id: str
    label: str
    total: int
    share: float
    requests: int
    tokens: int
    cost_micro: int = 0
    charge_micro: int = 0
    totals: dict[str, int] | None = None


class TimeseriesPointOut(BaseModel):
    """一个桶：单指标 values 为 {memberId: value}，双指标为 {memberId: {metric: value}}。"""

    bucket_start_ms: int
    label: str
    total: int
    values: dict[str, int] | dict[str, dict[str, int]]


class TimeseriesReportOut(BaseModel):
    """GET /admin/reports/timeseries 响应（前端 normalizeTimeseries 的输入）。"""

    range: ReportRange
    bucket: ReportBucket
    dimension: ReportDimension
    metric: ReportMetric
    metrics: list[ReportMetric]
    from_ms: int
    to_ms: int
    timezone: str
    currency: str
    points: list[TimeseriesPointOut]
    members: list[TimeseriesMemberOut]
    totals: ReportTotalsOut
    metric_total: int
    folded_members: int
    fx_missing: list[str]
    estimate_note: str


class HeatmapColumnOut(BaseModel):
    """热力图列：一小时一列（key=0..23）。"""

    key: str
    label: str


class HeatmapRowOut(BaseModel):
    """热力图行：7d 为星期、30d/365d 为日期，values 恒为 24 格。"""

    key: str
    label: str
    values: list[int]


class HeatmapReportOut(BaseModel):
    """GET /admin/reports/heatmap 响应。"""

    range: HeatmapReportRange
    mode: Literal["weekday_hour", "date_hour"]
    metric: HeatmapMetric
    from_ms: int
    to_ms: int
    timezone: str
    currency: str
    columns: list[HeatmapColumnOut]
    rows: list[HeatmapRowOut]
    max: int
    total: int
    fx_missing: list[str]
    estimate_note: str


class FlowStageOut(BaseModel):
    """GET /admin/reports/flow：一个可见阶段（collapse 后只含剩余段）。"""

    id: str
    label: str


class FlowNodeMetaOut(BaseModel):
    """flow 节点元数据：稳定 id + 展示名 + 所属阶段 + 指标值（窗口口径）。"""

    id: str
    label: str
    stage: Literal["user", "key", "model", "upstream", "channel"]
    value: int


class FlowLinkOut(BaseModel):
    """flow 边：相邻可见段之间的聚合值；charge 锚首边、cost 锚末边。"""

    source: str
    target: str
    requests: int
    tokens: int
    cost_micro: int = 0
    charge_micro: int = 0
    value: int


class FlowTotalsOut(BaseModel):
    """flow totals：恒等于窗口全量（不随 collapse/focus/q/top_n 变化）。"""

    requests: int
    tokens: int
    cost_micro: int = 0
    charge_micro: int = 0


class FlowReportOut(BaseModel):
    """GET /admin/reports/flow 响应（W6 票 17 进契约；顶层键序即线格式键序）。"""

    metric: Literal["requests", "tokens"]
    nodes: list[str]
    node_meta: dict[str, FlowNodeMetaOut]
    links: list[FlowLinkOut]
    stages: list[FlowStageOut]
    totals: FlowTotalsOut
    currency: str
    fx_missing: list[str]
    estimate_note: str
    range: FlowReportRange
    from_ms: int
    to_ms: int
    timezone: str
