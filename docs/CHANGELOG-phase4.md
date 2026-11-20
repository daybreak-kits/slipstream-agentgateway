# 四期变更记录（2026-11-19 ~ 11-20）

第四轮 UI 核对驱动的集中改造：规范落档、ADR-025/026、14 张实施/实验工票、终局全站门禁与视觉检查。本文只记「变了什么」，决策依据见 `docs/DECISIONS.md`（ADR-025/026 及 ADR-024 修正注记），设计规范见 `docs/DESIGN-AUDIT.md` 四期各节。

## 规范与决策

- **DESIGN-AUDIT 四期规范**：表格四条（表头点击排序/头身对齐一致+操作列冻结右侧/大表表体内部滚动/分页规划含 sr-only 红线）、看板两行×每行 6 卡响应式（只拆不加）、表格撑满页底+最小高度、列设置强制、语义色=分位数锚定（≤P50 绿/P75 黄锚/P95 红）、lucide 图标映射表、**操作显隐一律查 RBAC 权限键**。
- **ADR-025**：可用性措施（冷却两种模式）只归属上游模型；公开模型仅 启用/关闭。
- **ADR-026**：多密钥平权——每把上游密钥展开为一个独立 AG 上游（`{model}#k{seq}` 别名 + virtualModel 同层 targets，E18 裁决形态）；**废除主密钥**（is_primary/镜像/轮换全部退役）；空上游非法（创建 422 + 删空 409，匿名探测分支随之移除）。
- **ADR-024 修正注记**：路由链可视化由「永久砍定」修正为「**可经 OTel Traces 实现，列 M5 待立项**」（E19：`frontendPolicies.tracing` → 每次上游尝试一个 client span，request_logs.trace_id 可 join；本批不含）。

## 修复与改造（工票 → 提交）

| 票 | 提交 | 内容 |
|---|---|---|
| A1 | 4fdb813 | 表格基建壳层：**分页 sr-only 逃逸 ICB 修复**（全站窗口滚动空白事故根因）、表体内部滚动（撑满页底+min-h-80）、头身对齐镜像、列设置强制+缺 storageKey 告警、lib/icons 图标单一来源、logs/upstreams/models/models-panel 接入；顺手修 stableColumnRenderer 可见列下标错位与列设置菜单不可勾回两个既有缺陷 |
| A2+M | 6e37ff6 / dfa2d8e | 扫尾重映射销号（图标/对齐/空表头「操作」/语义色）+ 弹窗守卫补尾；**mock 契约对齐**（网关策略三端点 shape、/admin/connection、角色 CRUD mock） |
| B | 7feedec / 0ec7849 | 看板 8 卡（只拆不加）：**均价单位修复**（¥2,658,543.95 → 元级正确值）、缓存卡（命中率）、RPM/TPM 双卡带**分钟峰值**（后端一条 SQL GROUP BY 分钟取 MAX）；热力图 30D 按周/365D 按月（352 定框零滚动）；桑基隐藏段跨接 splice（隐藏后仍连通单图） |
| C | c2a0a09 | 冷却双模式弹窗（单次 1/3/6/12/24/72h 预设 + 周期紧凑编辑）；公开模型整页编辑器 `/models/public/:id`（Tab1 基本信息+策略 / Tab2 双栏成员编排）；上游模型编辑器三处归一；价格 2 位（<0.01 升 4 位）+ 未设置标注 |
| D | 8f000c2 / 6c1676d | **多密钥平权落地**：密钥展开 N 上游（E18 形态）、禁同名渲染自检、去 is_primary/镜像/轮换、逐把测试（失效标红）+批量删除、迁移 CLI；名称解锁（后端 ADR-023 改名路径本就支持）、keys-panel 重做、页签琥珀圆点、匿名分支删除 |
| D2 | 17c981a / 5c0b60c | **E20 缺陷修正**：conditional targets 不做密钥展开（E20：同谓词 first-match 首条独占 40:0）、兜底不变量收紧为 AG 真实约束（至多 1 条无 when 且必须末位）、成员编排 conditional×多密钥提示行 |
| E | 830ba64 | 用户管理单页合并（双页签删除，控制台徽章仅标识）、**操作显隐一律查权限键**、角色 roles:write 门禁+内置只读摘要、顶栏用户菜单（设置/改密/主题写服务端偏好/退出）、全局搜索加用户/角色、routes.json 重生成、停用→关闭 |
| F | 099e858 / 9b8409b | 延迟 **all 全样本分位块**（非流式计入）+ latency 窗口缺省=全时段；日志耗时列**分位语义色竖条**（首字/耗时两行，随窗口动态） |
| G | 4cee010 | TransformsEditor 主从重构（左栏四段+计数/规则折叠定位）；**use-dirty-guard 全站铺开**（含新建上游 dirty 恒 false 漏洞修复、切页签纳入、弹窗草稿 onOpenChange 咽喉阻断）；确认校准（保存并下发摘要确认、价目导入覆盖数确认、匿名确认删除） |
| H | 811b54e / c065c49 | **models.dev 集成**：快照表+每日 job+手动同步、只填空兑入（手改永不覆盖，USD→CNY 按 fx_snapshots 换算、无汇率 skip）、params_source 来源标记；**GET /admin/my/models** 代理用户模型参数（零金额键）；演练场参数展示 |
| I | ce123fb | 死代码清理：孤儿 15 文件（-1765 行）、术语剩尾；批量改价双实现评估归后续 |

