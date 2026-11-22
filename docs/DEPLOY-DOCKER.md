# Docker 部署（控制面 + PostgreSQL + agentgateway）

这是一套从 **git clone 后直接启动** 的部署形态：

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
# 至少改 POSTGRES_PASSWORD、SLIPSTREAM_ADMIN_PASSWORD
docker compose up -d --build
curl http://127.0.0.1:3700/admin/health
```

打开 `http://127.0.0.1:3700`，使用 `.env` 中的管理员账号登录。首次部署的演示账号密码默认 `admin12345`；生产环境必须改掉。

## 验证 Postgres

```bash
docker compose exec db psql -U slipstream -d slipstream -c '\dt'
docker compose exec db psql -U slipstream -d slipstream -c 'select count(*) from users;'
```

控制面日志里不应再出现 SQLite 路径；`/admin/health` 应返回 `{"status":"ok",...}`。

## 数据面

控制台保存并下发配置后，`gateway` 容器会读取 `appdata` 卷里的 `config.yaml` 并启动 3600 数据面。真实客户端请求打到 `http://<host>:3600`；上游密钥在控制台配置。

## 常见操作

```bash
docker compose logs -f app
docker compose ps
docker compose down          # 保留数据卷
docker compose down -v       # 删除 Postgres 与配置数据，重新 seed
```

## 注意

- `.env` 不应提交；示例文件只包含占位值。
- 生产环境应更换所有默认密码，并给 `appdata`、Postgres 卷做备份。
- 真实上游需要可访问的公网/内网地址；数据面容器与上游之间的 TLS 证书由控制台配置的 `tls.root` 提供。
- 若只验证控制面，可先不配置数据面；`gateway` 会保持等待状态，不影响管理台。
