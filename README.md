# Oh My Music Bank

自定义音源系统：管理员上传音频，系统自动解析信息并写库、上传至对象存储；用户凭 API Key 检索音乐与获取播放地址。

- 后端：Go 1.27 + Gin + GORM + goose（启动时自动迁移）
- 前端：React + TanStack Router（文件式路由）+ Vite+ + Tailwind v4 + shadcn/ui（纯 SPA）
- 存储：PostgreSQL + S3 兼容对象存储（如雨云 RainS3）
- 音频解析：`dhowden/tag`（内嵌标签）+ `ffprobe`（技术参数）

## 哔哩哔哩账号与 Cookie 刷新

在「系统管理 → 集成配置」点击「扫码添加账号」，使用哔哩哔哩 App 扫码并在手机上确认。
二维码有效期为 3 分钟，过期可重新生成；同一 UID 重复登录会更新已有账号，不会产生重复项。
账号在本站管理员之间共享（不是新增本站用户），可设置默认账号、检查并刷新 Cookie，或从本站移除。
移除仅删除本站保存的凭据，不注销 B 站其他设备；依赖被移除账号的未完成导入任务会失败，不会借用其他账号。

「曲库管理 → 哔哩哔哩导入」可独立选择账号。收藏夹、视频解析、识曲、预览和新任务均绑定所选账号；
切换账号会清空当前选择和裁剪内容，已提交任务保持原账号。无需新增启动配置，仍使用 `vp -C web run dev`。

服务启动时及每小时巡检所有可刷新账号，每个账号每 12 小时检查一次，使用前也会按同样周期检查。
「检查并刷新」可立即检查；只有 B 站返回需要刷新时才轮换 Cookie。
新 Cookie 和 refresh_token 在数据库事务提交后才确认旧凭据失效；确认失败会记录待确认状态并自动重试。
网络错误保留原凭据，明确的登录失效会提示重新扫码。第三方登录接口可能受 B 站风控或协议调整影响。

升级会自动执行 `00007_bilibili_accounts.sql`，保留旧 `bilibili.cookie` 为「原有导入账号」，并固定旧任务的账号引用。
旧配置没有 refresh_token，无法凭空恢复刷新能力，需重新扫码一次。已知 UID 的旧账号会原位升级。
Cookie、刷新凭据只保存在服务端数据库，不返回前端、不写入账号服务 SQL 日志；请保护数据库和备份的访问权限。
数据库回滚仅能把默认账号恢复为旧单 Cookie 配置，回滚前应备份多账号数据。

