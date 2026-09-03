import "server-only";

import { resolveEmbeddingConfig, type EmbeddingConfig } from "@/lib/llm/config";
import { assertReachableBaseUrl, errorText, trimSlash } from "@/lib/llm/http";
import { createClient } from "@/lib/supabase/server";

/**
 * Text in, vectors out. This is the *model* half of retrieval; pgvector is the
 * storage half and contains no model. The same model that embedded a notebook's
 * chunks must embed its questions, or nearest-neighbour search returns noise.
 *
 * One interface, two strategies, chosen at deploy time by EMBEDDING_STRATEGY.
 */
export async function embed(
  texts: string[],
  options?: { providerConfigHeader?: string | null },
): Promise<number[][]> {
  if (texts.length === 0) return [];

  const config = resolveEmbeddingConfig(options?.providerConfigHeader ?? null);
  const vectors =
    config.strategy === "local"
      ? await embedLocal(texts)
      : await embedExternal(texts, config);

  for (const vector of vectors) {
    if (vector.length !== config.dimensions) {
      throw new Error(
        `Embedding model returned ${vector.length} dimensions, expected ${config.dimensions}. The database column will not accept these.`,
      );
    }
  }
  return vectors;
}

/**
 * Edge Functions have a CPU budget per invocation and gte-small spends a real
 * slice of it per chunk: measured against the local runtime, two ~800-token
 * chunks fit and four do not — the supervisor cancels the request mid-flight.
 *
 * So the caller's batch is split here rather than at the call site (the limit
 * belongs to this strategy, not to ingestion), and a failed request is retried
 * as halves rather than failing the whole source. Chunk sizes vary, and the
 * budget differs between the local runtime and a hosted project, so a fixed
 * batch size would be a guess that breaks quietly on someone else's deployment.
 */
const LOCAL_REQUEST_SIZE = 2;

async function embedLocal(texts: string[]): Promise<number[][]> {
  const vectors: number[][] = [];
  for (let i = 0; i < texts.length; i += LOCAL_REQUEST_SIZE) {
    vectors.push(...(await embedLocalSplitting(texts.slice(i, i + LOCAL_REQUEST_SIZE))));
  }
  return vectors;
}

async function embedLocalSplitting(texts: string[]): Promise<number[][]> {
  try {
    return await embedLocalRequest(texts);
  } catch (error) {
    // One text that will not fit is a real failure; several might just be a
    // batch that was too ambitious.
    if (texts.length === 1) throw error;
    const middle = Math.ceil(texts.length / 2);
    return [
      ...(await embedLocalSplitting(texts.slice(0, middle))),
      ...(await embedLocalSplitting(texts.slice(middle))),
    ];
  }
}

/** Supabase Edge Function running gte-small inside the Edge runtime. No key. */
async function embedLocalRequest(texts: string[]): Promise<number[][]> {
  const supabase = await createClient();
  const { data, error } = await supabase.functions.invoke<{ embeddings: number[][] }>(
    "embed",
    { body: { texts } },
  );

  if (error) {
    // The function's own JSON error body is more useful than the wrapper's message.
    const detail =
      error instanceof Error && "context" in error
        ? await readFunctionError(error.context)
        : null;
    throw new Error(detail ?? `Embedding function failed: ${error.message}`);
  }
  if (!data?.embeddings) throw new Error("Embedding function returned no embeddings");
  return data.embeddings;
}

async function readFunctionError(context: unknown): Promise<string | null> {
  if (!(context instanceof Response)) return null;
  const text = await context.text().catch(() => "");
  try {
    const body = JSON.parse(text) as { error?: string };
    if (body.error) return `Embedding function failed: ${body.error}`;
  } catch {
    // Not JSON — a supervisor-cancelled request has no body at all. The status
    // is still the most useful thing we can tell the user.
  }
  return `Embedding function failed with ${context.status}${
    text ? `: ${text.slice(0, 200)}` : " and no response body (the request may have been cancelled for exceeding its CPU budget)"
  }`;
}

/** Any OpenAI-compatible /embeddings endpoint. */
async function embedExternal(
  texts: string[],
  config: Extract<EmbeddingConfig, { strategy: "external" }>,
): Promise<number[][]> {
  assertReachableBaseUrl(config.baseUrl);

  const response = await fetch(`${trimSlash(config.baseUrl)}/embeddings`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({ model: config.model, input: texts }),
  });

  if (!response.ok) {
    throw new Error(`Embedding provider: ${await errorText(response)}`);
  }

  const json = (await response.json()) as {
    data?: { embedding: number[]; index: number }[];
  };
  if (!json.data) throw new Error("Embedding provider returned no data");

  // Providers are not required to preserve input order.
  return json.data
    .slice()
    .sort((a, b) => a.index - b.index)
    .map((item) => item.embedding);
}
