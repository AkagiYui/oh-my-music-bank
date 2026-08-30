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

# ---- Stage 1: 构建前端（SolidJS SPA）----
FROM node:lts-alpine AS frontend-builder
WORKDIR /app/web
RUN corepack enable
COPY web/package.json web/pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY web/ .
RUN pnpm build

# ---- Stage 2: 构建 Go 后端 ----
FROM golang:1.26-alpine AS backend-builder
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
