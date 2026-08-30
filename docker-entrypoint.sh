#!/bin/sh
# 统一入口：未设置 DB 时（all-in-one 镜像）自动启动内嵌 PostgreSQL，
# 否则使用外部数据库。后端与 Caddy 通过 Unix socket 直连。
set -e

PG_PID=""
SERVER_PID=""
CADDY_PID=""

cleanup() {
    echo "→ 正在关闭服务..."
    [ -n "$CADDY_PID" ] && kill "$CADDY_PID" 2>/dev/null || true
    [ -n "$SERVER_PID" ] && kill "$SERVER_PID" 2>/dev/null || true
    [ -n "$PG_PID" ] && kill "$PG_PID" 2>/dev/null || true
    wait 2>/dev/null || true
    echo "→ 关闭完成。"
    exit 0
}
trap cleanup INT TERM

monitor_processes() {
    while true; do
        for pid_name in PG_PID SERVER_PID CADDY_PID; do
            pid=$(eval echo \$$pid_name)
            if [ -n "$pid" ] && ! kill -0 "$pid" 2>/dev/null; then
                echo "→ 进程 $pid_name (pid=$pid) 异常退出，正在关闭容器..."
                cleanup
            fi
        done
        sleep 2
    done
}

# ---------------------------------------------------------------
# 1. 可选：初始化并启动内嵌 PostgreSQL（仅当未提供 DB 时）
# ---------------------------------------------------------------
if [ -z "${DB:-}" ] && [ -z "${OMMB_DATABASE_DSN:-}" ]; then
    echo "→ 未设置 DB，启动内嵌 PostgreSQL..."
    POSTGRES_USER="${POSTGRES_USER:-ommb}"
    POSTGRES_PASSWORD="${POSTGRES_PASSWORD:-ommb}"
    POSTGRES_DB="${POSTGRES_DB:-ommb}"
    PGDATA="${PGDATA:-/var/lib/postgresql/data}"

    PG_BIN=""
    for ver in 18 17 16 15; do
        if [ -x "/usr/libexec/postgresql${ver}/initdb" ]; then
            PG_BIN="/usr/libexec/postgresql${ver}"
            break
        fi
    done
    [ -z "$PG_BIN" ] && { echo "ERROR: 未找到 PostgreSQL 二进制"; exit 1; }

    if [ ! -f "$PGDATA/PG_VERSION" ]; then
        echo "→ 初始化数据目录..."
        mkdir -p "$PGDATA"
        chown -R postgres:postgres "$PGDATA"
        su-exec postgres "$PG_BIN/initdb" -D "$PGDATA" --auth-host=md5 --auth-local=trust
        echo "listen_addresses = ''" >> "$PGDATA/postgresql.conf"
        echo "unix_socket_directories = '/run/postgresql'" >> "$PGDATA/postgresql.conf"
        su-exec postgres "$PG_BIN/postgres" --single -D "$PGDATA" postgres <<SQL
CREATE USER $POSTGRES_USER WITH PASSWORD '$POSTGRES_PASSWORD';
CREATE DATABASE $POSTGRES_DB OWNER $POSTGRES_USER;
SQL
    fi

    mkdir -p /run/postgresql
    chown postgres:postgres /run/postgresql
    echo "→ 启动 PostgreSQL..."
    su-exec postgres "$PG_BIN/postgres" -D "$PGDATA" &
    PG_PID=$!

    echo "→ 等待 PostgreSQL 就绪..."
    for i in $(seq 1 30); do
        su-exec postgres "$PG_BIN/pg_isready" -q 2>/dev/null && break
        kill -0 "$PG_PID" 2>/dev/null || { echo "→ PostgreSQL 启动失败"; exit 1; }
        sleep 1
    done

    export DB="postgres://${POSTGRES_USER}:${POSTGRES_PASSWORD}@/${POSTGRES_DB}?host=/run/postgresql&sslmode=disable"
else
    echo "→ 使用外部数据库。"
fi

# ---------------------------------------------------------------
# 2. 启动 Go 后端（与 Caddy 通过 Unix socket 直连）
# ---------------------------------------------------------------
export OMMB_SERVER_SOCKET="${OMMB_SERVER_SOCKET:-/var/run/ommb/server.sock}"
mkdir -p "$(dirname "$OMMB_SERVER_SOCKET")"

echo "→ 启动后端..."
/usr/local/bin/server &
SERVER_PID=$!

# ---------------------------------------------------------------
# 3. 启动 Caddy
# ---------------------------------------------------------------
echo "→ 启动 Caddy..."
caddy run --config /etc/caddy/Caddyfile --adapter caddyfile &
CADDY_PID=$!

monitor_processes
