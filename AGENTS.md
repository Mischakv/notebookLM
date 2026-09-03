# AGENTS.md

## Project

Notebook is a NotebookLM-style app: a user creates notebooks, uploads sources, and chats with those
sources with inline citations. It is a portfolio-quality reference project — a clean RAG application
plus a disciplined, vendor-neutral multi-agent development workflow.

## Stack

Next.js 15 (App Router, TypeScript, `src/`), React 19, Tailwind CSS v4 + minimal shadcn/ui,
Supabase (Postgres + pgvector, Auth, Storage, Edge Functions), Vercel AI SDK v5 with
`@ai-sdk/openai-compatible`, deployed to Vercel + Supabase. Package manager: pnpm.

## Commands

```
pnpm dev            # next dev
pnpm build          # next build
pnpm lint           # eslint
pnpm typecheck      # tsc --noEmit
pnpm test           # vitest run
pnpm gate           # typecheck + lint + test + build; the gate before every commit
pnpm db:reset       # supabase db reset
pnpm db:push        # supabase db push
pnpm supabase functions serve
```

## Conventions

- Server components by default. `"use client"` only where there is real interactivity.
- Zod-validate every route handler input and every value read from `localStorage`.
- No `any`. No non-null assertions to silence the compiler.
- **No provider SDK import outside `src/lib/llm/`.** Route handlers call `chat()` and `embed()`.
- Never log, persist, return, or echo a provider config or API key — not in an error message either.
- Errors surface the real upstream message to the user; nothing fails silently.
- Every async action has a visible pending state.
- Tests only where a regression is silent and expensive: the chunker (`src/lib/chunk.ts`), the
  citation parser (`src/lib/citations.ts`), the URL guard (`src/lib/url-guard.ts` — a security
  boundary whose logic is a table of IP ranges), and retrieval quality (`src/lib/eval/`).
- Retrieval quality is measured, not assumed. `src/lib/eval/` scores the real chunker against a
  fixture corpus and fails below a floor. Bad retrieval does not throw — it returns a fluent,
  confident, wrong answer — so it is the definitive case of a silent, expensive regression.

## Agent workflow

Four roles, differentiated by tool permission. Canonical instructions live in `.agents/roles/`;
`.claude/agents/` are thin wrappers pointing at them, so Cursor and Codex read the same files.

| Role | Tools | Job |
|---|---|---|
| `planner` | read + write | Writes `docs/tasks/phase-N.md`. No application code. |
| `implementer` | read, write, edit, bash | Executes one task file, ticking items as it goes. |
| `reviewer` | read + bash (gate only) | Runs `pnpm gate`, returns findings. Never edits. |
| `schema` | read, write, edit, bash — scoped to `supabase/` | Migrations and RLS only. |

The main thread is the orchestrator; there is no orchestrator subagent. Per phase:
`planner` → read and correct the task file yourself → `implementer` (plus `schema` where the phase
touches the database) → `pnpm gate` → `reviewer` → fix blocking findings → commit.
Use the loop at phase boundaries, not per file.

## Before you finish

`pnpm gate` must pass — typecheck, lint, test, build, in that order.

It is one command on purpose. This list was previously written out inline and omitted
`test`, so a failing test reached `main` without any role being wrong.

## What not to do

No LangChain / LlamaIndex. No custom auth. No Redis, no queue, no Docker, no microservices.
No orgs, roles, or billing. No audio overview, no sharing. No state management library.
Tests only for the chunker, the citation parser, the URL guard, and the retrieval eval.

Article extraction is the one accepted exception to the lean-dependency stance:
`@mozilla/readability` + `linkedom` + `turndown` are narrow, single-purpose libraries, and
hand-rolled extraction heuristics would need continuous tuning against the open web.
