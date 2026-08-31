# Oh My Music Bank

自定义音源系统：管理员上传音频，系统自动解析信息并写库、上传至对象存储；用户凭 API Key 检索音乐与获取播放地址。

- 后端：Go 1.27 + Gin + GORM + goose（启动时自动迁移）
- 前端：React + TanStack Router（文件式路由）+ Vite+ + Tailwind v4 + shadcn/ui（纯 SPA）
- 存储：PostgreSQL + S3 兼容对象存储（如雨云 RainS3）
- 音频解析：`dhowden/tag`（内嵌标签）+ `ffprobe`（技术参数）

## 目录结构

```
schema.sql                      # 修订后的完整参考 schema（人工查阅/手动初始化）
cmd/server/                     # 服务入口
cmd/cli/                        # 维护命令行工具（ommb）
internal/
  config/                       # 配置加载（env > config.yaml > 默认值）
  storage/db/                   # GORM 连接 + goose 迁移（//go:embed）
  storage/db/migrations/        # 版本化 SQL 迁移（数据库自动更新的来源）
  storage/objectstore/          # S3 兼容对象存储封装
  service/audiometa/            # 音频元数据解析（tag + ffprobe）
  service/cache/                # 站点设置缓存
  model/ middleware/ handler/ router/
pkg/                            # response / errors / keys / idgen
web/                            # React SPA（独立 Vite+ 项目）
Containerfile Caddyfile docker-entrypoint.sh docker-compose.yml
.github/workflows/build.yml     # CI：构建检查 + 镜像构建推送
```

## 本地开发

安装 Go 1.27+ 和 Vite+（`vp`），并准备 PostgreSQL 与 S3 兼容对象存储。
首次开发时，在仓库根目录执行：

```bash
cp .env.example .env        # 填入 DB / S3_* / FILE_PREFIX，JWT_SECRET 至少 32 字节
vp -C web install --frozen-lockfile
```

运行 `openssl rand -hex 32` 生成随机密钥，将结果填入 `.env` 的 `JWT_SECRET`。
已有 `.env` 也需要检查这一项；未设置或不足 32 字节时，后端会拒绝启动。
密钥应持久保存，修改后需要重新登录。不要将 `.env` 提交到仓库。

之后只需一个命令，同时启动前后端：

```bash
vp -C web run dev
```

在 `web/` 目录下可直接执行 `vp run dev`。访问 `http://localhost:5173`，
前端的 `/api` 和 `/health` 请求代理到后端 `:9111`。前端保留热更新，
后端通过 Air 在 Go 代码、SQL 迁移或配置变化时自动重新编译并重启。
按 `Ctrl+C` 结束开发任务。首次运行会由 Go 下载固定版本的 Air，无需额外全局安装。

启动任务统一维护在 `web/vite.config.ts`，直接复用 `.air.toml.example`，无需复制配置。
`vp dev` 是 Vite+ 内置的前端开发命令；同时启动两端请使用 `vp run dev`。
需要分别调试时，可使用 `vp -C web dev`（仅前端）或 `vp -C web run dev:api`（仅后端）。
如果修改后端监听端口，也需要同步调整 `web/vite.config.ts` 中的代理目标。

数据库结构由 `internal/storage/db/migrations` 下的 goose 迁移维护，**服务启动时自动应用**
（带 advisory lock 防多实例并发）。改表请新增迁移文件，勿用 GORM AutoMigrate。

## 接口概览

开放接口（API Key 鉴权，请求头 `X-API-Key: omb_…` 或 `Authorization: Bearer omb_…`）：

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/open/v1/search?q=` | 按标题/别名搜索可用曲目 |
| GET | `/api/open/v1/tracks/{id}` | 曲目详情 + 各音质音频地址 |

管理与账户接口（JWT 鉴权，`/api/v1/...`）：注册/登录/刷新、API Key 自助管理、
管理员的用户管理、曲目管理、音频上传（`POST /api/v1/admin/audio/upload`，multipart `file`）。

首个注册的账号自动成为管理员。

## 重置忘记的密码

服务器维护者可以通过 `cmd/cli` 提供的 `reset-password` action，按注册邮箱重置任意账号的密码：

```bash
go run ./cmd/cli reset-password --email admin@example.com
```

命令会隐藏输入，要求输入并确认新密码（至少 8 个字符、最多 72 字节）。
无需旧密码；成功后撤销该用户的全部登录会话，原有访问令牌和刷新令牌失效。
账号角色、启用状态、音乐及 API Key 保持不变；禁用的账号重置后仍需管理员启用。

工具复用服务端的数据库配置来源：环境变量 > `config.yaml` > 默认值，
同时加载**当前工作目录**的 `.env`；只需数据库配置，不依赖 JWT 密钥或 S3。
可用 `--config /path/to/config.yaml` 指定配置文件，但不会改变 `.env` 的查找目录。
执行前请确认指向正确的数据库。工具不会创建用户或自动执行数据库迁移，
应对已由服务端完成迁移的数据库运行；任何一步写入失败均在同一事务内回滚。

镜像内置 `ommb` 命令。使用外部数据库的 Compose 部署在更新镜像后可直接执行：

```bash
docker compose exec app ommb reset-password --email admin@example.com
```

使用 all-in-one 镜像时，`docker exec` 不会继承入口脚本临时导出的 `DB`，
需显式提供指向内嵌 PostgreSQL 的数据库配置（Unix socket 为 `/run/postgresql`）。

自动化场景可加 `--password-stdin` 从标准输入读取单行密码（读取到 EOF，允许末尾 LF/CRLF），
此模式不做二次确认。请通过权限受限的文件或秘密管理工具提供输入，
不要把明文密码写进命令参数、shell 历史或提交到仓库。例如：

```bash
go run ./cmd/cli reset-password --email admin@example.com --password-stdin < /secure/new-password
go run ./cmd/cli --help
go run ./cmd/cli reset-password --help
```

## 部署

```bash
# 外部数据库 + 外部对象存储（推荐）
docker compose up -d --build
# 或
docker build --target external-db -t oh-my-music-bank .
docker run -d --env-file .env -p 8080:80 oh-my-music-bank
```

镜像内置 Caddy 托管前端并反代 API；`all-in-one` 目标额外内嵌 PostgreSQL，适合单机体验。

## 约定

见 [AGENTS.md](AGENTS.md)。原始数据库设计的评审与修订记录见 `schema.sql` 顶部注释。
