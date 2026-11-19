# W4-F 日志页：分位语义色耗时列

规范依据：DESIGN-AUDIT §11（语义色=分位数锚定：≤P50 绿、P50–P95 黄（P75 黄锚）、>P95 红）。

## 后端（api/src）
1. `l05_service/aggregates.py`：latency_report 增加**全样本分位块** `all`（不过滤 ttft>0 配对，duration_ms 与 time_to_first_token_ms 各一套 p50/p75/p95；现 paired 块原样保留，老消费方不受影响）；样本不足回 null（沿用 MIN_PERCENTILE_SAMPLES 规则）。
2. `l06_api/routers_reports.py`：`/admin/reports/latency` 允许 **缺省 from_ms/to_ms（=全时段）**——现在成对必填 422，改为都缺省时全时段（日志页窗口可缺省，两端点口径对齐）；有任一则仍要求成对。契约同步 + gen_ts 重生成 + pytest（新块/缺省窗口/配对块回归）EXIT=0。

## 前端（web/src）
3. `pages/logs.tsx`：与 /admin/logs 同窗口**并发**请求 latency（日志窗口缺省时不传 from/to）；取 `all.total`（耗时）与 `all.ttft`（首字）分位。
4. 耗时列单元格改**竖色条 + 标签 + 数值**两行（DESIGN-AUDIT §5 语义色条 pattern）：
   - `首字 x.xxs` / `耗时 x.xxs`，字号一致（text-2xs），标签写明「首字」「耗时」；竖条 3px 圆角。
   - 颜色：值 ≤p50 → success 绿；≤p95 → warning 黄（p75 为黄区锚点，不引入第四色）；>p95 → danger 红；分位 null（样本不足）或值缺失/0 → 中性灰。色阶判定抽成 `components/logs/latency-tone.ts` 纯函数（可测）并留注释说明口径随窗口动态。
5. 词元/费用列不动（fmtMoney6 六位保持）；「未设置」价格标注归 C 波（models.tsx），本票不碰。

## 验收
后端 pytest EXIT=0 + gen_ts --check；前端五门禁绿；浏览器冒烟（mock 或生产）：日志行耗时列两行带色条、快行绿慢行红、样本不足中性；tooltip/title 说明「按当前窗口分位动态着色」；截图贴回报。commit：`api(web)(w4-f): 日志分位语义色——全样本分位块+窗口缺省+耗时竖色条`。
