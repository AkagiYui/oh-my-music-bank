-- =============================================================================
-- Oh My Music Bank — 数据库结构（PostgreSQL）
--
-- 本文件是「可直接 psql 执行」的完整参考 schema，已在原始设计基础上修订：
--   1. 去掉所有主键列冗余的 `NOT NULL UNIQUE`（PRIMARY KEY 已隐含）。
--   2. 修复 track_aliases.track_id 的列级 UNIQUE（原设计导致一首歌只能有一个别名）。
--   3. 修复 audio.quality_label 把注释误写成 DEFAULT 的 bug，改为有意义的音质档位。
--   4. 重命名 live_artlists → live_artists、artlist_id → artist_id，并补唯一约束。
--   5. 全表补充 created_at / updated_at 时间戳。
--   6. 歌词字段 varchar(60000) → text。
--   7. 统一 ID 策略：曲目/艺术家为应用层分配的 bigint（雪花 ID，便于跨源去重）；
--      其余内部实体用 bigserial/serial。
--   8. 为外键反向查询补索引；为搜索补 pg_trgm GIN 索引。
--   9. 给曲目相关从表、音频表的外键加 ON DELETE CASCADE，删歌时自动清理。
--  10. 新增用户体系：app_user / api_key / api_request_log / settings。
--
-- 运行期由 internal/storage/db/migrations 下的 goose 迁移自动建表/演进，
-- 本文件与 00001_init_schema.sql 内容保持一致，仅供人工查阅与手动初始化。
-- =============================================================================

-- gen_random_uuid()：用户、API Key 等表的 UUID 主键。
CREATE EXTENSION IF NOT EXISTS pgcrypto;
-- pg_trgm：曲目标题/别名/艺术家名的模糊搜索（GIN 索引）。
CREATE EXTENSION IF NOT EXISTS pg_trgm;


-- =============================================================================
-- 一、用户体系（认证、API Key、调用日志、站点设置）
-- =============================================================================

-- 系统用户：注册登录、角色权限。
CREATE TABLE IF NOT EXISTS "app_user" (
    "id"            uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
    "created_at"    timestamptz  NOT NULL DEFAULT now(),
    "updated_at"    timestamptz  NOT NULL DEFAULT now(),
    "username"      varchar(64)  NOT NULL,
    "email"         varchar(255) NOT NULL,
    "password_hash" varchar(255) NOT NULL,
    -- 角色：admin（可管理音频与用户）/ user（仅能管理自己的 API Key）
    "role"          varchar(16)  NOT NULL DEFAULT 'user',
    "is_active"     boolean      NOT NULL DEFAULT true
);
COMMENT ON TABLE  "app_user"               IS '系统用户';
COMMENT ON COLUMN "app_user"."role"        IS '角色：admin / user';
COMMENT ON COLUMN "app_user"."is_active"   IS '账号是否启用，禁用后无法登录';

CREATE UNIQUE INDEX IF NOT EXISTS "idx_app_user_username" ON "app_user" ("username");
CREATE UNIQUE INDEX IF NOT EXISTS "idx_app_user_email"    ON "app_user" ("email");

-- API Key：用户访问开放接口的凭证。出于安全只存哈希，明文仅在创建时返回一次。
CREATE TABLE IF NOT EXISTS "api_key" (
    "id"           uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
    "created_at"   timestamptz  NOT NULL DEFAULT now(),
    "updated_at"   timestamptz  NOT NULL DEFAULT now(),
    "user_id"      uuid         NOT NULL REFERENCES "app_user"("id") ON DELETE CASCADE,
    "name"         varchar(128) NOT NULL DEFAULT '',
    -- 密钥的 SHA-256（hex），鉴权时对入参做同样哈希后比对，不存明文
    "key_hash"     char(64)     NOT NULL,
    -- 密钥前缀（如 omb_3f9a…），用于管理界面展示与快速定位，可公开
    "key_prefix"   varchar(20)  NOT NULL,
    "description"  text         NOT NULL DEFAULT '',
    -- 每分钟请求数上限，空表示用全局默认
    "rpm_override" int,
    "expires_at"   timestamptz,
    "last_used_at" timestamptz,
    "is_revoked"   boolean      NOT NULL DEFAULT false
);
COMMENT ON TABLE  "api_key"               IS 'API 密钥，用户访问开放接口的凭证';
COMMENT ON COLUMN "api_key"."key_hash"    IS '密钥 SHA-256（hex），不存明文';
COMMENT ON COLUMN "api_key"."key_prefix"  IS '密钥前缀，可公开，用于展示与定位';
COMMENT ON COLUMN "api_key"."rpm_override" IS '每分钟请求数上限，空表示用全局默认';

