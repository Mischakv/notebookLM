import type { MatchedChunk } from "@/lib/types";

/**
 * The whole grounding contract lives here, in one template, so it can be read and
 * argued with rather than reconstructed from three call sites.
 */
export const SYSTEM_PROMPT = `You are answering questions about a specific set of documents the user has provided.

Rules, in order of importance:

1. Answer only from the numbered context blocks below. Do not use outside knowledge, and do not fill gaps with what is usually true.
2. Cite every claim with the number of the block it came from, written as [1] or [2]. Put the citation immediately after the sentence it supports. Cite more than one block as [1][2] when a claim rests on both. Every factual sentence needs a citation. Use only the numbers of the blocks listed below for this question — those numbers are valid for this answer only. Earlier answers in this conversation show citations as [*], because their numbers referred to different blocks; never copy [*] into your answer and never reuse a number from an earlier turn.
3. If the context does not contain the answer, say so plainly and stop. Do not apologise at length, and do not offer a guess. Say what the sources do cover, if anything nearby.
4. Do not mention "the context", "the blocks" or "the excerpts" in your answer. Write as if quoting the documents directly, with the citation doing that work.
5. Match the question's language and keep the answer as short as it can be while still complete.

Context blocks:

{{CONTEXT}}`;

/**
 * Numbers the retrieved chunks; the numbers are what [n] refers to. The index is
 * the contract — `resolveCitations` maps [n] back to `chunks[n - 1]`, so the
 * order here and the order stored must never diverge.
 *
 * Each block is labelled with the document it came from. Retrieval returns the
 * nearest chunks across *all* sources ordered by similarity, so blocks from
 * different documents interleave: [1] and [3] may be one PDF, [2] another. With
 * bare numbers the model cannot tell them apart, and it attributes a claim from
 * one document to a passage in another — the citation opens, but to the wrong
 * text. Naming the source in the block is what makes the distinction visible.
 *
 * The title is on its own line and the body is untouched, so the numbering the
 * model sees still lines up one-to-one with the array index.
 */
export function buildSystemPrompt(
  chunks: MatchedChunk[],
  sourceTitles: Record<string, string> = {},
): string {
  const context =
    chunks.length === 0
      ? "(No sources matched this question. Say so.)"
      : chunks
          .map((chunk, i) => {
            const title = sourceTitles[chunk.source_id];
            const label = title ? `[${i + 1}] from "${title}"` : `[${i + 1}]`;
            return `${label}\n${chunk.content}`;
          })
          .join("\n\n---\n\n");

  return SYSTEM_PROMPT.replace("{{CONTEXT}}", context);
}
