-- +goose Up
-- 集成响度（LUFS，EBU R128 / ITU-R BS.1770），用于跨曲目响度均衡（参考 -14 LUFS）。
ALTER TABLE "audio" ADD COLUMN IF NOT EXISTS "loudness" double precision;
COMMENT ON COLUMN "audio"."loudness" IS '集成响度（LUFS），用于跨曲目响度均衡';

-- +goose Down
ALTER TABLE "audio" DROP COLUMN IF EXISTS "loudness";
