# W4-H models.dev 拉取与模型参数暴露

背景：旧仓有 models.dev 集成（docs/research/phase2/OLD-CHANNEL-MODEL.md 有完整调研），本仓零基础。用户裁定：模型参数应暴露给每个代理用户；models.dev 拉参数+进价预填（选 b）。

## 后端（api/src）
1. **快照表** `l04_repo`：ModelDevSnapshotORM（provider、model、params_json【context_window/max_output_tokens/capabilities/modalities 等 models.dev 原样】、pricing_json【input/output per 1M】、fetched_at_ms；唯一键 provider+model）。init_db 建表。
2. **拉取服务** `l05_service/models_dev.py`：fetch `https://models.dev/api.json`（超时/重试/体积上限；失败保留旧快照并记 warning）；按 upstream_models 名称匹配（精确优先，大小写不敏感；不做模糊猜测，匹配不到不填）。
3. **兑入端点** `POST /admin/upstream-models/{id}/adopt-modelsdev`：只填 parameters_json 中**留空/0 的键**（用户手改过的永不覆盖）；进价同理（cost_input_per_1m/cost_output_per_1m 留空才填）；返回逐键结果（filled/skipped-manual/no-match）。批量版 `POST /admin/upstream-models/adopt-modelsdev`（全部，返回汇总）。权限 upstream_models:write。
4. **每日 job** `l07_jobs/models_dev_sync.py`：拉快照+自动兑入（同样只填空规则），接入 server.py wiring（SLIPSTREAM_JOBS_ENABLED=0 可停）；手动按钮走兑入端点。
5. **代理用户暴露**：`GET /admin/my/models`——登录用户可查**公开模型**的参数合集（名称/参数/能力/类型；不含成本与倍率键），RBAC 仅需登录会话（逐用户可见=所有启用中的公开模型）；供演练场与「我的」页消费。
6. 测试：快照解析 fixture、只填空语义（手改不覆盖）、缺网失败降级、/my/models 权限与形状。全量 pytest EXIT=0 + gen_ts 重生成 + api-contract.md 增行。

## 前端（web/src）
7. 上游模型编辑弹窗加「从 models.dev 兑入」按钮（单条端点；结果 toast 逐键）；参数区带来源徽章（models.dev/手动，来源信息从 adopt 响应或模型行新字段读——后端在 upstream_models 出参加 params_source 键）。模型列表「同步 models.dev」入口（工具条按钮，调批量端点）。
8. 演练场（playground）模型参数面板与「我的」侧（settings 或 quick-start，按现有信息架构就近）展示 /admin/my/models 的参数（上下文窗口/最大输出/能力/输入输出类型）。

## 明确不做
不把参数渲染进 AG 数据面（AG 1.7 无 per-model params 槽，model_params.py 红线不变）；不覆盖手改值。

## 验收
pytest EXIT=0（含离线 fixture 测试，不真联网）+ gen_ts --check；前端五门禁绿；冒烟：手动同步按钮拉真 api.json（需联网，回报注明）或 fixture；留空参数被填、手改参数不动；/admin/my/models 用代理用户会话可查、无金额键；截图贴回报。commit：`api(w4-h): models.dev 快照+兑入+每日任务+用户侧模型参数端点` + `web(w4-h): models.dev 兑入入口与来源徽章/用户侧参数展示`。
