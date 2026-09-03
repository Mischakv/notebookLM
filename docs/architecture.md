# Architecture

Notebook has exactly two data paths. Everything else is CRUD.

## Ingest path

1. Client `POST /api/sources` with a file (PDF / `.md` / `.txt`, ≤10 MB) or pasted text.
2. Route validates, uploads to Storage at `{user_id}/{source_id}/{filename}`, inserts a `sources`
   row with `status='pending'`, and returns immediately so the UI can render.
3. Client `POST /api/sources/[id]/ingest`. The call *claims* the source with a conditional update —
   status to `processing` and `processing_started_at` to now — so two tabs cannot embed the same
   chunks and collide on `unique (source_id, idx)`. A claim older than 90s is assumed abandoned and
   can be taken over, which is also how a row stranded by a platform timeout gets unstuck.
4. Text extraction: `unpdf` for PDFs (works on serverless; `pdf-parse` does not), plain read
   otherwise.
5. `chunk()` in `src/lib/chunk.ts` splits to ~800 tokens with ~120 overlap, on paragraph boundaries
   first, hard-splitting only a paragraph that exceeds budget. Pure function, unit tested.
6. `embed()` in `src/lib/llm/embed.ts` embeds a batch. How large a batch is a property of the
   strategy, not of ingestion: `external` takes 64 in one HTTP call, while `local` fans out to small
   Edge invocations (two ~800-token chunks fit inside one invocation's CPU budget) and retries a
   failed request as halves. The ingest route checks its time budget *before* each batch, so a slow
   one cannot outlive `maxDuration` and strand the row.
7. Chunks are inserted; the row moves to `ready`. Any failure writes the message to `sources.error`
   and moves the row to `error` — a row never stays in `processing`.
8. Client polls the source row until the status settles.

A large PDF that risks the 60s route ceiling is ingested across multiple client-driven calls using a
`next_chunk_idx` cursor on the source row. There is no queue.

## Chat path

1. Client `POST /api/chat` with the question, the notebook id, and (if the user configured one) a
   base64 JSON provider config in the `x-provider-config` header.
2. Route refuses outright if the notebook's `embedding_model` is not the one this deployment embeds
   with — the same check ingestion makes, on the read side, because a mismatch here does not fail, it
   silently returns neighbours that are near nothing. Then it embeds the question.
3. `match_chunks(query_embedding, p_notebook_id, match_count => 8)` returns the nearest chunks by
   cosine similarity. `SECURITY INVOKER`, so RLS applies.
4. The system prompt in `src/lib/prompts.ts` numbers the context blocks and requires `[n]` citations,
   answering only from context and saying plainly when the sources do not contain the answer.
5. `streamText` with `createOpenAICompatible({ baseURL, apiKey })` streams the answer.
6. The user message is persisted before streaming; the assistant message and its resolved citations
   are persisted after.
7. The response is a single stream with a JSON header line: the retrieved chunks, a newline, then the
   answer text. The client needs those chunks to turn `[n]` into something clickable and they are far
   too large for a header. Everything after the first newline is the answer, verbatim.
8. `resolveCitations()` in `src/lib/citations.ts` (pure, unit tested) maps `[n]` to that chunk list.
   A number pointing past the retrieved chunks is dropped rather than rendered: a citation that opens
   nothing still looks like evidence. Clicking one opens the chunk text in a side panel.

## Data model

| Table | Columns |
|---|---|
| `notebooks` | id, user_id, title, embedding_model, embedding_dims, created_at |
| `sources` | id, notebook_id, user_id, title, kind (`pdf`\|`text`\|`markdown`), storage_path (null), status (`pending`\|`processing`\|`ready`\|`error`), error (null), char_count, next_chunk_idx, processing_started_at, created_at |
| `chunks` | id, source_id, notebook_id, user_id, idx, content, token_count, embedding `vector(384)`, created_at |
| `messages` | id, notebook_id, user_id, role (`user`\|`assistant`), content, citations jsonb (null), created_at |
| `usage` | user_id, day (date), fallback_messages int — readable by its owner, written only by `record_fallback_message()` |

- `user_id` is denormalized onto every table so every RLS policy is one `auth.uid() = user_id` check.
- RLS is enabled on all tables, owner-only for every operation.
- HNSW index on `chunks.embedding` with `vector_cosine_ops`; btree on `chunks(notebook_id)` and
  `sources(notebook_id)`.
- Storage bucket `sources`, private.
- The `embedding` dimension is fixed at deploy time by `EMBEDDING_STRATEGY`. It cannot be a
  runtime choice: the pgvector column has one width, and every chunk in it was embedded by one
  model. Changing strategy against existing data means re-ingesting, not reconfiguring.
