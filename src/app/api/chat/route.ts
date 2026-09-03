import { NextResponse } from "next/server";
import { z } from "zod";

import { resolveCitations, stripCitationMarkers, stripEchoedMarkers } from "@/lib/citations";
import { streamChat } from "@/lib/llm/chat";
import { chatConfig, embeddingConfig } from "@/lib/llm/config";
import { embed } from "@/lib/llm/embed";
import { buildSystemPrompt } from "@/lib/prompts";
import { PROVIDER_CONFIG_HEADER } from "@/lib/provider-config";
import { recordFallbackMessage } from "@/lib/rate-limit";
import { createClient } from "@/lib/supabase/server";
import type { MatchedChunk, Notebook, Source } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

const MATCH_COUNT = 8;

const bodySchema = z.object({
  notebookId: z.uuid(),
  message: z.string().trim().min(1).max(4000),
});

/**
 * Retrieval, then generation, then persistence.
 *
 * The response is one stream with a JSON header line: the retrieved chunks first,
 * then the answer text. The client needs those chunks to resolve [n] into
 * something clickable, and a header would not hold them. Everything after the
 * first newline is the answer, verbatim.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid request" },
      { status: 400 },
    );
  }
  const { notebookId, message } = parsed.data;

  const { data: notebook } = await supabase
    .from("notebooks")
    .select("id, embedding_model, embedding_dims")
    .eq("id", notebookId)
    .maybeSingle<Pick<Notebook, "id" | "embedding_model" | "embedding_dims">>();
  if (!notebook) return NextResponse.json({ error: "Notebook not found" }, { status: 404 });

  // Ingestion refuses a model that does not match the notebook. The read side has
  // to refuse it too, or a deployment whose strategy changed after ingest embeds
  // the question with one model and searches vectors made by another — which does
  // not fail, it just returns neighbours that are near nothing.
  try {
    const deployment = embeddingConfig();
    if (
      notebook.embedding_model !== deployment.model ||
      notebook.embedding_dims !== deployment.dimensions
    ) {
      return NextResponse.json(
        {
          error: `This notebook was built with ${notebook.embedding_model} (${notebook.embedding_dims} dims) but this deployment embeds with ${deployment.model} (${deployment.dimensions} dims). Its sources would have to be re-ingested before it can be searched.`,
        },
        { status: 409 },
      );
    }
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Embedding is misconfigured" },
      { status: 500 },
    );
  }

  const providerHeader = request.headers.get(PROVIDER_CONFIG_HEADER);

  let config;
  try {
    config = chatConfig(providerHeader);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "No chat provider configured" },
      { status: 400 },
    );
  }

  let chunks: MatchedChunk[];
  try {
    // The question must be embedded by the same model as the documents, or the
    // nearest neighbours are nearest to nothing.
    const [questionEmbedding] = await embed([message], {
      providerConfigHeader: providerHeader,
    });

    const { data, error } = await supabase.rpc("match_chunks", {
      query_embedding: JSON.stringify(questionEmbedding),
      p_notebook_id: notebookId,
      match_count: MATCH_COUNT,
    });
    if (error) throw new Error(error.message);
    chunks = (data ?? []) as MatchedChunk[];
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Retrieval failed" },
      { status: 502 },
    );
  }

  const sourceTitles = await titlesFor(supabase, chunks);

  // Only the shared key is metered; a user paying for their own is not our
  // business. Charged here rather than at the top of the handler so a request
  // that dies in retrieval does not cost the user one of their twenty.
  if (config.source === "fallback") {
    try {
      const limit = await recordFallbackMessage(supabase);
      if (!limit.allowed) {
        return NextResponse.json(
          {
            error: `You have used today's ${limit.limit} messages on the shared key. Add your own provider in Settings to keep going.`,
          },
          { status: 429 },
        );
      }
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "Could not record usage" },
        { status: 500 },
      );
    }
  }

  // Read the history *before* inserting this turn, or the question arrives at the
  // model twice — once from the transcript and once as the current message.
  const history = await recentHistory(supabase, notebookId);

  // Persisted before the stream starts: if generation dies halfway, the question
  // the user asked is still in the transcript.
  const asked = await supabase.from("messages").insert({
    notebook_id: notebookId,
    user_id: user.id,
    role: "user",
    content: message,
  });
  if (asked.error) {
    return NextResponse.json({ error: asked.error.message }, { status: 500 });
  }

  const persistAnswer = async (raw: string) => {
    // `[*]` is debris from the replayed history, not something the model meant to
    // write. It is removed before both the text and the citations are derived, so
    // the stored content and the stored citations are computed from the same
    // string — and so this answer, when it is itself replayed, carries no marker
    // the next turn could copy again.
    const text = stripEchoedMarkers(raw);
    if (text.length === 0) return;
    const saved = await supabase.from("messages").insert({
      notebook_id: notebookId,
      user_id: user.id,
      role: "assistant",
      content: text,
      citations: resolveCitations(text, chunks, sourceTitles),
    });
    if (saved.error) {
      // Nothing left to tell the client — the stream is over — but the answer is
      // gone from the transcript, so it must not vanish from the logs too.
      console.error("Could not persist the assistant message:", saved.error.message);
    }
  };

  // A provider failure does not throw and does not end up on the text stream: the
  // stream simply ends with nothing in it. Without this the user gets a 200 and a
  // blank answer, which is the one thing AGENTS.md says must never happen.
  let streamError: unknown = null;

  let iterator: AsyncIterator<string>;
  let first: IteratorResult<string>;
  try {
    iterator = streamChat({
      config,
      system: buildSystemPrompt(chunks, sourceTitles),
      messages: [...history, { role: "user", content: message }],
      onError: (error) => {
        streamError = error;
      },
    }).textStream[Symbol.asyncIterator]();

    // Pulling the first value before responding is what lets a provider failure
    // be a status code rather than an error appended to an empty answer.
    first = await iterator.next();
  } catch (error) {
    streamError = error;
    first = { done: true, value: undefined };
    iterator = (async function* () {})();
  }

  if (first.done && streamError !== null) {
    return NextResponse.json({ error: describe(streamError) }, { status: 502 });
  }

  const header = JSON.stringify({
    chunks: chunks.map((chunk) => ({
      ...chunk,
      source_title: sourceTitles[chunk.source_id] ?? "Untitled source",
    })),
  });

  const encoder = new TextEncoder();
  let answer = "";

  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      controller.enqueue(encoder.encode(`${header}\n`));
      try {
        for (let step = first; !step.done; step = await iterator.next()) {
          answer += step.value;
          controller.enqueue(encoder.encode(step.value));
        }
      } catch (error) {
        streamError = error;
      }

      if (streamError !== null) {
        // The stream has already begun, so the status code is spent. Put the
        // failure where the user will see it: at the end of the answer.
        controller.enqueue(encoder.encode(`\n\n[stream failed: ${describe(streamError)}]`));
      }
      // Persisted from what was actually sent, not from a callback tied to the
      // stream completing, so a partial answer still reaches the transcript.
      await persistAnswer(answer);
      controller.close();
    },
    async cancel() {
      // The reader navigated away. Keep what was generated rather than leaving a
      // question with no reply.
      await persistAnswer(answer);
      await iterator.return?.();
    },
  });

  return new Response(body, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Accel-Buffering": "no",
    },
  });
}

/** An upstream message where there is one; never a credential. */
function describe(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return "The chat provider failed without saying why";
}