## 实验（E18-E20，三张全中要害）

- **E18**：同名 `llm.models` 多条 validate 静默通过但运行时首条独占（60:0）→ 渲染必须 `#kN` 别名；同 baseUrl 多 key 组内 failover 与跨 upstream 一致。
- **E19**：路由链数据源裁决——**OTel Traces 可行**（frontendPolicies.tracing → 每尝试一 client span + trace_id join request_logs），列 M5 待立项；accessLog upstreamCalls 1.7 失效；agctl 不存在。
- **E20**：conditional × 多密钥 = **first-match 塌缩 + 兜底多条 validate 拒收** → D2 渲染修正 + validation 收紧；conditional 模式密钥级容错为零（产品语义受限，UI 有提示）。

## 新基线

- api：`python -m pytest` **704 passed / 8 skipped**（三期收官 671 → +33）；EXIT 码为准。
- web：tsc / eslint / build / check-bundle（首包 gzip 210.8KB）/ check-ui-foundation（37/37）/ 术语 strict（error 0）全绿；verify_web 3/3。
- 终局视觉检查：20+ 路由 × 两视口（1333×643 / 1999×965）**窗口级溢出全部为 0**（①事故修复全域验证），控制台零错误。

## M5 路由链（2026-11-20 追加立项并落地）

- **M5-a**（645aa0c，30 文件 +1897）：OTLP/HTTP 接收器（标准库 wire-format 解码器移植自 E19，零新依赖，l03 层）+ `trace_spans` 表（复合主键幂等，(trace_id,start_ms) 索引）+ `gateway_usage_events.trace_id` 补链（此前丢弃）+ `GET /admin/traces/{trace_id}`（attempts 按 start 复原）+ tracing 渲染（`frontendPolicies.tracing`，E19 形状 golden）+ 留存清理只删 span；**735 passed / 8 skipped EXIT=0**。
- **M5-b**（1ac3a1f，6 文件 +569）：策略页「链路追踪」卡（启用/接收地址/采样，说明文案）+ 日志详情「路由链」时间线（每轮上游/状态码语义色/耗时/错误类型，根 span 汇总 retry.attempt 与总耗时；无 trace 不渲染）+ mock 两轮样例。
- 冒烟：策略卡回显 ✓、路由链三轮（503→500→200 failover）红/绿语义色渲染 ✓（截图 web/.scratch/m5-b-trace-chain.png）；`trace_id` 缺失行不渲染该区。

## 已知边界与遗留（按优先级）

1. **M5 路由链（待立项）**：OTel 接收器 + trace_id join + 日志详情链路展示；量产需采样策略。
2. conditional × 多密钥为受限组合（E20/D2 已限流+提示）；`llm.*` 变量类谓词未实测。
3. 按上游密钥的用量归因不可得（request_logs 只记最终上游）；usage provider 列现带 `#kN` 后缀，按名匹配退化为首匹配（既有近似）。
4. 密钥删除/迁移后的 stale `keys/*.key` 文件清理（rollout 增量清理，建议项）。
5. 批量改价弹窗双实现合并、`/admin/admins` mock 桩与 governance/types.ts 旧类型残留、4 个未使用依赖（react-avatar/progress/scroll-area/react-hook-form）——归后续清理票。
6. 365D 热力图实际 13 行（跨年月加年份前缀）；上游列表页测试按钮仍为整体 test-connection（编辑器页已是逐把）。
