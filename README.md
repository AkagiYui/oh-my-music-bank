# Oh My Music Bank

自定义音源系统：管理员上传音频，系统自动解析信息并写库、上传至对象存储；用户凭 API Key 检索音乐与获取播放地址。

- 后端：Go 1.26 + Gin + GORM + goose（启动时自动迁移）
- 前端：SolidJS + TanStack Router（文件式路由）+ Vite + Tailwind v4 + Kobalte（纯 SPA）
- 存储：PostgreSQL + S3 兼容对象存储（如雨云 RainS3）
- 音频解析：`dhowden/tag`（内嵌标签）+ `ffprobe`（技术参数）

## 目录结构

```
schema.sql                      # 修订后的完整参考 schema（人工查阅/手动初始化）
cmd/server/                     # 服务入口
internal/
  config/                       # 配置加载（env > config.yaml > 默认值）
  storage/db/                   # GORM 连接 + goose 迁移（//go:embed）
  storage/db/migrations/        # 版本化 SQL 迁移（数据库自动更新的来源）
  storage/objectstore/          # S3 兼容对象存储封装
  service/audiometa/            # 音频元数据解析（tag + ffprobe）
  service/cache/                # 站点设置缓存
  model/ middleware/ handler/ router/
pkg/                            # response / errors / keys / idgen
web/                            # SolidJS SPA（独立 pnpm 项目）
Containerfile Caddyfile docker-entrypoint.sh docker-compose.yml
.github/workflows/build.yml     # CI：构建检查 + 镜像构建推送
```

## 本地开发

### 后端

```bash
cp .env.example .env        # 填入 DB / S3_* / FILE_PREFIX / JWT_SECRET
go run ./cmd/server         # 启动时自动执行 goose 迁移，监听 :9111
```

数据库结构由 `internal/storage/db/migrations` 下的 goose 迁移维护，**服务启动时自动应用**
（带 advisory lock 防多实例并发）。改表请新增迁移文件，勿用 GORM AutoMigrate。

### 前端

```bash
cd web
pnpm install
pnpm dev                    # 监听 :5173，/api 代理到 :9111
```

## 接口概览

开放接口（API Key 鉴权，请求头 `X-API-Key: omb_…` 或 `Authorization: Bearer omb_…`）：

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/open/v1/search?q=` | 按标题/别名搜索可用曲目 |
| GET | `/api/open/v1/tracks/{id}` | 曲目详情 + 各音质音频地址 |

管理与账户接口（JWT 鉴权，`/api/v1/...`）：注册/登录/刷新、API Key 自助管理、
管理员的用户管理、曲目管理、音频上传（`POST /api/v1/admin/audio/upload`，multipart `file`）。

首个注册的账号自动成为管理员。

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
