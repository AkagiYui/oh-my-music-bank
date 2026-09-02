-- +goose Up
-- 初始化全部表结构。与仓库根 schema.sql 内容保持一致。
-- 扩展：gen_random_uuid() 用于 UUID 主键，pg_trgm 用于模糊搜索。
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ---------- 用户体系 ----------
CREATE TABLE IF NOT EXISTS "app_user" (
    "id"            uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
    "created_at"    timestamptz  NOT NULL DEFAULT now(),
    "updated_at"    timestamptz  NOT NULL DEFAULT now(),
    "username"      varchar(64)  NOT NULL,
    "email"         varchar(255) NOT NULL,
    "password_hash" varchar(255) NOT NULL,
    "role"          varchar(16)  NOT NULL DEFAULT 'user',
    "is_active"     boolean      NOT NULL DEFAULT true
);
COMMENT ON TABLE  "app_user"             IS '系统用户';
COMMENT ON COLUMN "app_user"."role"      IS '角色：admin / user';
COMMENT ON COLUMN "app_user"."is_active" IS '账号是否启用，禁用后无法登录';
CREATE UNIQUE INDEX IF NOT EXISTS "idx_app_user_username" ON "app_user" ("username");
CREATE UNIQUE INDEX IF NOT EXISTS "idx_app_user_email"    ON "app_user" ("email");

CREATE TABLE IF NOT EXISTS "api_key" (
    "id"           uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
    "created_at"   timestamptz  NOT NULL DEFAULT now(),
    "updated_at"   timestamptz  NOT NULL DEFAULT now(),
    "user_id"      uuid         NOT NULL REFERENCES "app_user"("id") ON DELETE CASCADE,
    "name"         varchar(128) NOT NULL DEFAULT '',
    "key_hash"     char(64)     NOT NULL,
    "key_prefix"   varchar(20)  NOT NULL,
    "description"  text         NOT NULL DEFAULT '',
    "rpm_override" int,
    "expires_at"   timestamptz,
    "last_used_at" timestamptz,
    "is_revoked"   boolean      NOT NULL DEFAULT false
);
COMMENT ON TABLE  "api_key"              IS 'API 密钥，用户访问开放接口的凭证';
COMMENT ON COLUMN "api_key"."key_hash"   IS '密钥 SHA-256（hex），不存明文';
COMMENT ON COLUMN "api_key"."key_prefix" IS '密钥前缀，可公开，用于展示与定位';
CREATE UNIQUE INDEX IF NOT EXISTS "idx_api_key_key_hash" ON "api_key" ("key_hash");
CREATE INDEX        IF NOT EXISTS "idx_api_key_user_id"  ON "api_key" ("user_id");
CREATE INDEX        IF NOT EXISTS "idx_api_key_prefix"   ON "api_key" ("key_prefix");

CREATE TABLE IF NOT EXISTS "api_request_log" (
    "id"          bigserial    PRIMARY KEY,
    "created_at"  timestamptz  NOT NULL DEFAULT now(),
    "api_key_id"  uuid,
    "user_id"     uuid,
    "path"        varchar(255) NOT NULL,
    "track_id"    bigint,
    "status_code" int          NOT NULL,
    "latency_ms"  int          NOT NULL DEFAULT 0,
    "client_ip"   varchar(45)
);
COMMENT ON TABLE "api_request_log" IS 'API 调用日志，用于审计、限流与用量统计';
CREATE INDEX IF NOT EXISTS "idx_api_request_log_created_at" ON "api_request_log" ("created_at");
CREATE INDEX IF NOT EXISTS "idx_api_request_log_api_key_id" ON "api_request_log" ("api_key_id", "created_at");

CREATE TABLE IF NOT EXISTS "settings" (
    "key"   varchar(128) PRIMARY KEY,
    "value" text         NOT NULL
);
COMMENT ON TABLE "settings" IS '运行时键值设置';

