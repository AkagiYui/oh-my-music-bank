# =============================================================================
# Oh My Music Bank - 统一 Containerfile
#
# 通过 --target 选择构建目标：
#   external-db — 使用外部数据库与对象存储（默认，适合生产）
#   all-in-one  — 额外内嵌 PostgreSQL，适合单机快速体验
#
# 示例：
#   docker build --target external-db -t oh-my-music-bank:external-db .
#   docker build --target all-in-one  -t oh-my-music-bank:all-in-one  .
# =============================================================================

# ---- Stage 1: 使用固定版本 Vite+ 构建 React SPA ----
FROM ghcr.io/voidzero-dev/vite-plus:0.3.0@sha256:bca24ac970b21298430ad281f306dbe0a17be3fd1d6c9ec5f2cc73da65740b88 AS frontend-builder
WORKDIR /app/web
# pnpm 的工具链别名位于 workspace 配置中，必须与锁文件一起复制。
COPY --chown=vp:vp web/package.json web/pnpm-lock.yaml web/pnpm-workspace.yaml ./
RUN vp install --frozen-lockfile
COPY --chown=vp:vp web/ .
RUN vp build

# ---- Stage 2: 构建 Go 后端 ----
FROM golang:1.27-alpine AS backend-builder
WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download
COPY cmd/ ./cmd/
COPY internal/ ./internal/
COPY pkg/ ./pkg/
RUN CGO_ENABLED=0 go build -o /app/server ./cmd/server

# ---- Stage 3a: External DB（外部数据库 + 外部对象存储）----
FROM alpine:3 AS external-db
# ffmpeg 提供 ffprobe，用于解析音频技术参数。
RUN apk add --no-cache caddy ca-certificates tzdata ffmpeg bash
COPY --from=frontend-builder /app/web/dist /usr/share/caddy
COPY --from=backend-builder /app/server /usr/local/bin/server
COPY Caddyfile /etc/caddy/Caddyfile
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh
EXPOSE 80
ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]

# ---- Stage 3b: All-in-One（内嵌 PostgreSQL）----
FROM alpine:3 AS all-in-one
RUN apk add --no-cache \
    postgresql18 postgresql18-contrib \
    caddy ca-certificates tzdata ffmpeg su-exec bash
COPY --from=frontend-builder /app/web/dist /usr/share/caddy
COPY --from=backend-builder /app/server /usr/local/bin/server
COPY Caddyfile /etc/caddy/Caddyfile
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh
EXPOSE 80
ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