CREATE UNIQUE INDEX IF NOT EXISTS "idx_api_key_key_hash" ON "api_key" ("key_hash");
CREATE INDEX        IF NOT EXISTS "idx_api_key_user_id"  ON "api_key" ("user_id");
CREATE INDEX        IF NOT EXISTS "idx_api_key_prefix"   ON "api_key" ("key_prefix");

-- API 调用日志：审计、限流与用量统计。
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

-- 运行时设置：注册开关、站点品牌名等可动态读取的键值。
CREATE TABLE IF NOT EXISTS "settings" (
    "key"   varchar(128) PRIMARY KEY,
    "value" text         NOT NULL
);
COMMENT ON TABLE "settings" IS '运行时键值设置';


-- =============================================================================
-- 二、音乐目录（艺术家、专辑、语种、演唱会、曲目及其关联）
-- =============================================================================

-- 艺术家。id 由应用层分配（雪花 ID），便于跨收录来源去重。
CREATE TABLE IF NOT EXISTS "artist" (
    "id"         bigint       PRIMARY KEY,
    "created_at" timestamptz  NOT NULL DEFAULT now(),
    "updated_at" timestamptz  NOT NULL DEFAULT now(),
    "name"       varchar(255) NOT NULL,
    "avatar_key" varchar(255)
);
COMMENT ON TABLE  "artist"             IS '艺术家';
COMMENT ON COLUMN "artist"."avatar_key" IS '头像在对象存储中的 key';

-- 模糊搜索艺术家名
CREATE INDEX IF NOT EXISTS "idx_artist_name_trgm" ON "artist" USING gin ("name" gin_trgm_ops);

-- 艺术家别名（一个艺术家可有多个别名）。
CREATE TABLE IF NOT EXISTS "artist_aliases" (
    "id"        bigserial    PRIMARY KEY,
    "artist_id" bigint       NOT NULL REFERENCES "artist"("id") ON DELETE CASCADE,
    "alias"     varchar(255) NOT NULL
);
COMMENT ON TABLE "artist_aliases" IS '艺术家别名';
CREATE UNIQUE INDEX IF NOT EXISTS "idx_artist_aliases_artist_alias" ON "artist_aliases" ("artist_id", "alias");
CREATE INDEX        IF NOT EXISTS "idx_artist_aliases_alias_trgm"    ON "artist_aliases" USING gin ("alias" gin_trgm_ops);

-- 专辑。
CREATE TABLE IF NOT EXISTS "album" (
    "id"         bigserial    PRIMARY KEY,
    "created_at" timestamptz  NOT NULL DEFAULT now(),
    "updated_at" timestamptz  NOT NULL DEFAULT now(),
    "title"      varchar(255) NOT NULL,
    "cover_key"  varchar(255)
);
COMMENT ON TABLE  "album"            IS '专辑';
COMMENT ON COLUMN "album"."cover_key" IS '封面在对象存储中的 key';

