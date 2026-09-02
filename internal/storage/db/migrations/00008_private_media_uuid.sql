-- +goose Up
-- 媒体资源改用不可枚举 UUID；GC 显式记录逻辑桶，避免跨桶误删同名 key。
-- +goose StatementBegin
DO $$
BEGIN
    IF (SELECT data_type FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'origin_audio' AND column_name = 'id') <> 'uuid' THEN
        ALTER TABLE origin_audio ALTER COLUMN id DROP DEFAULT;
        ALTER TABLE origin_audio ALTER COLUMN id TYPE uuid USING gen_random_uuid();
        ALTER TABLE origin_audio ALTER COLUMN id SET DEFAULT gen_random_uuid();
        DROP SEQUENCE IF EXISTS origin_audio_id_seq;
    END IF;
    IF (SELECT data_type FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'audio' AND column_name = 'id') <> 'uuid' THEN
        ALTER TABLE audio ALTER COLUMN id DROP DEFAULT;
        ALTER TABLE audio ALTER COLUMN id TYPE uuid USING gen_random_uuid();
        ALTER TABLE audio ALTER COLUMN id SET DEFAULT gen_random_uuid();
        DROP SEQUENCE IF EXISTS audio_id_seq;
    END IF;
END $$;
-- +goose StatementEnd

ALTER TABLE object_gc ADD COLUMN IF NOT EXISTS bucket_kind text;
ALTER TABLE object_gc ADD COLUMN IF NOT EXISTS lease_until timestamptz;
UPDATE object_gc
SET bucket_kind = CASE WHEN file_key LIKE 'cover/%' THEN 'public' ELSE 'private' END
WHERE bucket_kind IS NULL;
ALTER TABLE object_gc ALTER COLUMN bucket_kind SET NOT NULL;
ALTER TABLE object_gc DROP CONSTRAINT IF EXISTS object_gc_pkey;
ALTER TABLE object_gc ADD CONSTRAINT object_gc_pkey PRIMARY KEY (bucket_kind, file_key);
ALTER TABLE object_gc DROP CONSTRAINT IF EXISTS object_gc_bucket_kind_check;
ALTER TABLE object_gc ADD CONSTRAINT object_gc_bucket_kind_check CHECK (bucket_kind IN ('public', 'private'));

-- +goose Down
ALTER TABLE object_gc DROP CONSTRAINT object_gc_bucket_kind_check;
ALTER TABLE object_gc DROP CONSTRAINT object_gc_pkey;
ALTER TABLE object_gc ADD CONSTRAINT object_gc_pkey PRIMARY KEY (file_key);
ALTER TABLE object_gc DROP COLUMN bucket_kind;
ALTER TABLE object_gc DROP COLUMN lease_until;

CREATE SEQUENCE IF NOT EXISTS origin_audio_id_seq;
CREATE SEQUENCE IF NOT EXISTS audio_id_seq;
ALTER TABLE origin_audio ALTER COLUMN id DROP DEFAULT;
ALTER TABLE audio ALTER COLUMN id DROP DEFAULT;
ALTER TABLE origin_audio ALTER COLUMN id TYPE bigint USING nextval('origin_audio_id_seq');
ALTER TABLE audio ALTER COLUMN id TYPE bigint USING nextval('audio_id_seq');
ALTER TABLE origin_audio ALTER COLUMN id SET DEFAULT nextval('origin_audio_id_seq');
ALTER TABLE audio ALTER COLUMN id SET DEFAULT nextval('audio_id_seq');
ALTER SEQUENCE origin_audio_id_seq OWNED BY origin_audio.id;
ALTER SEQUENCE audio_id_seq OWNED BY audio.id;
