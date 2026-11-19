# W4-B 看板 8 卡与图表三修（含后端分钟峰值）

规范依据：DESIGN-AUDIT「四期增补」§8/§11/§14；GLOSSARY §5 RPM/TPM 口径。

## 范围

### 后端（api/src）
1. `l05_service/aggregates.py`：timeseries totals 增加 **peak_rpm / peak_tpm**——窗口内单分钟峰值：`GROUP BY (本地毫秒)/60000` 后取 COUNT/SUM 的 MAX，一次 SQL 聚合（ADR-022 合规，不进 Python 循环）；分钟键口径与 active_minutes 的本地时区表达式保持一致；测试：构造已知分布断言峰值（如某分钟 10 请求 → peak_rpm=10.0? 峰值单位=次/分与词元/分，整数值即可）。
2. `l06_api/routers_reports.py` + 契约：timeseries 响应 totals 带两新键；`python ops/contract/gen_ts.py` 重生成 web/src/generated/contract.ts 并提交。

### 前端（web/src）
3. `components/dashboard/metric-cards.tsx`：
   - **修均价单位 bug**：`avgPerMillion = charge/totalTokens`（charge 是 micro，与"每百万词元"恰好相消，**删掉 ×1_000_000**）；¥2,658,543.95 → ¥2.66（fmtFixed 2 位）。
   - **只拆不加（用户定案）**：词元卡拆出「缓存」卡（主数=缓存词元 fmtCount，底行=缓存命中率 xx.xx%，复用 logs/format 的 cacheHitFraction 公式与 fmtPct；无缓存显示「无缓存」）；速度卡拆成 RPM 卡与 TPM 卡（主数=均值=请求÷活跃分钟 / 词元÷活跃分钟，fmtFixed 2 位；底行=RPM 卡「活跃 N 分钟 · 最高峰 x.xx」，TPM 卡「最高峰 x.xx 词元/分」；峰值取 totals.peak_rpm/peak_tpm，字段缺位时降级"—"）。
   - 其余卡片（请求量/费用/成本·毛利率/P50）**一律不动**；8 卡按每行 6 铺开（`grid-cols-6` 响应式降档 6→4→3→2；xl 起 6 列），权限裁剪逻辑保持。
4. `components/dashboard/heatmap.tsx`：30D/365D 改**聚合行**——30D 按周（约 5 行，行标签如「11/17–11/23」）、365D 按月（12 行，标签如「11月」）；每格=该周/月在此小时的合计，tooltip 注明聚合口径与覆盖日期；7D 保持星期×小时；**外框 FRAME_HEIGHT=352 不变、零滚动**（行数≤12 时行高自适应铺满，去掉虚拟化在聚合模式下不再需要）；前端分组即可（date_hour 行数据已在手），不动后端。
5. `components/dashboard/flow-chart.tsx`：**桑基跨接**——隐藏段不再整条删链路：迭代式 splice（对每个隐藏段，入边×出边两两拼新边、值/请求数/词元/金额合并，重复 (a,b) 对求和），直到图中不含隐藏段；隐藏两段以上也正确（用户截图的"图分成上下两块"是本 bug 的可见症状）；tooltip 的新合成边显示合并值。

## 验收
后端 pytest（新增峰值/聚合测试）EXIT=0；gen_ts --check 通过；前端 tsc/eslint/build/ui-foundation 全绿；浏览器冒烟：看板 8 卡两行布局截图、切 RPM/TPM 卡峰值有值、热力图 30D/365D 无滚动条（352px 内完整显示）、桑基隐藏「公开模型」后仍为连通单图（用户→连接密钥→上游模型→上游）。commit：`api(web)(w4-b): 看板8卡+分钟峰值+热力图聚合+桑基跨接`（api/web 若需分域提交可拆两笔，但 contract.ts 必须与后端同笔或紧随）。
