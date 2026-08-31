-- +goose Up
CREATE TABLE bilibili_account (
    id TEXT PRIMARY KEY,
    mid TEXT UNIQUE,
    name TEXT NOT NULL DEFAULT '',
    avatar TEXT NOT NULL DEFAULT '',
    cookie TEXT NOT NULL,
    refresh_token TEXT NOT NULL DEFAULT '',
    pending_refresh_token TEXT NOT NULL DEFAULT '',
    is_default BOOLEAN NOT NULL DEFAULT FALSE,
    status TEXT NOT NULL DEFAULT 'unchecked' CHECK (status IN ('unchecked', 'active', 'expired')),
    last_checked_at TIMESTAMPTZ,
    last_refreshed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX bilibili_account_one_default ON bilibili_account (is_default) WHERE is_default;

CREATE TABLE bilibili_login (
    id TEXT PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
    qr_key TEXT NOT NULL,
    account_id TEXT REFERENCES bilibili_account(id) ON DELETE SET NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    last_poll_at TIMESTAMPTZ
);
CREATE INDEX bilibili_login_expiry ON bilibili_login (expires_at);

-- 保留旧 Cookie 的使用能力；缺少刷新凭据时提示用户重新扫码，不伪造刷新令牌。
INSERT INTO bilibili_account (id, mid, name, cookie, is_default)
SELECT 'legacy', NULLIF(substring(value FROM '(?:^|;\s*)DedeUserID=([0-9]+)'), ''),
       '原有导入账号', value, TRUE FROM settings WHERE key = 'bilibili.cookie' AND value <> '';
DELETE FROM settings WHERE key = 'bilibili.cookie';

-- 升级前排队的任务也固定原账号；即使没有旧凭据，也不能悄悄借用以后添加的账号。
UPDATE ingest_job SET payload = jsonb_set(payload::jsonb, '{accountId}', '"legacy"')::text
WHERE kind = 'bilibili' AND COALESCE(payload::jsonb ->> 'accountId', '') = '';

-- +goose Down
-- 回滚只恢复默认账号；多账号数据应在回滚前备份。
INSERT INTO settings (key, value)
SELECT 'bilibili.cookie', cookie FROM bilibili_account WHERE is_default
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
DROP TABLE bilibili_login;
DROP TABLE bilibili_account;
