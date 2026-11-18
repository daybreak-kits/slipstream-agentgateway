# Slipstream 管理台（slipstream/web）

Slipstream v1 控制面前端：Vite + React 19 + TypeScript(strict) + Tailwind 4 + TanStack Query/Table + react-router + sonner + lucide-react。

## 快速开始

```bash
npm install
npm run build      # 产物 web/dist，由控制面 3700 同源托管（推荐的单端口交付）
cd ../api && PYTHONPATH=src python -m uvicorn l06_api.app:create_app --factory --port 3700
# 打开 http://localhost:3700

# 仅本地 HMR 调试时才单独起 dev server（vite 已把 /admin、/api 代理到 3700）
npm run dev        # http://localhost:5173
```

后端未就绪时可演示：`.env.example` 里有 `VITE_USE_MOCK=1`，复制为 `.env` 即启用 mock（侧栏顶栏会显示「Mock 演示」徽章）。置 `0` 或删掉则直连控制面。

## 环境变量

| 变量 | 默认 | 说明 |
|---|---|---|
| `VITE_API_BASE` | 空（同源） | 控制面 API 地址。单端口部署留空走相对路径；独立 dev/分离部署时设为控制面地址（如 `http://localhost:3700`）。**只允许打 3700 控制面**；3600 是数据面入口，3691 / 1900x 是生产实例，前端一律不碰 |
| `VITE_USE_MOCK` | 未设置=直连 | `1` / `true` 时走 `src/lib/mock.ts` 内置数据 |

## 脚本

| 命令 | 说明 |
|---|---|
| `npm run dev` | 开发服务器（5173，strictPort） |
| `npm run build` | `tsc --noEmit` + vite 生产构建 |
| `npm run typecheck` | 仅类型检查 |
| `npm run lint` | eslint（flat config） |
| `npm run format` | prettier（行宽 100） |

## 目录

```
src/
├─ main.tsx                  入口：QueryClient + Router + Toaster
├─ app.tsx                   路由表（13 个页面）
├─ index.css                 语义色 token（:root / .dark）+ @theme 映射 + .tnum 等宽数字
├─ types.ts                  后端 snake_case 类型（前端不二次改名）
├─ lib/
│  ├─ api.ts                 baseURL(VITE_API_BASE) + 统一错误处理 + toast（ApiError）
│  ├─ mock.ts                mock 数据与路径表（VITE_USE_MOCK 开关）
│  ├─ theme.ts               深浅色（localStorage + .dark class，index.html 反闪烁）
│  ├─ format.ts              数字 / 金额 / 百分比 / 时间格式化
│  └─ utils.ts               cn()（clsx + tailwind-merge）
├─ components/
│  ├─ layout/app-shell.tsx   可折叠侧栏 + 顶栏（环境徽章 / 配置版本 / 刷新 / 深浅色）
│  ├─ layout/nav-items.ts    导航分区：监控 / 主数据 / 治理
│  ├─ data-table.tsx         TanStack Table 封装：排序 / 筛选 / 分页(25/50/100/200) / 空态 / 骨架
│  ├─ stat-card.tsx          指标卡
│  ├─ chart-placeholder.tsx  图表占位（接数后替换）
│  ├─ transforms/transforms-editor.tsx
│  │                          改写规则编辑器（四段分区 / 条件行 / 保护头拦截 / 分段预览 / custom_cel）
│  └─ ui/                    button / card / badge / input / table / skeleton / empty / tabs
└─ pages/                    17 个列表页壳（含成本 / 营收 / 上游价目 / 下游价目 / 待补价）+ upstream_detail（基本信息 | 改写 双 tab），每页都经 TanStack Query 走 api.ts（mock 或直连）
```

## 设计约定

- 语义色只用 token：`bg-surface`、`text-title`、`text-faint`、`bg-primary`、`bg-danger-soft` 等，禁止裸十六进制与紫色渐变；深色只靠 `.dark` 覆盖 CSS 变量。
- 数字与金额一律加 `tnum`（等宽数字）。
- 页面不直接 fetch，统一 `api.get/post/patch/del`；错误统一 `{code, message, details?, request_id}` → toast。
- 表格分页档位固定 25/50/100/200，默认 50。

## 已知环境限制

DSH 沙箱内 node 的 `child_process.spawn` 一律 EPERM（npm 生命周期脚本、esbuild 服务都起不来），因此本机沙箱里 `npm install` 要加 `--ignore-scripts`、`vite build/dev` 无法启动；在正常终端不受影响。
