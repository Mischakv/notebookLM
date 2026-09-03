// Embedding Edge Function for EMBEDDING_STRATEGY=local.
//
// Uses the model built into the Supabase Edge runtime: gte-small, 384 dimensions,
// no API key and no per-token cost. This function is the *model* half of the
// feature; pgvector in Postgres is the storage-and-search half and contains no
// model at all.
//
// Deno, not Node. Types come from the Supabase Edge runtime and are not resolvable
// by the app's tsconfig, which is why supabase/functions is excluded from it.

// @ts-expect-error - `Supabase` is provided by the Edge runtime, not by an import.
const session = new Supabase.ai.Session("gte-small");

// Kept small on purpose: each run costs CPU time out of this invocation's budget,
// and a large batch is cancelled by the supervisor mid-request. lib/llm/embed.ts
// splits a caller's batch to match.
const MAX_TEXTS = 8;

Deno.serve(async (request: Request) => {
  if (request.method !== "POST") {
    return Response.json({ error: "Use POST" }, { status: 405 });
  }

  let texts: unknown;
  try {
    ({ texts } = await request.json());
  } catch {
    return Response.json({ error: "Body must be JSON" }, { status: 400 });
  }

  if (
    !Array.isArray(texts) ||
    texts.length === 0 ||
    texts.length > MAX_TEXTS ||
    texts.some((text) => typeof text !== "string" || text.length === 0)
  ) {
    return Response.json(
      { error: `texts must be 1-${MAX_TEXTS} non-empty strings` },
      { status: 400 },
    );
  }

  try {
    const embeddings: number[][] = [];
    for (const text of texts as string[]) {
      // mean_pool + normalize is what makes cosine distance meaningful.
      const embedding = (await session.run(text, {
        mean_pool: true,
        normalize: true,
      })) as number[];
      embeddings.push(embedding);
    }
    return Response.json({ embeddings });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Embedding failed";
    return Response.json({ error: message }, { status: 500 });
  }
});
