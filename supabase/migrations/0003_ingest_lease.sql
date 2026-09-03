-- Two ingest calls for the same source (two tabs, or a remount racing an
-- in-flight run) both read the same next_chunk_idx, embed the same chunks, and
-- the loser trips `unique (source_id, idx)` — flipping a source that is being
-- ingested successfully to `error`.
--
-- A timestamp turns the status into a lease: claiming a source is a conditional
-- update, and a lease older than the route's own ceiling is assumed dead and can
-- be reclaimed. That also un-strands a row abandoned by a platform timeout,
-- which no status alone can express.
alter table public.sources
  add column processing_started_at timestamptz;

comment on column public.sources.processing_started_at is
  'When the current ingest run claimed this source. Stale leases are reclaimable.';
