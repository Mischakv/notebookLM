-- Apply this ONLY when running EMBEDDING_STRATEGY=external.
--
-- It is deliberately held outside supabase/migrations/ so that `supabase db reset`
-- leaves the default `local` (384-dim gte-small) strategy alone. To run external:
--
--   cp supabase/migrations-external/0004_embeddings_external.sql supabase/migrations/
--   pnpm db:reset      # or pnpm db:push against a remote project
--
-- Do this before ingesting anything. The column dimension is fixed, so switching
-- strategies afterwards requires re-ingesting every source.

-- Any vectors already stored are the wrong width, and a widened copy would be
-- meaningless rather than merely imprecise. Fail loudly, before touching anything.
do $$
begin
  if exists (select 1 from public.chunks limit 1) then
    raise exception
      'chunks is not empty: switching embedding strategy requires re-ingesting every source';
  end if;
end
$$;

-- The old index is bound to the old column type and must go before the alter.
drop index if exists public.chunks_embedding_idx;

alter table public.chunks
  alter column embedding type extensions.vector(1536);

create index chunks_embedding_idx
  on public.chunks using hnsw (embedding extensions.vector_cosine_ops);

-- Same body, wider parameter type.
drop function if exists public.match_chunks (extensions.vector(384), uuid, integer);

create function public.match_chunks (
  query_embedding extensions.vector(1536),
  p_notebook_id   uuid,
  match_count     integer default 8
)
returns table (
  id         uuid,
  content    text,
  source_id  uuid,
  idx        integer,
  similarity double precision
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    c.id,
    c.content,
    c.source_id,
    c.idx,
    1 - (c.embedding operator(extensions.<=>) query_embedding) as similarity
  from public.chunks c
  where c.notebook_id = p_notebook_id
    and c.embedding is not null
  order by c.embedding operator(extensions.<=>) query_embedding
  limit least(greatest(match_count, 1), 50);
$$;
