# Issue tracker: Local markdown

本仓库的 ticket 不走 GitHub Issues，使用本地 markdown 跟踪。

- Spec：`.scratch/phase2/spec.md`
- Tickets：`.scratch/phase2/issues/NN-<slug>.md`（21 张，按依赖顺序编号）
- 每张 ticket 用 `Status:` 行跟踪状态，取值见 `docs/agents/triage-labels.md`。
- 完成 ticket 时把 `Status: ready-for-agent` 改为 `Status: resolved`，并附 commit hash。
- 实施在 worktree 分支 `ticket/NN-<slug>` 上进行；合并回 `phase2/integration` 由 Lead/merger 负责，implementer 不得自行合并。
- 不创建 PR、不 push 远程（用户明确要求）。
