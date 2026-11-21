# Slipstream 驭流

模型接口网关的控制面与管理台：统一管理上游模型、公开模型、路由与重试、价目与额度、审计，把配置渲染/下发给 `agentgateway`（pinned 1.7.0，数据面）并同源托管管理台。

> 数据面是 pinned 的 agentgateway 二进制，不可 fork（ADR-001）；本仓库只做控制面：主数据、价目、路由与健康策略、配置渲染与下发、用量与账本、审计。

**状态**：v1 内部交付，持续迭代中。**许可**：Apache-2.0（见 `LICENSE`）。

## 目录

- [核心能力](#核心能力)
- [快速开始](#快速开始)
- [端口](#端口)
- [仓库结构](#仓库结构)
- [常用配置](#常用配置)
- [验证](#验证)
- [设计要点](#设计要点)
- [P0 实验结论](#p0-实验结论)
- [文档](#文档)
- [贡献](#贡献)
- [已知限制](#已知限制)

## 核心能力

- **三层寻址 + 三种路由**：Vendor → Upstream（上游，最多 20 把平权密钥；每把密钥展开为独立数据面上游，ADR-026）→ UpstreamModel；对外只暴露 PublicModel（公开模型）→ 有序 ModelTarget。路由支持 `failover`（priority 低值先试）/ `weighted` / `conditional`（CEL）。
- **请求内重试与健康驱逐**（ADR-024，默认关，未配置 = 现行为）：route 级 retry 渲染为顶层 `policies[]`，挂到数据面内部路由；`codes` 含 4xx 时必须成对配置健康表达式与 `consecutive_failures`，否则保存被 422 拒绝（E16/E17 的「4xx 三件套」）。
- **下发安全链**：文档 → GatewayIR → `validate_gateway_ir` → `adapter.validate` → `adapter.render` 的 dry-run，再用 pinned AG `--validate-only` 预校验候选配置，全部通过才原子替换；任一步失败返回 422，不落盘、不静默丢弃。
- **计费与额度**：上游成本 / 下游收费双账本、两条价目与汇率快照；预付余额由控制面账本权威，数据面 localRateLimit 只做单实例快速拦截（ADR-007/011）。
- **密钥与权限**：控制台 `sk-` 密钥加密落库、仅以 sha256 keyHash 下发数据面；DB 会话 cookie + RBAC（41 个权限键、三角色 + 自建角色、字段级金额裁剪）。
- **管理台**：Vite + React 19 + TypeScript strict；生产构建 `web/dist` 由控制面 3700 同源托管，开发期用 5173。五期能力：日志请求尝试链（模型列两行 +「N 次尝试」popover）、分流图隐藏阶段（后端投影）、公开模型单页（单 PATCH 整页保存 + 成员 chip）、上游模型 100vh 抽屉与逐模型探测/逐把密钥测试、冷却单次/周期互斥（409，ADR-027）、表格操作列 sticky/头身对齐、语义色五档 + 字段级脏标记 + 统一 toast、看板 8 KPI 卡。

## 快速开始

**前提**：Python 3.11+（验证环境 3.13）、Node.js 20.19+ / 22+、Git。仓库不签入任何密钥；演示用 `sk-` 密钥由 seed 生成，只在 seed 输出里出现一次。

建议使用独立虚拟环境，避免「依赖装在系统 Python、终端里却是另一个解释器」。

### 1）装后端依赖

**方式一（推荐，仓库自带 `.venv` 即 uv 创建）：**

```bash
cd api
uv pip install -e . --python .venv/Scripts/python.exe   # macOS/Linux: --python .venv/bin/python
```

> ⚠️ uv 创建的 venv **不含 pip**：在里面跑 `python -m pip` 会报 `No module named pip`，系统全局 `pip install` 也**不会**装进 venv。venv 内装依赖一律用 `uv pip install ... --python .venv 里的 python`。

**方式二（标准 venv，无 uv 时）：**

```bash
cd api
python -m venv .venv

# Windows PowerShell
.venv\Scripts\Activate.ps1

# macOS / Linux
source .venv/bin/activate

python -m pip install -e .
```

`pip install -e .` 会以 editable 方式把 `l06_api` 等包装进当前解释器，后续命令不再需要 `PYTHONPATH`。若同一终端里出现 `No module named uvicorn`，先确认 `python -c "import sys; print(sys.executable)"` 与安装依赖时的解释器是同一个。Windows 下时区数据（`tzdata` 包）已随依赖自动安装，缺它启动会报 `ZoneInfoNotFoundError: Asia/Shanghai`。

### 2）造演示数据

```bash
python scripts/seed_demo.py
```

默认 **DROP 重建**（会清空当前数据库，先停掉占用数据库的 API 进程）；成功输出包含：

```text
写入: 厂商 3 / 上游 4（上游密钥 6，其中 zai-01 一个上游 3 把等权密钥）/ 上游模型 16 / 公开模型 8 / 目标 16 / 用户 6 / 用量事件 252（其中未定价 3）/ 计费流水 245 / 审计 64
登录账号: admin / admin12345（可用 SLIPSTREAM_DEMO_ADMIN_PASSWORD 覆盖）← 首次登录后请立即修改
演示账号另有 lisi（代理用户）/ wangwu（普通用户）；管理员引导账号可用 SLIPSTREAM_ADMIN_USERNAME / SLIPSTREAM_ADMIN_PASSWORD 覆盖（系统环境 > .env > 默认，ADR-019）
```

旧库升级（可选，新库无需执行）：`python scripts/migrate_priority_v2.py` 与 `python scripts/migrate_multikey_v2.py` 均默认 dry-run，加 `--apply` 写入并打 `v2` 标记；多密钥迁移把退役的 `upstreams.api_key_enc` 镜像转成首把密钥行并清空镜像，之后 no-op；读取路径只认 `upstream_keys` 行，未迁移的旧库密钥数显示 0 并提示运行该脚本。

### 3）起控制面（3700）

```bash
python -m uvicorn l06_api.app:create_app --factory --host 127.0.0.1 --port 3700
```

成功判据：另开终端访问 `http://127.0.0.1:3700/admin/health`，返回 `{"status":"ok","ir_version":"...","adapter":"agentgateway",...}`。

### 4）起管理台

开发模式（5173，热更新）：

```bash
cd ../web
npm install
npm run dev
```

浏览器打开 `http://localhost:5173`。管理台与 API 都用 `localhost`（不要与 `127.0.0.1` 混用，否则 SameSite=Lax cookie 不随请求发送）。

生产模式：`npm run build` 后由控制面 3700 同源托管，无需再起 5173。

### 5）登录并改密码

用 seed 演示账号 `admin / admin12345`（未跑 seed、由引导创建时默认为 `admin / admin`，可用 `SLIPSTREAM_ADMIN_USERNAME` / `SLIPSTREAM_ADMIN_PASSWORD` 覆盖）登录，在「用户设置 → 安全」自助修改密码；管理员重置他人密码在「用户管理」。

### 数据面（可选）

控制面只渲染配置，不启动 agentgateway。只有需要真实客户端流量（默认端口 3600）时才单独运行 pinned AG：

```bash
agentgateway -f api/.data_store/ag-config/config.yaml
```

配置由管理台「保存并下发」写出；以配置目录为 cwd 启动（配置里的相对路径按配置文件所在目录解析）。只调控制面/管理台时可跳过。

### 环境排错

- `No module named uvicorn`：当前终端激活的解释器没装本项目依赖。用独立 venv 重装（见步骤 1），或统一改用装过依赖的那个 Python。
- venv 里 `python -m pip` 报 `No module named pip`：这个 venv 是 uv 创建的（天然无 pip），改用 `uv pip install -e . --python .venv 里的 python`，不要用全局 pip（会装进系统 Python）。
- 启动报 `ZoneInfoNotFoundError: Asia/Shanghai`：Windows 精简环境缺时区数据包，`uv pip install tzdata`（或重跑依赖安装，pyproject 已声明）。
- PowerShell 里 `PYTHONPATH=src python ...` 报「无法识别」：这是 bash 写法，PowerShell 应为 `$env:PYTHONPATH="src"`；editable 安装后一般不需要 PYTHONPATH。
- 端口被占用：换 `--port`，并注意别与其它 agentgateway/控制面实例共用数据目录。

## 端口

| 端口 | 用途 | 说明 |
|---|---|---|
| 3600 | 数据面（客户端调用入口） | agentgateway，客户端只打这里；由部署方单独运行 |
| 3700 | 控制面 API + 管理台静态资源 | `/admin/*`；生产单端口部署 |
| 5173 | 管理台开发服务器 | 仅开发用，proxy 到 3700 |

> 若本机已有其它 agentgateway/控制面实例，请勿复用其端口与数据目录（本仓库默认数据目录 `api/.data_store`，已 gitignore）。

## 仓库结构

```text
slipstream-agentgateway/
├── api/                         # 控制面（Python 3.11+ / FastAPI / SQLAlchemy / SQLite）
│   ├── src/
│   │   ├── l01_core/            # 配置、错误、日志、时间
│   │   ├── l02_domain/          # 领域模型、GatewayIR、校验、改写规则编译
│   │   ├── l03_adapters/        # 数据面适配层（SPI + agentgateway 驱动 + mock）
│   │   ├── l04_repo/            # SQLite 仓储（ORM + repository）
│   │   ├── l05_service/         # 业务服务（价目、账本、下发、用量回流、策略）
│   │   ├── l06_api/             # FastAPI 路由与请求/响应模型
│   │   └── l07_jobs/            # 进程内定时任务（用量拉取、对账）
│   ├── scripts/                 # seed_demo / migrate_priority_v2 / 离线依赖安装
│   └── tests/                   # unit / contract / integration
├── web/                         # 管理台（Vite + React 19 + TS strict + Tailwind + radix）
│   └── scripts/                 # check-bundle / check-ui-foundation / routes-json
├── docs/                        # 计划、ADR、术语、API 契约、实验与验收
├── ops/
│   ├── checks/                  # 质量闸门（typecheck/lint/路由审计/smoke/术语/浏览器验收）
│   ├── contract/gen_ts.py       # OpenAPI → web/src/generated/contract.ts
│   └── experiments/ag-lab/      # E16/E17 探针脚本、pinned schema 与证据（只读）
└── README.md
```

分层铁律：底层不 import 高层；服务层只依赖适配层 SPI，不 import 具体驱动。

## 常用配置

全部为 `SLIPSTREAM_*` 环境变量（pydantic-settings，默认值见 `api/src/l01_core/settings.py` 与 `docs/PLAN.md` §3）。也可以写进仓库根目录或启动目录的 `.env`（模板见 `.env.example`）；优先级：系统环境变量 > `.env` > 默认值。

| 变量 | 默认 | 说明 |
|---|---|---|
| `SLIPSTREAM_DATABASE_URL` | `sqlite:///./.data_store/slipstream.db` | 控制面 SQLite；相对路径按 API 进程 cwd 解析 |
| `SLIPSTREAM_DATA_PLANE_CONFIG_DIR` | `./.data_store/ag-config` | 渲染配置与 key 文件的落盘/白名单目录（中性部署目录）；`SLIPSTREAM_AG_CONFIG_DIR` 仍是弃用别名、继续生效，两者同设时中性名优先（迁移而非拒绝） |
| `SLIPSTREAM_AG_LLM_PORT` | `3600` | 数据面客户端端口（适配器命名空间；渲染进配置并出现在健康/连接信息） |
| `SLIPSTREAM_AG_DB_PATH` | 未设 | 数据面日志 SQLite 路径覆盖；未设时用适配器默认（配置目录内 `ag-data.db`） |
| `SLIPSTREAM_AG_BINARY` | 自动探测 | pinned AG `--validate-only` 闸门；设空字符串禁用闸门（会在 apply 记录） |
| `SLIPSTREAM_SECRET_KEY` | `dev-only-change-me` | 落库加密主密钥，生产必须覆盖 |
| `SLIPSTREAM_COOKIE_SECURE` | `false` | 生产 HTTPS 下设为 `1` |
| `SLIPSTREAM_JOBS_ENABLED` | `true` | `0` 关闭进程内定时任务（测试/独立 worker） |
| `SLIPSTREAM_ADMIN_USERNAME` / `SLIPSTREAM_ADMIN_PASSWORD` | `admin` / `admin` | 仅首次无管理员时用于 bootstrap（ADR-019），之后只认 DB |

> ADR-029 命名空间策略（W6 票 04）：核心 settings 只保留中性运行配置；数据面专有旋钮（`SLIPSTREAM_AG_CONFIG_FILENAME`、`SLIPSTREAM_AG_LLM_PORT`、`SLIPSTREAM_AG_DB_PATH`、`SLIPSTREAM_AG_BINARY`）由适配器命名空间 `api/src/l03_adapters/agentgateway/deployment.py` 读取，变量名不变，行为不变。

## 验证

后端测试（unit + contract + integration）：

```bash
cd api
python -m pytest          # 全绿即通过（五期基线 836 passed / 18 warnings；Windows 终端可能不打印统计行，以 EXIT 码为准）
```

> 提示：`pyproject.toml` 已设 `addopts = "-q"`，再传 `-q` 会变成 `-qq`，统计行不再打印。集成测试中「下发前二进制校验」需要 pinned AG：设 `SLIPSTREAM_AG_BINARY` 指向 1.7.0 二进制；找不到时自动跳过并记录，不阻塞其余测试。

渲染/前后端契约：

```bash
python ops/contract/gen_ts.py --check
```

前端闸门：

```bash
cd web
npx tsc --noEmit
npx eslint src
npm run build
node scripts/check-bundle.mjs
node scripts/check-ui-foundation.mjs
node scripts/check-semantic-dirty.mjs
```

仓库级闸门：

```bash
bash ops/checks/verify_web.sh                # tsc + eslint + 路由审计
node ops/checks/route-audit.mjs
node ops/checks/terminology_audit.mjs       # UI 术语（error 级；扫描范围 web/src，不含 docs）
node ops/checks/interaction_audit.mjs --channel msedge   # 全站逐控件交互审计（可选，耗时）
python ops/checks/smoke_api.py              # 需先起 3700
node ops/checks/acceptance_browser.mjs --strict   # Playwright 全站验收
```

## 设计要点

- **寻址**：Vendor（厂商）→ Upstream（上游，连接地址 + 协议风格 + 最多 20 把平权密钥）→ UpstreamModel（上游模型）；对外只暴露 PublicModel（公开模型）→ 有序 ModelTarget。每把上游密钥在数据面展开为独立上游（`{model}#k{seq}`，ADR-026）。
- **路由与 failover**：`failover` 按 priority 低值先试；同层由数据面按 P2C + 延迟 EWMA 选路，控制面不做轮询。跨层切换发生在主层被驱逐后的下一次尝试，`attempts >= 2` 才可能生效（E16/E17）。
- **请求内重试（ADR-024）**：渲染为顶层 `policies[]` 的 route 级 retry（target `internal/llm:request`）；AG 1.7 的 `llm.policies` 仍拒绝 retry。4xx 必须与 `health`（`unhealthyExpression` + `eviction.consecutiveFailures`）成对，否则保存时 422。
- **改写**：请求/响应头体统一动作词表 `create/update/delete/copy/prepend/append/regex_replace/to_upper/to_lower`，条件为 CEL 谓词（ADR-009）。
- **计费**：上游成本与下游收费两本账、两条价目，金额为整数微单位；汇率快照决定报表货币（ADR-011）。下游默认倍率 1.0。
- **额度**：预付余额（管理员分配/用户充值），控制面账本权威；数据面 localRateLimit 仅单实例快速拦截（ADR-007/012）。
- **密钥**：`sk-` + 大写字母数字，加密落库、可反复复制（reveal 走审计）；下发数据面只放 sha256 keyHash（ADR-008）。
- **健康**：数据面运行时状态不落控制面库；控制面只做人工 Ban / Cooldown（ADR-006）。
- **渲染形态**：混合形态（gateway 面 `gateways.default` + llm 模型路由 + 顶层 route policies）。纯完整形态 `routes/backends[].ai` 无法按请求体 model 路由，刻意未采用（ADR-024）。

## P0 实验结论

完整记录见 `docs/experiments/P0-RESULTS.md`（E1 至 E17，含原始证据与配置）。与产品行为直接相关的要点：

- 简化 llm 模式不接受请求内 retry（E13）→ 用顶层 `policies[]` 的 route 级 retry 实现（E14/E16）。
- 完整形态下组间 failover 需要 **retry codes + health 表达式 + eviction** 三件套（E16/E17）；只配 codes 不会换组，4xx 尤甚。
- 流式响应**首字节之后无法切换**目标（E14/E17），客户端会收到截断流；每次请求仍只记一条日志。
- 真实上游鉴权：`backendAuth` 的 key file → `Authorization: Bearer`；错误 key 时上游 401/403 原样回传（E17）。
- 已知上游风险：AG 1.7 在真实 429 场景出现 `outlierdetection.rs` SystemTime overflow panic（E17 记录），需等上游修复；生产选备上游避免依赖不可用免费额度。

## 文档

| 文件 | 内容 |
|---|---|
| `docs/PLAN.md` | 总体设计、分层与里程碑 |
| `docs/DECISIONS.md` | ADR-001 至 ADR-028 决策记录（含 ADR-027 冷却互斥、ADR-028 追踪归适配层） |
| `docs/GLOSSARY.md` | 术语表 |
| `docs/api-contract.md` | 管理面 HTTP 契约 |
| `docs/contracts/` | SPI / IR 与渲染 / 计费 / 改写编译器契约 |
| `docs/experiments/P0-RESULTS.md` | E1 至 E20 实验结论与原始证据索引 |
| `docs/ACCEPTANCE.md` | 验收清单 |
| `docs/CHANGELOG-phase2.md` | 二期变更记录（历史） |
| `docs/CHANGELOG-phase4.md` | 四期变更记录 + 五期（W5）变更记录 |
| `docs/plans/w5-correctness-rework.md` | 五期（W5）实施计划与工票记录 |
| `docs/DESIGN-AUDIT.md` | 设计巡检、设计规范与五期实现清单 |
| `docs/DELIVERY.md` | 交付说明与各期门禁基线 |
| `ops/README.md` | 质量闸门与实验脚本说明 |

## 贡献

当前无 `CONTRIBUTING.md`，约定如下：

- 欢迎 issue / PR；提交前请确保后端 `python -m pytest` 与前端闸门全绿。
- 改动管理面响应/请求模型时，同步运行 `python ops/contract/gen_ts.py` 并提交生成的 `web/src/generated/contract.ts`。
- 不提交密钥、真实连接串或生产数据；实验证据放 `docs/experiments/` 或 `ops/experiments/` 并脱敏。
- 安全与密钥相关问题不要开公开 issue，请私下联系维护者（`TODO(human)`：补充 SECURITY.md 与联系渠道）。

## 已知限制

- 渲染为混合形态而非纯完整形态（ADR-024）：AG 1.7 的路由匹配只看 path/method/query/header/host，无法按请求体 model 路由；多公开模型仍需 llm 模型路由层。
- 请求内重试 / 健康驱逐默认关；同层组内切换是 P2C 概率性、不保证切到指定目标；流式首字节后不切换；`codes` 含 4xx 必须配对 health，否则 422。
- 健康运行时状态不落控制面库（仅人工「关闭/冷却」措施）；数据面重启后健康状态清零（E3）。
- MCP 仅支持 `sse/stdio`；AG 1.7 不支持 http 变体与带路径 webhook，保存时 422、前端置灰。
- 可用性并入模型管理：**措施只属上游模型**（ADR-025），公开模型仅启用/关闭；上游模型行内单按钮「冷却」双模式（单次/周期），不含完整排期日历。单次与周期**互斥**（409；解除只删一次性规则、周期窗口只跳过当前窗口，ADR-027）；公开模型冷却写操作 422。
- 五期新增边界：路由链依赖 AG 适配器私有 loopback OTLP（历史日志无链路记录，采集端宕机期间尝试丢失）；conditional × 多密钥只展开首把（E20）；按上游密钥分账不可得（账本按最终上游计）；分流隐藏阶段至少保留 2 段；`request_logs` 仍 1 请求 1 行，尝试链单独存 `request_attempts`（30 天）；模型探测不落库、串行单模型 20s、`api_style=auto` 未解析时 422。
- 控制台登录为 DB 会话（httpOnly + SameSite=Lax cookie，12h 绝对过期）；生产必须设 `SLIPSTREAM_COOKIE_SECURE=1` 并使用 HTTPS。
- 演示账号与默认密钥仅用于本地开发；生产覆盖 `SLIPSTREAM_SECRET_KEY`、`SLIPSTREAM_ADMIN_PASSWORD` 并轮换所有密钥。

## License

Apache License 2.0，见 `LICENSE`。
