# Slipstream v1

LLM 网关的管理面（控制面）与管理台。数据面使用 agentgateway（v1.7.0）作为不可 fork 的黑盒；本仓库只做控制面：主数据、价目、路由策略、配置渲染与下发、用量与账本、审计。

## 目录

```
slipstream/
├── api/                 # 控制面（Python 3.13 + FastAPI + SQLAlchemy + SQLite）
│   ├── src/
│   │   ├── l01_core/        # 配置、错误、日志
│   │   ├── l02_domain/      # 领域模型、IR、改写规则编译
│   │   ├── l03_adapters/    # 数据面适配层（SPI + agentgateway 驱动 + mock）
│   │   ├── l04_repo/        # SQLite 仓储
│   │   ├── l05_service/     # 业务服务（计价、账本、下发、用量回流）
│   │   ├── l06_api/         # FastAPI 路由
│   │   └── l07_jobs/        # 定时任务（用量拉取、健康同步）
│   ├── scripts/seed_demo.py # 演示数据（默认 DROP+重建，幂等；--keep 仅空 schema）
│   ├── scripts/migrate_priority_v2.py # 旧 priority 方向迁移（一期数据升级用）
│   └── tests/               # unit / contract / integration
├── web/                 # 管理台（Vite + React 19 + TS strict + Tailwind + radix）
├── docs/                # 计划、决策、术语、契约、实验、审计
└── ops/checks/          # 质量闸门脚本（typecheck/lint/路由审计/API smoke）
```

分层铁律：底层不 import 高层；服务层只依赖适配层 SPI，不 import 具体驱动。

## 快速开始（Windows）

```bash
# 1) 后端依赖
cd slipstream/api
python -m pip install -e .

# 2) 造演示数据（默认 DROP 重建，幂等；会重建所有表，先停掉占用数据库的 API 进程）
PYTHONPATH=src python scripts/seed_demo.py

# 2b) 旧库升级（可选）：把一期「数值大优先」的 priority 一次性翻转为 AG v2 语义
PYTHONPATH=src python scripts/migrate_priority_v2.py          # dry-run
PYTHONPATH=src python scripts/migrate_priority_v2.py --apply  # 写入 + 标记

# 3) 起控制面（3700）
PYTHONPATH=src python -m uvicorn l06_api.app:create_app --factory --host 127.0.0.1 --port 3700

# 4) 起管理台（5173，另开一个终端）
cd ../web
npm install
npm run dev
```

浏览器打开 http://localhost:5173 （管理台与 API 都用 `localhost`，不要混用 `127.0.0.1`，否则 SameSite=Lax cookie 不会随请求发送）。首次进入会跳到 /login，用 seed 的默认管理员 `admin / admin12345` 登录；首次登录后请立即在「管理员」页修改密码。

seed 规模：3 厂商 / 6 上游 / 20 上游模型（19 个带成本+1.2 倍率）/ 8 公开模型 / 16 路由目标 / 6 用户（根用户 D + 两层代理树）/ 5 把 sk- 连接密钥 / 3 个管理员 / 252 条 7 天用量 / 2 条可用性规则 / 策略·护栏·MCP 各一份可编辑样例；种子数据已按 AG v2「数值小优先」写入并打 `priority_semantics=v2` 标记。

生产构建：cd web && npm run build（产物在 web/dist）。

## 端口

| 端口 | 用途 | 说明 |
|---|---|---|
| 3600 | 数据面（客户端调用入口） | agentgateway，客户端只打这里 |
| 3700 | 控制面 API + 管理台数据源 | /admin/* |
| 5173 | 管理台开发服务器 | 仅开发用 |

> 已有的 3691 数据面实例与 1900x 管理端口属于另一套运行环境，本项目开发与测试全程不得触碰。

## 验证

```bash
# 后端测试（unit + contract + integration）
cd api && python -m pytest -q          # 309 passed

# 前端闸门
cd web && npx tsc --noEmit && npx eslint src

# 全量闸门 + 路由审计
bash ops/checks/verify_web.sh
node ops/checks/route-audit.mjs

# 接口 smoke（需先起 3700）
python ops/checks/smoke_api.py

# 浏览器全站验收（Playwright，--strict 为发布门禁）
node ops/checks/acceptance_browser.mjs --channel msedge --strict
node ops/checks/terminology_audit.mjs

# 全站交互审计（33 页，逐按钮/输入/选择/弹层操作 + 截图）
node ops/checks/interaction_audit.mjs --channel msedge
```

## 关键设计

完整设计见 docs/PLAN.md，决策记录见 docs/DECISIONS.md（ADR-001 ~ ADR-014），术语见 docs/GLOSSARY.md。

- 三层寻址：Vendor（厂商）→ Upstream（上游，一把密钥）→ UpstreamModel（上游模型）；对外只暴露 PublicModel（公开模型/别名）→ 有序 ModelTarget（公开模型成员）。
- 路由：failover（priority 层级，低值先试）/ weighted（权重）/ conditional（CEL 条件）；同层由数据面按 P2C + 延迟 EWMA 选路，控制面不做轮询、不承诺请求级重试（ADR-012/014）。
- 改写：请求/响应头体统一动作词表 create/update/delete/copy/prepend/append/regex_replace/to_upper/to_lower，条件为 CEL 谓词（ADR-009）。
- 计费：上游成本与下游收费两本账、两条价目（ADR-011）；下游默认倍率 1.0。
- 额度：预付余额（管理员分配/用户充值），控制面账本为权威，数据面 localRateLimit 只做单实例快速拦截（ADR-007/012）。
- 密钥：控制台密钥 sk- 开头 + 大写字母数字，加密落库、可反复复制（reveal 走审计）；下发到数据面只放 sha256 keyHash（ADR-008）。
- 健康：数据面运行时状态不落控制面库；控制面只管人工 Ban / Cooldown（ADR-006）。

## P0 实验结论

见 docs/experiments/P0-RESULTS.md：E1–E13（无请求内重试、热加载不断流、健康状态进程内、failover 目标不能是 virtualModel、P2C 同层选路、transformations 全生效、额度先计费后拦截、retry 配置面不接受等）。

## 已知限制（v1）

- 控制台登录为真实 DB 会话（httpOnly + SameSite=Lax cookie，12h 绝对过期；生产需 `SLIPSTREAM_COOKIE_SECURE=1`）；RBAC 已落地：41 个权限键、三角色 + 自建角色、字段级金额过滤（缺键非 null）。
- MCP 已可编辑（顶层 `mcp.targets`，sse/stdio）；agentgateway v1.7 不支持 http 变体与带路径 webhook，保存时 422、前端置灰。
- 可用性并入模型管理（关闭/启用/一次性冷却/解除）；UI 另提供紧凑的周期冷却编辑（重复方式 + 时间窗），不做完整排期日历，后端周期冷却（daily/weekly/monthly）完整保留，见 ADR-004。
- 请求级重试不支持（ADR-010/013）。
- 健康驱逐参数在简化配置不可配，仅数据面内部生效。