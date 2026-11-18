# Triage labels

- `ready-for-agent`：规格完整、无未决依赖，可分配给 implementer。
- `claimed`：已被某个 implementer 领取（分支 `ticket/NN-<slug>`）。
- `resolved`：实现完成、验证通过、commit 已合入 `phase2/integration`。
- `needs-info`：缺规格/依赖/外部条件，需 Lead 或用户补充。
- `wontfix`：经用户/Lead 裁定不做（在 ticket 中记原因）。
- `blocked`：被其他 ticket 阻塞（Blocked by 字段列明）。
