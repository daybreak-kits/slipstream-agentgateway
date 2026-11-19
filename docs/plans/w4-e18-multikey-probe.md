# W4-E18 探针实验：同名模型跨多 provider 的分流与请求内切换（ADR-026 前置）

实验票：只写 `ops/experiments/ag-lab/` 下的探针脚本/配置/证据，**不改 api/src 与 web/src 任何代码**。产出写进 `docs/experiments/P0-RESULTS.md` 新增「E18」节。工作目录 `ops/experiments/ag-lab/`，pinned AG 1.7.0 二进制，一律 mock/本地 upstream，不碰真实凭据（`.env.e15` 的规则见该文件头注释）。

## 背景

ADR-026 已定：每把上游密钥展开为一个独立 AG 上游（provider），平权分流。控制面渲染改造前必须钉死 AG 1.7 的两个未知语义（E16/E17 未覆盖）：
- `llm.models[]` 里**同名模型出现多条**（各自 provider.reference 指向不同 provider）是否合法？AG 如何处理（后者覆盖？共存分流？）？
- 同一 provider 组（同 baseUrl 不同 key_file）之间的**请求内 failover** 在混合形态（顶层 policies[] retry 挂 internal/llm:request + health 三件套）下是否与跨 upstream 切换行为一致？

## 实验（参考 E16/E17 的 mock upstream 方法，脚本可复用 ag-lab 既有模式）

- T1 合法性：`agentgateway --validate-only` 跑三种配置——①同名 llm.models×2（不同 provider）；②同名×3；③不同名各指不同 provider（对照）。记录 validate 结果与告警。
- T2 分流：对合法配置打 N=60 次请求，两个 mock upstream 各自计数（响应里带可区分标记），统计分流比例（预期 P2C 近似 50/50；记录实际分布）。
- T3 请求内切换：provider-A 恒 500、provider-B 恒 200，配 codes=[500] + health 三件套（E16 口径），连打 10 次，记录：客户端状态码分布、每次命中的 upstream（从响应标记读）、duration 是否含重试延迟。
- T4 平权声明复核：同层多 target 时 AG 是否严格等权（E7 的 P2C 结论是否适用于 provider 维度）。
- 若 T1 判定「同名不合法」：追加 T1b——不同名（如 `glm-5.3#k1`/`glm-5.3#k2`）+ virtualModel targets 同层引用的等价方案验证（T2/T3 改用该形态重跑）。

## 产出与验收

1. `docs/experiments/P0-RESULTS.md` 新增 E18 节：结论一句话 + 每个子实验的配置要点、原始证据文件路径（脚本与输出放 `ops/experiments/ag-lab/`，脱敏）。
2. 明确回答：ADR-026 渲染形态应采用「同名多条」还是「`#kN` 后缀别名」，T3 切换是否与跨 upstream 一致。
3. 回报写清：每个 T 的结果表、validate 输出摘录、结论。
