import { NextResponse } from "next/server";
import { z } from "zod";

import { chunk } from "@/lib/chunk";
import { embeddingConfig } from "@/lib/llm/config";
import { embed } from "@/lib/llm/embed";
import { normalizePdfText } from "@/lib/pdf-text";
import { PROVIDER_CONFIG_HEADER } from "@/lib/provider-config";
import { createClient } from "@/lib/supabase/server";
import type { Notebook, Source } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * How many chunks are embedded per round-trip to the provider. External providers
 * take a whole batch in one HTTP call; the local strategy fans out to several
 * small Edge invocations (see lib/llm/embed.ts), so a smaller slice keeps the
 * time check below fine-grained enough to matter.
 */
const BATCH_SIZE = { external: 64, local: 16 } as const;

/** Leaves room inside maxDuration to write the cursor and respond. */
const TIME_BUDGET_MS = 40_000;

/** A claim older than the route's own ceiling belongs to a run that is gone. */
const STALE_LEASE_MS = 90_000;

/**
 * pending → processing → ready | error.
 *
 * A row never stays in `processing`: every failure path writes the message to
 * sources.error and moves the row to `error`. When one call cannot finish the
 * document it saves next_chunk_idx and reports `processing`, and the client
 * calls again. That cursor is the whole of the "no queue" story.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const startedAt = Date.now();
  const { id } = await params;

  const parsedId = z.uuid().safeParse(id);
  if (!parsedId.success) {
    return NextResponse.json({ error: "Unknown source" }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const { data: source } = await supabase
    .from("sources")
    .select("*")
    .eq("id", parsedId.data)
    .maybeSingle<Source>();

  if (!source) return NextResponse.json({ error: "Source not found" }, { status: 404 });

  if (source.status === "ready") {
    // Ready means ready only if the chunks are still there; they can be deleted
    // out from under a row, and this route is the only way back.
    const { count } = await supabase
      .from("chunks")
      .select("id", { count: "exact", head: true })
      .eq("source_id", source.id);
    if ((count ?? 0) > 0) {
      return NextResponse.json({ status: "ready", chunks_written: 0 });
    }
  }

  const fail = async (message: string) => {
    await supabase
      .from("sources")
      .update({ status: "error", error: message, processing_started_at: null })
      .eq("id", source.id);
    return NextResponse.json({ status: "error", error: message }, { status: 422 });
  };

  try {
    const { data: notebook } = await supabase
      .from("notebooks")
      .select("*")
      .eq("id", source.notebook_id)
      .maybeSingle<Notebook>();

    if (!notebook) return await fail("This source's notebook no longer exists");

    // Mixed embedding models produce silently broken retrieval, which is worse
    // than an error. The notebook is pinned to the model it was created under.
    const config = embeddingConfig();
    if (
      notebook.embedding_model !== config.model ||
      notebook.embedding_dims !== config.dimensions
    ) {
      return await fail(
        `This notebook was built with ${notebook.embedding_model} (${notebook.embedding_dims} dims) but this deployment embeds with ${config.model} (${config.dimensions} dims). Create a new notebook, or redeploy with the original strategy.`,
      );
    }

    // Claim the source. Two tabs, or a remount racing an in-flight run, would
    // otherwise embed the same chunks and the loser would trip the unique index,
    // flipping a healthy ingest to `error`. The claim is conditional, so exactly
    // one caller proceeds; a lease older than this route could possibly hold is
    // treated as abandoned and reclaimed, which is also how a source stranded by
    // a platform timeout gets unstuck.
    const staleBefore = new Date(Date.now() - STALE_LEASE_MS).toISOString();
    const { data: claimed } = await supabase
      .from("sources")
      .update({ status: "processing", error: null, processing_started_at: new Date().toISOString() })
      .eq("id", source.id)
      .or(`status.neq.processing,processing_started_at.lt.${staleBefore},processing_started_at.is.null`)
      .select("id")
      .returns<{ id: string }[]>();

    if (!claimed || claimed.length === 0) {
      return NextResponse.json({ status: "processing", chunks_written: 0, held: true });
    }

    if (!source.storage_path) return await fail("This source has no stored file");

    const download = await supabase.storage.from("sources").download(source.storage_path);
    if (download.error) return await fail(`Could not read the file: ${download.error.message}`);

    const text = await extractText(download.data, source.kind);
    if (text.trim().length === 0) {
      return await fail("No text could be extracted. A scanned PDF needs OCR first.");
    }

    // An empty chunk has nothing to embed and providers reject it, which would
    // fail the whole source over a stray blank page.
    const chunks = chunk(text).filter((c) => c.content.trim().length > 0);
    const remaining = chunks.filter((c) => c.idx >= source.next_chunk_idx);

    const batchSize = BATCH_SIZE[config.strategy];
    let written = 0;
    for (let i = 0; i < remaining.length; i += batchSize) {
      // Checked before the work, not after it: the embedding call is the slow
      // part, and a check that only runs afterwards cannot stop the platform
      // killing the function mid-batch and stranding the row in `processing`.
      if (i > 0 && Date.now() - startedAt > TIME_BUDGET_MS) {
        return NextResponse.json({
          status: "processing",
          next_chunk_idx: remaining[i].idx,
          chunks_written: written,
        });
      }

      const batch = remaining.slice(i, i + batchSize);
      const vectors = await embed(batch.map((c) => c.content), {
        providerConfigHeader: request.headers.get(PROVIDER_CONFIG_HEADER),
      });

      const { error } = await supabase.from("chunks").insert(
        batch.map((c, j) => ({
          source_id: source.id,
          notebook_id: source.notebook_id,
          user_id: user.id,
          idx: c.idx,
          content: c.content,
          token_count: c.tokenCount,
          embedding: JSON.stringify(vectors[j]),
        })),
      );
      if (error) return await fail(`Could not store chunks: ${error.message}`);

      written += batch.length;
      await supabase
        .from("sources")
        .update({
          next_chunk_idx: batch[batch.length - 1].idx + 1,
          char_count: text.length,
          processing_started_at: new Date().toISOString(),
        })
        .eq("id", source.id);
    }

    await supabase
      .from("sources")
      .update({
        status: "ready",
        error: null,
        char_count: text.length,
        next_chunk_idx: chunks.length,
        processing_started_at: null,
      })
      .eq("id", source.id);

    return NextResponse.json({ status: "ready", chunks_written: written });
  } catch (error) {
    return await fail(error instanceof Error ? error.message : "Ingestion failed");
  }
}

async function extractText(blob: Blob, kind: Source["kind"]): Promise<string> {
  if (kind !== "pdf") return blob.text();

  // unpdf, not pdf-parse: pdf-parse reaches for the filesystem and does not run
  // on serverless.
  const { extractText: extractPdfText, getDocumentProxy } = await import("unpdf");
  const pdf = await getDocumentProxy(new Uint8Array(await blob.arrayBuffer()));
  const { text } = await extractPdfText(pdf, { mergePages: true });

  // unpdf emits one newline per *visual line*, never a blank one, so chunk()
  // would see the whole document as a single paragraph and hard-split it
  // mid-sentence. Restore paragraph breaks before it gets there.
  return normalizePdfText(text);
}
