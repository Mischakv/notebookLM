-- A website is a source like any other: it is fetched and parsed to Markdown at
-- upload time, so by the time ingestion sees it there is nothing URL-specific
-- left. source_url and metadata exist only so the UI can link back and show
-- provenance.

alter table public.sources drop constraint sources_kind_check;

alter table public.sources add constraint sources_kind_check
  check (kind in ('pdf', 'text', 'markdown', 'url'));

alter table public.sources add column source_url text;

-- Display-only and never queried or filtered, so one jsonb column rather than
-- five sparse ones. Anything from the open web is untrusted: parsed with Zod on
-- read, never trusted as typed.
alter table public.sources add column metadata jsonb;
