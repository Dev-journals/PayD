-- Add row-level locking support to schedules table.
-- locked_by: identifies which pod/process claimed the row (e.g. hostname + pid)
-- locked_at: when the claim was acquired; stale claims can be reclaimed after a timeout

ALTER TABLE schedules
  ADD COLUMN IF NOT EXISTS locked_by  VARCHAR(128),
  ADD COLUMN IF NOT EXISTS locked_at  TIMESTAMPTZ;

-- Index to support the claim query (active + due + unlocked rows)
CREATE INDEX IF NOT EXISTS idx_schedules_claim
    ON schedules (next_run_timestamp, status)
    WHERE status = 'active' AND locked_by IS NULL;