-- ---------- 音乐目录 ----------
CREATE TABLE IF NOT EXISTS "artist" (
    "id"         bigint       PRIMARY KEY,
    "created_at" timestamptz  NOT NULL DEFAULT now(),
    "updated_at" timestamptz  NOT NULL DEFAULT now(),
    "name"       varchar(255) NOT NULL,
    "avatar_key" varchar(255)
);
COMMENT ON TABLE "artist" IS '艺术家';
CREATE INDEX IF NOT EXISTS "idx_artist_name_trgm" ON "artist" USING gin ("name" gin_trgm_ops);

CREATE TABLE IF NOT EXISTS "artist_aliases" (
    "id"        bigserial    PRIMARY KEY,
    "artist_id" bigint       NOT NULL REFERENCES "artist"("id") ON DELETE CASCADE,
    "alias"     varchar(255) NOT NULL
);
COMMENT ON TABLE "artist_aliases" IS '艺术家别名';
CREATE UNIQUE INDEX IF NOT EXISTS "idx_artist_aliases_artist_alias" ON "artist_aliases" ("artist_id", "alias");
CREATE INDEX        IF NOT EXISTS "idx_artist_aliases_alias_trgm"    ON "artist_aliases" USING gin ("alias" gin_trgm_ops);

CREATE TABLE IF NOT EXISTS "album" (
    "id"         bigserial    PRIMARY KEY,
    "created_at" timestamptz  NOT NULL DEFAULT now(),
    "updated_at" timestamptz  NOT NULL DEFAULT now(),
    "title"      varchar(255) NOT NULL,
    "cover_key"  varchar(255)
);
COMMENT ON TABLE "album" IS '专辑';

CREATE TABLE IF NOT EXISTS "artist_albums" (
    "id"        bigserial PRIMARY KEY,
    "artist_id" bigint    NOT NULL REFERENCES "artist"("id") ON DELETE CASCADE,
    "album_id"  bigint    NOT NULL REFERENCES "album"("id")  ON DELETE CASCADE
);
COMMENT ON TABLE "artist_albums" IS '艺术家-专辑关联';
CREATE UNIQUE INDEX IF NOT EXISTS "idx_artist_albums_pair"  ON "artist_albums" ("artist_id", "album_id");
CREATE INDEX        IF NOT EXISTS "idx_artist_albums_album" ON "artist_albums" ("album_id");

CREATE TABLE IF NOT EXISTS "language" (
    "id"   serial       PRIMARY KEY,
    "name" varchar(255) NOT NULL UNIQUE
);
COMMENT ON TABLE "language" IS '语种';

CREATE TABLE IF NOT EXISTS "live" (
    "id"         bigserial    PRIMARY KEY,
    "created_at" timestamptz  NOT NULL DEFAULT now(),
    "updated_at" timestamptz  NOT NULL DEFAULT now(),
    "title"      varchar(255) NOT NULL,
    "time"       timestamptz  NOT NULL
);
COMMENT ON TABLE "live" IS '演唱会';

CREATE TABLE IF NOT EXISTS "track" (
    "id"         bigint       PRIMARY KEY,
    "created_at" timestamptz  NOT NULL DEFAULT now(),
    "updated_at" timestamptz  NOT NULL DEFAULT now(),
    "title"      varchar(255) NOT NULL,
    "duration"   int          NOT NULL DEFAULT 0,
    "lyric"      text,
    "lrc_lyric"  text,
    "cover_key"  varchar(255),
    "available"  boolean      NOT NULL DEFAULT true,
    "live_id"    bigint       REFERENCES "live"("id") ON DELETE SET NULL
);
COMMENT ON TABLE  "track"             IS '歌曲';
COMMENT ON COLUMN "track"."available" IS '是否可被搜索';
COMMENT ON COLUMN "track"."live_id"   IS '演唱会 id，非空表示属于某个演唱会';
CREATE INDEX IF NOT EXISTS "idx_track_live_id"    ON "track" ("live_id");
CREATE INDEX IF NOT EXISTS "idx_track_title_trgm" ON "track" USING gin ("title" gin_trgm_ops) WHERE "available";