实现参考 [PiliPlus 登录模块](https://github.com/bggRGjQaUbCoE/PiliPlus/blob/main/lib/http/login.dart)
及 [按 UID 管理账号](https://github.com/bggRGjQaUbCoE/PiliPlus/blob/main/lib/utils/accounts/account.dart) 的流程，
但使用适合本项目 Web API 的网页扫码协议，而非其 Android HD/TV 签名协议；不收集 B 站密码或短信验证码。
网页刷新算法参考 [Cookie 刷新协议研究](https://github.com/pskdje/bilibili-API-collect/blob/main/docs/login/cookie_refresh.md)。

自动化测试不会读取真实账号凭据。可用 `OMMB_BILI_LIVE=1 go test ./internal/service/bilibili -run TestLiveBilibiliQRSmoke -count=1`
检查真实二维码生成与未扫码轮询（不输出二维码密钥、不完成登录）；登录后 Cookie 轮换仍需用实际扫码账号确认。

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
cp .env.example .env        # 填入 DB / S3_PUBLIC_* / S3_PRIVATE_*，JWT_SECRET 至少 32 字节
vp -C web install --frozen-lockfile
```

运行 `openssl rand -hex 32` 生成随机密钥，将结果填入 `.env` 的 `JWT_SECRET`。
已有 `.env` 也需要检查这一项；未设置或不足 32 字节时，后端会拒绝启动。
密钥应持久保存，修改后需要重新登录。不要将 `.env` 提交到仓库。

对象存储使用两套完全独立的 S3 配置：公共桶仅开放封面对象的匿名读取，私有桶不设匿名策略，
音频播放与原始文件下载由 API 鉴权后按需签发 S3 临时 URL。两个桶各自拥有 endpoint、AK/SK 与桶名，
可位于不同服务商或账号；每套凭据只授予对应桶的列举、读写和删除权限，不要使用管理员凭据。
服务启动时会分别自检两个桶，系统管理概览页展示两桶的脱敏状态。完整策略与切换步骤见
[`docs/object-storage.md`](docs/object-storage.md)。

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

| 方法 | 路径                       | 说明                      |
| ---- | -------------------------- | ------------------------- |
| GET  | `/api/open/v1/search?q=`                    | 按标题/别名搜索可用曲目       |
| GET  | `/api/open/v1/tracks/{id}`                  | 曲目详情与各音质元数据         |
| POST | `/api/open/v1/audios/{id}/playback-url`     | 按需签发私有音频临时播放地址   |

管理与账户接口（JWT 鉴权，`/api/v1/...`）：注册/登录/刷新、API Key 自助管理、
管理员的用户管理、曲目管理、音频上传（`POST /api/v1/admin/audios/upload`，multipart `file`）、
试听签名（`POST /api/v1/admin/audios/{id}/playback-url`）与原始文件下载签名
（`POST /api/v1/admin/origin-audios/{id}/download-url`）。

首个注册的账号自动成为管理员。

前端管理入口分为「曲库管理」（`/music`）与「系统管理」（`/admin`）：前者包含曲目、艺术家、
专辑、上传、哔哩哔哩导入和收录任务；后者包含用户、API Key、调用日志、站点设置及集成凭据。
两者均仅管理员可访问，旧的 `/admin/tracks` 等业务地址会自动跳转至对应曲库页面。

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

## 品牌与公开 API 配置

管理员进入「系统管理 → 站点设置」可编辑系统标题、站点描述、首页标题与描述、Logo、
浏览器图标、页脚文字及链接，以及开放 API 的独立域名。配置保存到 PostgreSQL，
无需重新构建前端；保存成功后当前页面立即生效，其他已打开页面在聚焦或最多约一分钟内刷新。
系统标题与首页标题必填；可选文案、图片和链接留空表示隐藏或恢复默认音符。
所有文案均以纯文本显示，不支持 HTML、脚本或自定义 CSS。

Logo、图标与页脚链接接受 HTTPS 地址或 `/branding/logo.svg` 这样的站点根路径。
资源需预先托管且能公开访问，本功能不上传文件。HTTP 仅用于 localhost / 回环地址本机开发。
系统标题、首页标题、站点描述、首页描述、页脚文字的长度限制分别为 80、120、300、2000、300 字。
页面标题、description、应用名称和 Open Graph 文案随配置及页面切换更新。
本项目仍是纯 SPA；不执行 JavaScript 的抓取器不会获得运行时元数据，不提供 SSR 社交分享预览保证。

API 独立域名填写完整来源，例如 `https://api.example.com:8443`，不包含 `/api`、查询参数、
片段或凭据。留空时由浏览器读取 `window.location.origin`，保留当前协议、域名和端口；
表单显示的占位地址不会写回数据库。独立域名同时用于首页 cURL 示例、搜索和播放地址签发请求。
签发结果是对象存储的短期 HTTPS 地址。登录、管理及公开站点配置接口继续走前端同源的
`/api/v1/...` 反向代理，域名配置错误时仍能进入管理后台修正。

独立 API 域名需由部署者预先完成 DNS、HTTPS 和反向代理，连接到同一后端服务与数据库，
至少放行 `/api/open/v1/*`。跨域搜索与播放签发需允许前端来源的 CORS 请求及
`X-API-Key` 请求头（服务当前已允许无 Cookie 的跨域请求；外层网关也需放行 OPTIONS）。
搜索不会向独立 API 发送网页登录 JWT 或浏览器 Cookie，也不会跟随重定向转发 API Key。
API 域名应直接返回响应；HTTPS 前端不能配置 HTTP API。
品牌设置只保存应用配置，不会自动创建 DNS、证书或网关规则，也不会改变 S3 文件域名。

接口契约：

- `GET /api/v1/site`：无需登录，只返回公开品牌与注册开关，不含日志策略或集成凭据。
- `GET /api/v1/admin/site/settings`：管理员读取完整配置，额外包含数字类型的 `logRetentionDays`。
- `PUT /api/v1/admin/site/settings`：管理员提交完整配置；先统一校验，再事务保存并返回规范化后的完整对象。
  必须提交 GET 返回的所有字段，拒绝缺失或 null，不支持局部更新；可选字符串使用空字符串清空。
  拒绝未知字段与旧 `brandName` 字段，统一使用 `systemTitle`；日志天数不再返回字符串。

迁移 `00005_site_branding.sql` 在服务启动时执行，把已有品牌名迁移到新的配置键并补齐默认值。
前后端应一起部署，不提供旧字段兼容层。已有数据库中的其他设置与凭据保持不变。

默认品牌为「声迹」，首页标题为「每一首喜欢，都值得被找到」，页脚为「音乐不止于聆听。」。
迁移 `00006_default_brand_copy.sql` 为新站点写入整套默认文案；已有站点仅在五项文案仍全部
匹配旧默认值时自动更新，任一文案已自定义则保留整套现有配置。管理员显式清空的可选文案
仍按空值展示，不会在运行时回退为默认文案。


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
