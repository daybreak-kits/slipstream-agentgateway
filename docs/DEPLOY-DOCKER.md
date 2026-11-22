# Docker 部署（控制面 + PostgreSQL + agentgateway）

这是一套从 **git clone 后直接启动** 的部署形态，已在 Ubuntu WSL2 + Docker 29.7.2 + Compose v5.5.0 上实测：

- 控制面 API 与管理台：容器内 `0.0.0.0:3700`，宿主默认映射 `3700`。
- PostgreSQL 16：控制面主数据、账本、日志查询全部走 Postgres。
- agentgateway 1.7.0 Linux 二进制：构建进运行镜像，供 `--validate-only` 与数据面容器使用。
- 数据面容器默认等待 `/data/ag-config/config.yaml` 出现后启动；首次需要先在控制台保存并下发配置。
- 首次启动若数据库为空且 `SLIPSTREAM_SEED_DEMO=1`，会自动写入演示数据（6 个用户、上游、模型、价目、日志）。

## 启动

```bash
git clone --branch w8/docker-deploy <repo-url> slipstream-agentgateway
cd slipstream-agentgateway
cp .env.docker.example .env
# 至少改 POSTGRES_PASSWORD、SLIPSTREAM_ADMIN_PASSWORD、SLIPSTREAM_DEMO_ADMIN_PASSWORD
docker compose up -d --build
curl http://127.0.0.1:3700/admin/health
```

打开 `http://localhost:3700`。WSL2 下从 Windows 浏览器访问用 `localhost`，不要用 `127.0.0.1`；容器/Ubuntu 内仍可用 `127.0.0.1`。演示 seed 的登录密码取 `.env` 的 `SLIPSTREAM_DEMO_ADMIN_PASSWORD`（示例值 `change-this-demo-password`），不是 `admin12345`；空库初始化使用 `SLIPSTREAM_ADMIN_PASSWORD`。生产环境必须改掉所有默认密码。

构建网络受限时，可把 agentgateway 下载指向可访问的镜像，避免构建卡在 GitHub：

```bash
# .env
AGENTGATEWAY_DOWNLOAD_URL=https://gh-proxy.com/https://github.com/agentgateway/agentgateway/releases/download/v1.7.0/agentgateway-linux-amd64
```

## 首次下发配置

管理台登录后，在首次保存配置时执行下发；也可以直接调用控制面：

```bash
curl -sS -c /tmp/slipstream.cookies -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"<demo password>"}' \
  http://127.0.0.1:3700/admin/auth/login

curl -sS -b /tmp/slipstream.cookies -H 'Content-Type: application/json' \
  -d '{"reason":"first docker deploy"}' \
  http://127.0.0.1:3700/admin/config/apply
```

下发成功后 `gateway` 日志应出现 `loaded config from File("/data/ag-config/config.yaml")` 和 `started bind bind="bind/3600"`。在此之前 gateway 保持等待是预期行为。

## 验证 Postgres

```bash
docker compose exec db psql -U slipstream -d slipstream -c '\dt'
docker compose exec db psql -U slipstream -d slipstream -c 'select count(*) from users;'
docker compose exec app python -c "import psycopg; print(psycopg.__version__)"
```

控制面日志里不应出现 SQLite 路径；`/admin/health` 应返回 `{"status":"ok",...}`。W8 修复后 `/admin/usage/pull` 在 Postgres 上可正常把 agentgateway 的 request_logs 增量写入 `gateway_usage_events`。

## 数据面

下发配置后，`gateway` 容器读取 `appdata` 卷里的 `config.yaml` 并启动 3600 数据面。真实客户端请求打到 `http://<host>:3600`；Windows 侧同样用 `localhost:3600`：

```bash
curl http://127.0.0.1:3600/v1/models \
  -H "Authorization: Bearer <客户端密钥>"
```

客户端密钥在控制台「连接密钥」创建；密钥明文只显示一次，复制会进审计。上游密钥在「上游渠道」配置，由控制面物化到 `appdata/ag-config/keys/`。

## 常见操作

```bash
docker compose logs -f app
docker compose logs -f gateway
docker compose ps
docker compose down          # 保留数据卷
docker compose down -v       # 删除 Postgres 与配置数据，重新 seed
```

默认 Compose 项目名由文件内的 `name: slipstream` 决定，直接 `docker compose up -d` 即可；不要额外传 `-p`，否则会创建第二套网络与数据卷。

## 注意

- `.env` 不应提交；示例文件只包含占位值。
- 生产环境应设置 `SLIPSTREAM_SEED_DEMO=0`，避免写入演示账号、演示客户端密钥与日志。
- 生产环境应更换所有默认密码，并给 `appdata`、Postgres 卷做备份。
- 真实上游需要可访问的公网/内网地址；数据面容器与上游之间的 TLS 证书由控制台配置的 `tls.root` 提供。
- 若只验证控制面，可先不配置数据面；`gateway` 会保持等待状态，不影响管理台。
- 已知限制：`/admin/config/status` 的 `listening` 字段对真实 agentgateway 适配器目前恒为 false（SPI 的 status 未设置 listening）；配置是否生效应以 `config_hash` 与 `active_revision` 为准，不影响数据面。
