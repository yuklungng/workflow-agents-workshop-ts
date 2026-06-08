-- Telemetry store shared by naive-agent and worker-agents. Idempotent.

CREATE TABLE IF NOT EXISTS reviews (
  id            UUID        PRIMARY KEY,
  pr_url        TEXT        NOT NULL,
  status        TEXT        NOT NULL DEFAULT 'pending',
  verdict       TEXT,
  reason        TEXT,
  source        TEXT,
  workflow      TEXT,
  input_tokens  INTEGER     NOT NULL DEFAULT 0,
  output_tokens INTEGER     NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Backfill columns on databases created before source/workflow existed.
ALTER TABLE reviews ADD COLUMN IF NOT EXISTS source   TEXT;
ALTER TABLE reviews ADD COLUMN IF NOT EXISTS workflow TEXT;

CREATE TABLE IF NOT EXISTS findings (
  id         SERIAL      PRIMARY KEY,
  review_id  UUID        NOT NULL REFERENCES reviews(id) ON DELETE CASCADE,
  agent      TEXT        NOT NULL,
  note       TEXT        NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS spans (
  span_id        UUID        PRIMARY KEY,
  run_id         UUID        NOT NULL,
  parent_span_id UUID,
  name           TEXT        NOT NULL,
  kind           TEXT        NOT NULL,
  status         TEXT        NOT NULL DEFAULT 'running',
  input          JSONB,
  output         JSONB,
  error          TEXT,
  started_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ended_at       TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS findings_review_id_idx ON findings (review_id);
CREATE INDEX IF NOT EXISTS spans_run_id_idx ON spans (run_id);
CREATE INDEX IF NOT EXISTS reviews_created_at_idx ON reviews (created_at DESC);