-- 艺术家-专辑（多对多）。
CREATE TABLE IF NOT EXISTS "artist_albums" (
    "id"        bigserial PRIMARY KEY,
    "artist_id" bigint    NOT NULL REFERENCES "artist"("id") ON DELETE CASCADE,
    "album_id"  bigint    NOT NULL REFERENCES "album"("id")  ON DELETE CASCADE
);
COMMENT ON TABLE "artist_albums" IS '艺术家-专辑关联';
CREATE UNIQUE INDEX IF NOT EXISTS "idx_artist_albums_pair"  ON "artist_albums" ("artist_id", "album_id");
CREATE INDEX        IF NOT EXISTS "idx_artist_albums_album" ON "artist_albums" ("album_id");

-- 语种。
CREATE TABLE IF NOT EXISTS "language" (
    "id"   serial       PRIMARY KEY,
    "name" varchar(255) NOT NULL UNIQUE
);
COMMENT ON TABLE "language" IS '语种';

-- 演唱会。
CREATE TABLE IF NOT EXISTS "live" (
    "id"         bigserial    PRIMARY KEY,
    "created_at" timestamptz  NOT NULL DEFAULT now(),
    "updated_at" timestamptz  NOT NULL DEFAULT now(),
    "title"      varchar(255) NOT NULL,
    "time"       timestamptz  NOT NULL
);
COMMENT ON TABLE "live" IS '演唱会';

-- 曲目。id 由应用层分配（雪花 ID）。删除演唱会时仅解除关联（SET NULL）。
CREATE TABLE IF NOT EXISTS "track" (
    "id"         bigint       PRIMARY KEY,
    "created_at" timestamptz  NOT NULL DEFAULT now(),
    "updated_at" timestamptz  NOT NULL DEFAULT now(),
    "title"      varchar(255) NOT NULL,
    "duration"   int          NOT NULL DEFAULT 0,
    "lyric"      text,
    "lrc_lyric"  text,
    "cover_key"  varchar(255),
    -- 是否可被搜索（下架的曲目置 false）
    "available"  boolean      NOT NULL DEFAULT true,
    -- 演唱会 id，非空表示属于某个演唱会
    "live_id"    bigint       REFERENCES "live"("id") ON DELETE SET NULL
);
COMMENT ON TABLE  "track"             IS '歌曲';
COMMENT ON COLUMN "track"."duration"  IS '时长（秒），展示用；以 audio 实测为准';
COMMENT ON COLUMN "track"."lyric"     IS '纯文本歌词';
COMMENT ON COLUMN "track"."lrc_lyric" IS 'LRC 带时间轴歌词';
COMMENT ON COLUMN "track"."cover_key" IS '封面在对象存储中的 key';
COMMENT ON COLUMN "track"."available" IS '是否可被搜索';
COMMENT ON COLUMN "track"."live_id"   IS '演唱会 id，非空表示属于某个演唱会';

CREATE INDEX IF NOT EXISTS "idx_track_live_id"    ON "track" ("live_id");
-- 仅对可搜索曲目建模糊搜索索引，缩小搜索集
CREATE INDEX IF NOT EXISTS "idx_track_title_trgm" ON "track" USING gin ("title" gin_trgm_ops) WHERE "available";

-- 曲目别名（一首歌可有多个别名）—— 修复原设计 track_id 列级 UNIQUE 的问题。
CREATE TABLE IF NOT EXISTS "track_aliases" (
    "id"       bigserial    PRIMARY KEY,
    "track_id" bigint       NOT NULL REFERENCES "track"("id") ON DELETE CASCADE,
    "alias"    varchar(255) NOT NULL
);
COMMENT ON TABLE "track_aliases" IS '歌曲别名';
CREATE UNIQUE INDEX IF NOT EXISTS "idx_track_aliases_track_alias" ON "track_aliases" ("track_id", "alias");
CREATE INDEX        IF NOT EXISTS "idx_track_aliases_alias_trgm"   ON "track_aliases" USING gin ("alias" gin_trgm_ops);

-- 曲目-艺术家（多对多）。position 表示主唱/参与的展示顺序。
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

-- 曲目-专辑（多对多）。track_no/disc_no 表示专辑内的曲序。
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