CREATE TABLE IF NOT EXISTS "track_aliases" (
    "id"       bigserial    PRIMARY KEY,
    "track_id" bigint       NOT NULL REFERENCES "track"("id") ON DELETE CASCADE,
    "alias"    varchar(255) NOT NULL
);
COMMENT ON TABLE "track_aliases" IS '歌曲别名';
CREATE UNIQUE INDEX IF NOT EXISTS "idx_track_aliases_track_alias" ON "track_aliases" ("track_id", "alias");
CREATE INDEX        IF NOT EXISTS "idx_track_aliases_alias_trgm"   ON "track_aliases" USING gin ("alias" gin_trgm_ops);

CREATE TABLE IF NOT EXISTS "track_artists" (
    "id"        bigserial PRIMARY KEY,
    "track_id"  bigint    NOT NULL REFERENCES "track"("id")  ON DELETE CASCADE,
    "artist_id" bigint    NOT NULL REFERENCES "artist"("id") ON DELETE CASCADE,
    "position"  int       NOT NULL DEFAULT 0
);
COMMENT ON TABLE  "track_artists"            IS '歌曲-艺术家关联';
COMMENT ON COLUMN "track_artists"."position" IS '艺术家展示顺序，0 为主唱';
CREATE UNIQUE INDEX IF NOT EXISTS "idx_track_artists_pair"   ON "track_artists" ("track_id", "artist_id");
CREATE INDEX        IF NOT EXISTS "idx_track_artists_artist" ON "track_artists" ("artist_id");

CREATE TABLE IF NOT EXISTS "track_albums" (
    "id"       bigserial PRIMARY KEY,
    "track_id" bigint    NOT NULL REFERENCES "track"("id") ON DELETE CASCADE,
    "album_id" bigint    NOT NULL REFERENCES "album"("id") ON DELETE CASCADE,
    "track_no" int,
    "disc_no"  int
);
COMMENT ON TABLE "track_albums" IS '歌曲-专辑关联';
CREATE UNIQUE INDEX IF NOT EXISTS "idx_track_albums_pair"  ON "track_albums" ("track_id", "album_id");
CREATE INDEX        IF NOT EXISTS "idx_track_albums_album" ON "track_albums" ("album_id");

CREATE TABLE IF NOT EXISTS "track_languages" (
    "id"          bigserial PRIMARY KEY,
    "track_id"    bigint    NOT NULL REFERENCES "track"("id")    ON DELETE CASCADE,
    "language_id" int       NOT NULL REFERENCES "language"("id") ON DELETE CASCADE
);
COMMENT ON TABLE "track_languages" IS '歌曲-语种关联';
CREATE UNIQUE INDEX IF NOT EXISTS "idx_track_languages_pair" ON "track_languages" ("track_id", "language_id");
CREATE INDEX        IF NOT EXISTS "idx_track_languages_lang" ON "track_languages" ("language_id");

CREATE TABLE IF NOT EXISTS "live_artists" (
    "id"        bigserial    PRIMARY KEY,
    "live_id"   bigint       NOT NULL REFERENCES "live"("id")   ON DELETE CASCADE,
    "artist_id" bigint       NOT NULL REFERENCES "artist"("id") ON DELETE CASCADE,
    "role"      varchar(255)
);
COMMENT ON TABLE "live_artists" IS '演唱会-艺术家关联';
CREATE UNIQUE INDEX IF NOT EXISTS "idx_live_artists_pair"   ON "live_artists" ("live_id", "artist_id");
CREATE INDEX        IF NOT EXISTS "idx_live_artists_artist" ON "live_artists" ("artist_id");

