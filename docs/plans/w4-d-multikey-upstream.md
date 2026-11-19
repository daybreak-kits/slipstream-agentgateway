# W4-D 上游渠道：多密钥平权落地 + 编辑器修正（ADR-026 实施）

前置：**必须先读 docs/experiments/P0-RESULTS.md 的 E18 结论**（同名多条 vs #kN 别名的裁决），渲染形态按 E18 结论实现。规范：ADR-026、DESIGN-AUDIT §15/16、GLOSSARY §3 上游密钥行。

## 后端（api/src）
1. `l05_service/upstream_ops.py` 重写密钥 CRUD：
   - 删除 is_primary 语义：add_key 不再 set_primary；update_key 仅 label；**删除 rotate_primary_key 与 POST /rotate-key 端点**；PATCH key 的 is_primary 字段拒收。
   - 新增**批量删除**（POST /{id}/keys/batch-delete {ids[]}，逐把删、返回逐把结果；保留「至少一把」409 规则）。
   - 新增**逐把测试**（POST /{id}/keys/test → 对每把密钥按 base_url 发最小鉴权请求，返回 [{key_id, ok, status_code, latency_ms, error}]）；结果落 upstream_keys 新列 last_test_json + last_test_at_ms（迁移加列）。
2. `l03/l05` 渲染层（按 E18 裁决形态）：每把密钥展开为独立 provider（名 `{upstream_id}#{key_seq}` 或别名方案），各自 key_file（`keys/{upstream_id}#{seq}.key`）；llm.models/virtualModels 链路按 E18 结论接通平权分流；`upstreams.api_key_enc` 停用（迁移脚本置空并保留列一个版本）；validate 相应放宽/调整（key_file 必填红线不变）。
3. 契约：UpstreamKey 形状变化（去 is_primary、加 last_test）+ 端点增删；`ops/contract/gen_ts.py` 重生成；**docs/api-contract.md 密钥三行同步改写**（含 rotate-key 行删除、batch-delete/test 行新增）。
4. 迁移脚本 `api/scripts/migrate_multikey_v2.py`（dry-run 默认、--apply 落地）：置空 api_key_enc、标记 schema 版本。
5. 测试：密钥 CRUD/渲染展开/golden/validate 全量更新；全量 pytest EXIT=0。

## 前端（web/src）
6. `components/upstreams/connection-tab.tsx`：
   - **名称解锁**：已存上游名称可编辑（draft.name 纳入 dirty 比较与 PATCH 提交，重名 422 展示；文案删「后端增强合入后开放」）；厂商保持只读。
   - 源密钥 FieldDescription 改「每把密钥=一个独立 AG 上游，平权分流；失效密钥标红」。
7. `components/upstreams/keys-panel.tsx` 重做：
   - **去掉外层边框**（connection-tab.tsx:156 包裹层的 rounded-lg border 移除，保留内层卡片）。
   - 去掉 主密钥徽章/设为主密钥/轮换入口；行内=重命名/删除/测试；**逐把测试结果行内展示：失效标红（danger）、成功标绿、未测中性**（含时间）；批量：勾选列+批量删除（批量粘贴保留）。
8. `pages/upstream_detail.tsx`：
   - 切页签确认弹窗删除（requestTab 直接切换）；**未保存页签琥珀色圆点**（连接与模型 Tab label 旁 2px dot，title 提示）；离页拦截保留。
   - 「匿名尝试」确认与匿名探测分支**删除**（空上游不可能存在：创建 422+删空 409，ADR-026 ⑥）。
   - 测试连接调逐把测试端点，状态面板展示每把结果。

## 验收
后端 pytest 全量 EXIT=0 + gen_ts --check；前端 tsc/eslint/build/ui-foundation/术语 strict 全绿；浏览器冒烟：改名→保存→刷新保留；密钥批量粘贴 3 把→逐把测试（mock 1 败 2 成）→失败行红；批量删除保底 409；tab 圆点与离页拦截正常；渲染配置（.data_store/ag-config/config.yaml dry-run 或测试环境）出现 N 个 `#kN`/按裁决形态的 provider。commit 按域拆：`api(w4-d): 多密钥平权——密钥展开N上游/逐把测试/批量删除` + `web(w4-d): 上游编辑器——改名解锁/密钥面板重做/脏页签圆点`。
