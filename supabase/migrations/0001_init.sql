-- Notebook: initial schema.
--
-- Dimension note: chunks.embedding is vector(384), matching the `local` embedding
-- strategy (gte-small in the Supabase Edge runtime). Running EMBEDDING_STRATEGY=external
-- means also applying supabase/migrations-external/0004_embeddings_external.sql, which
-- widens the column to 1536. Pick one before ingesting anything: switching later
-- requires re-ingesting every source.

create extension if not exists vector with schema extensions;

-- ---------------------------------------------------------------------------
-- Tables
--
-- user_id is deliberately denormalized onto every table, including tables that
-- could reach their owner by joining through notebooks. It makes every RLS
-- policy a single `auth.uid() = user_id` check with no join, which for a
-- security boundary is worth the redundancy.
-- ---------------------------------------------------------------------------

create table public.notebooks (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users (id) on delete cascade,
  title           text not null,
  embedding_model text not null,
  embedding_dims  integer not null,
  created_at      timestamptz not null default now()
);

create table public.sources (
  id             uuid primary key default gen_random_uuid(),
  notebook_id    uuid not null references public.notebooks (id) on delete cascade,
  user_id        uuid not null references auth.users (id) on delete cascade,
  title          text not null,
  kind           text not null check (kind in ('pdf', 'text', 'markdown')),
  storage_path   text,
  status         text not null default 'pending'
                   check (status in ('pending', 'processing', 'ready', 'error')),
  error          text,
  char_count     integer not null default 0,
  -- Cursor for resuming ingestion across multiple client-driven calls when one
  -- document would not fit in the 60s route ceiling. There is no queue.
  next_chunk_idx integer not null default 0,
  created_at     timestamptz not null default now()
);

create table public.chunks (
  id          uuid primary key default gen_random_uuid(),
  source_id   uuid not null references public.sources (id) on delete cascade,
  notebook_id uuid not null references public.notebooks (id) on delete cascade,
  user_id     uuid not null references auth.users (id) on delete cascade,
  idx         integer not null,
  content     text not null,
  token_count integer not null,
  embedding   extensions.vector(384),
  created_at  timestamptz not null default now(),
  unique (source_id, idx)
);

create table public.messages (
  id          uuid primary key default gen_random_uuid(),
  notebook_id uuid not null references public.notebooks (id) on delete cascade,
  user_id     uuid not null references auth.users (id) on delete cascade,
  role        text not null check (role in ('user', 'assistant')),
  content     text not null,
  citations   jsonb,
  created_at  timestamptz not null default now()
);

-- Rate limit counter for the shared server fallback key.
create table public.usage (
  user_id           uuid not null references auth.users (id) on delete cascade,
  day               date not null default current_date,
  fallback_messages integer not null default 0,
  primary key (user_id, day)
);

-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------

create index chunks_embedding_idx
  on public.chunks using hnsw (embedding extensions.vector_cosine_ops);
create index chunks_notebook_id_idx on public.chunks (notebook_id);
create index chunks_source_id_idx on public.chunks (source_id);
create index sources_notebook_id_idx on public.sources (notebook_id);
create index messages_notebook_id_created_at_idx on public.messages (notebook_id, created_at);
create index notebooks_user_id_created_at_idx on public.notebooks (user_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Row level security: owner-only, every operation, every table.
-- ---------------------------------------------------------------------------

alter table public.notebooks enable row level security;
alter table public.sources   enable row level security;
alter table public.chunks    enable row level security;
alter table public.messages  enable row level security;
alter table public.usage     enable row level security;

create policy "notebooks are owner-only" on public.notebooks
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "sources are owner-only" on public.sources
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "chunks are owner-only" on public.chunks
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "messages are owner-only" on public.messages
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "usage is owner-only" on public.usage
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- ---------------------------------------------------------------------------
-- Retrieval
--
-- SECURITY INVOKER so the caller's RLS applies: a user can only ever match
-- chunks they own, and the p_notebook_id filter is a convenience, not the
-- security boundary.
-- ---------------------------------------------------------------------------

create function public.match_chunks (
  query_embedding extensions.vector(384),
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

-- ---------------------------------------------------------------------------
-- Storage: private bucket, path {user_id}/{source_id}/{filename}
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public)
values ('sources', 'sources', false)
on conflict (id) do nothing;

create policy "source files are owner-only" on storage.objects
  for all to authenticated
  using (
    bucket_id = 'sources'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  )
  with check (
    bucket_id = 'sources'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );
