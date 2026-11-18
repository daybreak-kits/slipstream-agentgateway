# 计费：上游成本与下游收费是两本账

- 状态：定稿（2026-11-17 用户裁定：运营成本与用户开销必须分开）
- 关联：ADR-005（不做影子对账）、ADR-007（预付余额）、ADR-010（P0 实测）

## 1. 一句话

**一个请求产生两条互不影响的金额记录**：我们付给厂商的**成本**，和从用户余额扣的**收费**。两本账各有自己的价格表、自己的表、自己的报表，绝不合并计算。

## 2. 为什么必须分开

| | 成本（Cost） | 收费（Charge） |
|---|---|---|
| 谁付给谁 | 我们 → 厂商 | 用户 → 我们 |
| 依据 | 厂商价目表 | 我们自定价目表 |
| 变动原因 | 厂商调价、模型变价 | 促销、倍率调整、客户协议价 |
| 用途 | 运营成本、毛利分析 | 扣余额、欠费停机 |
| 能否为零 | 可以（赠送、内部额度） | 可以（免费模型） |

合并成一列会导致三个问题：改价时历史毛利算错、无法回答「这个用户赚不赚钱」、无法解释「为什么扣了他 3 毛而我只花了 2 毛」。

## 3. 数据链路

```
AG request_logs（请求级事实：tokens、实际模型、状态）
      │  增量拉取（游标 started_at + id，幂等）
      ▼
gateway_usage_events（不可变事实，event_id 唯一）
      ├──> cost_entries    ← 按上游价目表算钱
      │        └──> cost_daily（按厂商/模型/天聚合）
      └──> charge_entries  ← 按下游价目表算钱
               └──> ledger_entries（扣用户余额）
                        └──> user_daily（按用户/天聚合）
毛利 = charge_entries.amount - cost_entries.amount
```

## 4. 表结构

### 4.1 两张独立的价目表

`upstream_prices(vendor_id, upstream_model, item, unit_price_micro, currency, effective_from, version)`
- `item` ∈ `input` / `output` / `cache_read` / `cache_write` / `request`
- 单价单位：**每 1M tokens 的百万分之一币**（整数），或 `per_request` 按次

`charge_prices(public_model_id, item, mode, value, currency, effective_from, version)`（v1 默认 `mode=markup`、`value=10000` 即 1.0 倍，管理员可改）
- `mode = markup`：`value` 是倍率（如 12000 = 1.2 倍，万分数避免浮点）
- `mode = fixed`：`value` 是单价（同上游单位）

### 4.2 两张结果表

`cost_entries`：`id, gateway_event_id, vendor_id, upstream_model_id, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, amount_micro, currency, price_version_id, status(ok|unpriced), created_at`

`charge_entries`：`id, gateway_event_id, user_id, api_key_id, public_model_id, input_tokens, output_tokens, amount_micro, currency, price_version_id, status(ok|unpriced|free), created_at`

`ledger_entries`：`id, user_id, kind(charge|topup|refund|adjust), delta_micro, balance_after_micro, currency, ref_type, ref_id, note, created_by, created_at`

## 5. 金额规则

1. **一律整数微单位**（micro = 1e-6 币），数据库 `INTEGER`；**禁止 float / 禁止 FLOAT 列**。
2. 每条金额记录必须带 `currency`；不同币种不直接相加。
3. 折算到报表基准币（CNY）时用 `fx_snapshots(currency, rate_micro, as_of, source)`，手工维护，不做实时汇率。
4. 每条账必须带 `price_version_id`；**改价不重算历史**。
5. 单请求四舍五入到微单位；**聚合在取整之后**，避免单请求多次取整累积误差。
6. **未定价不写 0**：缺价目时记 `status=unpriced`、金额 NULL，进入「待补价」列表；不允许静默记 0（那等于白送）。

## 6. 计费口径

- 只对 `http_status = 200` 且 `total_tokens ≥ 0` 的请求计费；失败请求成本记 0 但要保留 token 数（厂商是否收费以账单为准，月末对账修正）。
- 缓存命中：AG 日志能否区分 `cache_read` / `cache_write` 尚未证实（E6 只确认 input/output/total），阶段 B 核对完整 26 列；取不到时按「全部计为 input」保守计算，并在报表标注估算。
- 流式请求与普通请求同价；`ttft/tpot` 只做性能分析，不参与计费。

## 7. 前端呈现（必须分栏）

- 侧栏拆两项：**成本（运营）** 与 **营收（用户）**，不要合成一个「用量」页。
- 总览加一张「毛利」卡：今日成本 / 今日收费 / 毛利 / 毛利率。
- 请求明细表固定两列：`成本` 与 `收费`，悬停显示 tokens 拆分与价格版本。
- 两张价目表页面独立：上游价目、下游价目；改价需走「新版本」而不是原地改。
- 「待补价」列表独立展示，可一键给某模型补价并重算（重算只写 cost/charge，不重复写 usage event）。

## 8. 价格与默认参数复用旧系统实现（用户裁定）

- **价格**：沿用旧仓 `api/src/l05_service/billing.py` + `catalog.py` + `aggregates.py` 的模型与算法（按模型存输入/输出单价，逐请求计算，聚合按天）。不要另起一套价格体系。
- **模型默认参数**：沿用旧仓 `l05_service/model_defaults/`（`model_defaults_match.py` / `model_defaults_merge.py` / `model_defaults_rules.py`）与 `l03_domain/model_defaults_*.py` 的匹配、合并、规则逻辑。
- 移植时保持字段语义与计算顺序一致，只在最外层换表名与命名（snake_case 统一）。
