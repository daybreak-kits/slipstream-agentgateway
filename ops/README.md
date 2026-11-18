# ops — 开发期质量门禁与实验证据（不是运行时模块）

> 这里没有服务、没有部署单元，控制面/前端也不会 import 它。生产只需 `api`（3700，托管 `web/dist`）与数据面（3600）；`ops/` 只在开发、验收、复盘时手动执行。

## 结构

| 路径 | 用途 | 是否入库 |
|---|---|---|
| `checks/` | 质量门禁脚本：API smoke、浏览器验收、交互审计、路由审计、术语审计、前端 tsc/eslint 包装 | 脚本入库，输出不入库 |
| `checks/.logs/` | 每次运行的报告/截图/临时探针；`.gitignore` 忽略 | 否 |
| `contract/` | 从 FastAPI OpenAPI 生成前端契约类型（`gen_ts.py`，`--check` 防手改） | 是 |
| `experiments/ag-lab/` | P0 阶段 agentgateway v1.7 隔离实验脚本与证据（E1–E13）；结论见 `docs/experiments/P0-RESULTS.md` | 是 |
| `shots/` | 本地截图占位目录 | 否 |

## 常用命令（在仓库根目录执行）

```bash
bash ops/checks/verify_web.sh                  # tsc + eslint + 路由审计
node ops/checks/route-audit.mjs                # 路由与动态路由审计
node ops/checks/acceptance_browser.mjs --channel msedge --strict   # 单端口 3700 全站验收
node ops/checks/interaction_audit.mjs --channel msedge             # 逐页交互审计
node ops/checks/terminology_audit.mjs          # 术语/品牌资产
python ops/contract/gen_ts.py --check          # 校验 web/src/generated/contract.ts 未过期
python ops/checks/smoke_api.py                 # API 冒烟（默认 http://localhost:3700）
```

## 证据与清理约定

- `.logs/` 只保留被文档引用的最新批次（当前：`acceptance/20261118-202505`、`interaction/20261118-183422`），其余运行记录可随时删除；它们本来就不入库。
- 临时探针脚本不要提交到仓库：放 `.logs/` 用完即删；新增稳定脚本才放 `checks/`。
- `experiments/ag-lab/evidence/` 是历史实验原始证据，新增架构改造不需要往这里加。
