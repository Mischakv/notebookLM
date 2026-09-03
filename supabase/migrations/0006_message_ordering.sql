-- Message ordering has to be a total order, or citations open the wrong passage.
--
-- `created_at` defaulted to now(), which is *transaction start* time, and every
-- read ordered by that column alone. Neither half is safe on its own:
--
--   * now() is identical for every row written in one transaction, and is taken
--     when the transaction begins rather than when the row is inserted.
--   * `order by created_at` with no tiebreaker is not a total order, so rows
--     sharing a timestamp come back in whatever order the plan produces — and
--     that order is free to change between two reads of the same table.
--
-- A tie between a question and its answer reorders the transcript. The chat
-- panel resolves [n] against the turn it is rendering, so a shifted transcript
-- means a citation opens the neighbouring turn's passage: the reported
-- "citations show the wrong text".
--
-- clock_timestamp() is the wall clock at the moment of the insert, so two rows
-- written back to back differ even inside one transaction. The index gains `id`
-- so the total order the readers now ask for is the one the index provides.
alter table public.messages
  alter column created_at set default clock_timestamp();

drop index if exists messages_notebook_id_created_at_idx;
create index messages_notebook_id_created_at_id_idx
  on public.messages (notebook_id, created_at, id);
