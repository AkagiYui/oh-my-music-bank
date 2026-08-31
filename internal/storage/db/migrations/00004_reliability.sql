-- +goose Up
-- 同一曲目允许保留多个同音质来源，音频 ID 区分具体版本。
DROP INDEX idx_audio_track_quality;
CREATE INDEX idx_audio_track_quality_lookup ON audio(track_id, quality_label);
CREATE TABLE auth_session (
    id uuid PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
    refresh_hash char(64) NOT NULL,
    expires_at timestamptz NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_auth_session_user ON auth_session(user_id);
CREATE INDEX idx_auth_session_expiry ON auth_session(expires_at);
CREATE TABLE object_gc (
    file_key text PRIMARY KEY,
    not_before timestamptz NOT NULL DEFAULT now(),
    attempts int NOT NULL DEFAULT 0
);
CREATE TABLE ingest_job (
    id uuid PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
    kind text NOT NULL CHECK (kind IN ('upload', 'bilibili')),
    payload text NOT NULL,
    input_key text NOT NULL DEFAULT '',
    status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','processing','ready','failed','cancelled')),
    progress int NOT NULL DEFAULT 0,
    stage text NOT NULL DEFAULT '等待处理',
    error_message text NOT NULL DEFAULT '',
    track_id bigint REFERENCES track(id) ON DELETE SET NULL,
    deduplicated boolean NOT NULL DEFAULT false,
    attempts int NOT NULL DEFAULT 0,
    cancel_requested boolean NOT NULL DEFAULT false,
    lease_until timestamptz,
    run_id uuid,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_ingest_job_queue ON ingest_job(status, created_at);
CREATE INDEX idx_ingest_job_user ON ingest_job(user_id, created_at);
CREATE TABLE request_budget (
    bucket text PRIMARY KEY,
    window_start timestamptz NOT NULL,
    used int NOT NULL DEFAULT 0
);
ALTER TABLE api_key ADD CONSTRAINT api_key_rpm_positive CHECK (rpm_override IS NULL OR rpm_override BETWEEN 1 AND 10000) NOT VALID;
-- +goose Down
DROP INDEX idx_audio_track_quality_lookup;
CREATE UNIQUE INDEX idx_audio_track_quality ON audio(track_id, quality_label);
ALTER TABLE api_key DROP CONSTRAINT api_key_rpm_positive;
DROP TABLE request_budget;
DROP TABLE ingest_job;
DROP TABLE object_gc;
DROP TABLE auth_session;