-- 曲目-语种（多对多）。
CREATE TABLE IF NOT EXISTS "track_languages" (
    "id"          bigserial PRIMARY KEY,
    "track_id"    bigint    NOT NULL REFERENCES "track"("id")    ON DELETE CASCADE,
    "language_id" int       NOT NULL REFERENCES "language"("id") ON DELETE CASCADE
);
COMMENT ON TABLE "track_languages" IS '歌曲-语种关联';
CREATE UNIQUE INDEX IF NOT EXISTS "idx_track_languages_pair" ON "track_languages" ("track_id", "language_id");
CREATE INDEX        IF NOT EXISTS "idx_track_languages_lang" ON "track_languages" ("language_id");

-- 演唱会-艺术家（多对多）—— 修复原 live_artlists / artlist_id 命名。
CREATE TABLE IF NOT EXISTS "live_artists" (
    "id"        bigserial    PRIMARY KEY,
    "live_id"   bigint       NOT NULL REFERENCES "live"("id")   ON DELETE CASCADE,
    "artist_id" bigint       NOT NULL REFERENCES "artist"("id") ON DELETE CASCADE,
    "role"      varchar(255)
);
COMMENT ON TABLE  "live_artists"         IS '演唱会-艺术家关联';
COMMENT ON COLUMN "live_artists"."role"  IS '角色，如主办/嘉宾';
CREATE UNIQUE INDEX IF NOT EXISTS "idx_live_artists_pair"   ON "live_artists" ("live_id", "artist_id");
CREATE INDEX        IF NOT EXISTS "idx_live_artists_artist" ON "live_artists" ("artist_id");


-- =============================================================================
-- 三、音频（原始上传 + 分发版本）
-- =============================================================================

-- 原始音频：管理员上传的源文件。status 驱动「上传→解析→转码」异步流水线。
CREATE TABLE IF NOT EXISTS "origin_audio" (
    "id"            bigserial    PRIMARY KEY,
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
    -- 处理状态：pending / processing / ready / failed
    "status"        varchar(16)  NOT NULL DEFAULT 'pending',
    "error_message" text
);
COMMENT ON TABLE  "origin_audio"          IS '原始音频，管理员上传的源文件';
COMMENT ON COLUMN "origin_audio"."hash"   IS '文件 SHA-256（hex），全局去重';
COMMENT ON COLUMN "origin_audio"."status" IS '处理状态：pending/processing/ready/failed';
CREATE INDEX IF NOT EXISTS "idx_origin_audio_track" ON "origin_audio" ("track_id");

-- 分发音频：对外提供的转码版本，一首歌每个音质档位一行。
CREATE TABLE IF NOT EXISTS "audio" (
    "id"            bigserial    PRIMARY KEY,
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
    -- 集成响度（LUFS，EBU R128），用于跨曲目响度均衡
    "loudness"      double precision,
    -- 音质档位，如 standard / high / lossless（原设计误把注释写进了 DEFAULT）
    "quality_label" varchar(64)  NOT NULL DEFAULT 'standard',
    -- 脏数据标记：true 表示曲目某些字段被改过，需要重新生成
    "is_dirty"      boolean      NOT NULL DEFAULT false,
    -- 收录来源
    "source"        varchar(255)
);
COMMENT ON TABLE  "audio"                 IS '用于分发的音频';
COMMENT ON COLUMN "audio"."quality_label" IS '音质档位，如 standard/high/lossless';
COMMENT ON COLUMN "audio"."is_dirty"      IS '脏数据标记，true 表示需要重新生成';
COMMENT ON COLUMN "audio"."source"        IS '收录来源';
CREATE INDEX        IF NOT EXISTS "idx_audio_track"        ON "audio" ("track_id");
-- 同一曲目同一音质档位只保留一条
CREATE UNIQUE INDEX IF NOT EXISTS "idx_audio_track_quality" ON "audio" ("track_id", "quality_label");