async function titlesFor(
  supabase: Awaited<ReturnType<typeof createClient>>,
  chunks: MatchedChunk[],
): Promise<Record<string, string>> {
  const ids = [...new Set(chunks.map((chunk) => chunk.source_id))];
  if (ids.length === 0) return {};

  const { data } = await supabase
    .from("sources")
    .select("id, title")
    .in("id", ids)
    .returns<Pick<Source, "id" | "title">[]>();

  return Object.fromEntries((data ?? []).map((source) => [source.id, source.title]));
}

/** Ten turns of 4000 characters each would dwarf the retrieved context. */
const HISTORY_CHAR_BUDGET = 8000;

/** A short window of prior turns, so follow-up questions make sense. */
async function recentHistory(
  supabase: Awaited<ReturnType<typeof createClient>>,
  notebookId: string,
) {
  const { data } = await supabase
    .from("messages")
    .select("role, content")
    .eq("notebook_id", notebookId)
    // Total order, for the same reason the page needs one: a tie must not let
    // an answer sort ahead of its own question when the history is replayed.
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(10)
    .returns<{ role: "user" | "assistant"; content: string }[]>();

  // Newest first, so the budget drops the oldest turns rather than the nearest.
  const kept: { role: "user" | "assistant"; content: string }[] = [];
  let budget = HISTORY_CHAR_BUDGET;
  for (const message of data ?? []) {
    // Strip citation markers from prior answers before they go back to the model.
    //
    // [n] is only meaningful against the context blocks of the turn that produced
    // it, and every turn retrieves a different set. Replaying "…30 Tage [2]" into
    // a request whose block 2 is now a different passage teaches the model a
    // wrong pairing, and it copies that pattern: it re-cites [2] for the old
    // claim, or invents numbers to match the shape it has seen. That is what
    // makes citations drift out of sync with the passages they open.
    //
    // The prose is kept — it is the conversational context. Only the numbers go.
    const content =
      message.role === "assistant" ? stripCitationMarkers(message.content) : message.content;
    // `continue`, not `break`: one long turn must not discard every turn behind
    // it. Walking newest-first, a single oversized answer used to end the loop
    // and take the short, still-relevant turns before it out of the history —
    // which is how a follow-up question lost the context it was following up on.
    if (content.length > budget) continue;
    budget -= content.length;
    kept.push({ role: message.role, content });
  }

  return kept.reverse();
}