-- ---------- 音频 ----------
CREATE TABLE IF NOT EXISTS "origin_audio" (
    "id"            uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
    "created_at"    timestamptz  NOT NULL DEFAULT now(),
    "updated_at"    timestamptz  NOT NULL DEFAULT now(),
    "track_id"      bigint       NOT NULL REFERENCES "track"("id") ON DELETE CASCADE,
    "size"          bigint       NOT NULL,
    "file_key"      varchar(255) NOT NULL,
    "hash"          char(64)     NOT NULL UNIQUE,
    "duration"      int          NOT NULL,
    "bitrate"       int          NOT NULL,
    "channel_count" int          NOT NULL,
    "sampling_rate" int          NOT NULL,
    "bit_depth"     int          NOT NULL,
    "format"        varchar(255) NOT NULL,
    "encoder"       varchar(255) NOT NULL,
    "status"        varchar(16)  NOT NULL DEFAULT 'pending',
    "error_message" text
);
COMMENT ON TABLE  "origin_audio"          IS '原始音频，管理员上传的源文件';
COMMENT ON COLUMN "origin_audio"."status" IS '处理状态：pending/processing/ready/failed';
CREATE INDEX IF NOT EXISTS "idx_origin_audio_track" ON "origin_audio" ("track_id");

CREATE TABLE IF NOT EXISTS "audio" (
    "id"            uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
    "created_at"    timestamptz  NOT NULL DEFAULT now(),
    "updated_at"    timestamptz  NOT NULL DEFAULT now(),
    "track_id"      bigint       NOT NULL REFERENCES "track"("id") ON DELETE CASCADE,
    "size"          bigint       NOT NULL,
    "file_key"      varchar(255) NOT NULL,
    "hash"          char(64)     NOT NULL,
    "duration"      int          NOT NULL,
    "bitrate"       int          NOT NULL,
    "channel_count" int          NOT NULL,
    "sampling_rate" int          NOT NULL,
    "bit_depth"     int          NOT NULL,
    "format"        varchar(255) NOT NULL,
    "encoder"       varchar(255) NOT NULL,
    "has_lyric"     boolean      NOT NULL DEFAULT false,
    "has_cover"     boolean      NOT NULL DEFAULT false,
    "quality_label" varchar(64)  NOT NULL DEFAULT 'standard',
    "is_dirty"      boolean      NOT NULL DEFAULT false,
    "source"        varchar(255)
);
COMMENT ON TABLE  "audio"                 IS '用于分发的音频';
COMMENT ON COLUMN "audio"."quality_label" IS '音质档位，如 standard/high/lossless';
COMMENT ON COLUMN "audio"."is_dirty"      IS '脏数据标记，true 表示需要重新生成';
COMMENT ON COLUMN "audio"."source"        IS '收录来源';
CREATE INDEX        IF NOT EXISTS "idx_audio_track"         ON "audio" ("track_id");
CREATE UNIQUE INDEX IF NOT EXISTS "idx_audio_track_quality" ON "audio" ("track_id", "quality_label");

-- +goose Down
DROP TABLE IF EXISTS "audio";
DROP TABLE IF EXISTS "origin_audio";
DROP TABLE IF EXISTS "live_artists";
DROP TABLE IF EXISTS "track_languages";
DROP TABLE IF EXISTS "track_albums";
DROP TABLE IF EXISTS "track_artists";
DROP TABLE IF EXISTS "track_aliases";
DROP TABLE IF EXISTS "track";
DROP TABLE IF EXISTS "live";
DROP TABLE IF EXISTS "language";
DROP TABLE IF EXISTS "artist_albums";
DROP TABLE IF EXISTS "album";
DROP TABLE IF EXISTS "artist_aliases";
DROP TABLE IF EXISTS "artist";
DROP TABLE IF EXISTS "settings";
DROP TABLE IF EXISTS "api_request_log";
DROP TABLE IF EXISTS "api_key";
DROP TABLE IF EXISTS "app_user";
