import type { Citation, MatchedChunk } from "@/lib/types";

/**
 * Turning `[n]` in an answer back into the chunk it came from. Pure and unit
 * tested, because this is the join between what the model said and what the
 * sources actually contain — the part a reader is trusting.
 *
 * `n` is one-indexed and refers to the numbered context blocks in the prompt,
 * which are the retrieved chunks in retrieval order.
 */

/**
 * A citation is a bracketed list of bare numbers: [1], [1,2], [1, 2, 3].
 * Anything else in brackets — prose, an array index, a markdown link — is not.
 *
 * Exported because the renderer has to split on exactly the same thing: if the
 * two disagree, the citations shown differ from the citations stored.
 */
export const CITATION_PATTERN = String.raw`\[(\d+(?:\s*,\s*\d+)*)\](?!\()`;

const CITATION_GROUP = new RegExp(CITATION_PATTERN, "g");

/**
 * Replaces `[1]`, `[1,2]` and the like with a neutral `[*]` marker.
 *
 * Used on prior assistant turns before they are replayed to the model, and the
 * exact behaviour here matters more than it looks.
 *
 * The *numbers* must go: [n] is only meaningful against the context blocks of
 * the turn that produced it, and every turn retrieves a different set. Replaying
 * "…30 Tage [2]" into a request whose block 2 is now a different passage teaches
 * a wrong pairing, which the model imitates.
 *
 * But deleting them outright is worse. The history is the strongest example the
 * model has of what an answer here looks like, and several turns of its own
 * prose with no citation anywhere reads as "answers in this conversation do not
 * cite" — few-shot imitation beats an instruction in the system prompt, so it
 * quietly stops citing altogether. `[*]` keeps the shape of a cited answer while
 * carrying no number that could be mistaken for a current block.
 *
 * Lives here, beside the pattern it depends on, so it cannot drift from what the
 * parser and the renderer count as a citation.
 */
export function stripCitationMarkers(text: string): string {
  return text.replace(new RegExp(CITATION_PATTERN, "g"), "[*]").trim();
}

/**
 * The neutral marker `stripCitationMarkers` leaves behind.
 *
 * The system prompt tells the model never to copy `[*]` into a new answer, but an
 * instruction is not a guarantee — every model echoes it occasionally. It carries
 * no number, so it can never resolve to a passage, and left in place it renders
 * as literal "[*]" in the middle of a sentence: visible debris from a mechanism
 * the reader knows nothing about. Stripped on the way out instead.
 */
const ECHOED_MARKER = /\s*\[\*\]/g;

/**
 * Removes `[*]` markers a model copied out of the replayed history.
 *
 * Applied to the answer text before it is rendered or stored, so the debris
 * never reaches the reader and never lands in the transcript that will itself be
 * replayed later.
 */
export function stripEchoedMarkers(text: string): string {
  return text.replace(ECHOED_MARKER, "");
}

export function parseCitations(text: string): number[] {
  const seen = new Set<number>();
  const found: number[] = [];

  for (const match of text.matchAll(CITATION_GROUP)) {
    for (const part of match[1].split(",")) {
      const n = Number.parseInt(part.trim(), 10);
      // Zero is not a citation: the blocks are numbered from one.
      if (!Number.isInteger(n) || n < 1 || seen.has(n)) continue;
      seen.add(n);
      found.push(n);
    }
  }
  return found;
}

/**
 * Resolves `[n]` against the chunks that were actually retrieved. A number that
 * points past them is dropped rather than rendered: a citation that opens
 * nothing is worse than no citation, because it still looks like evidence.
 */
export function resolveCitations(
  text: string,
  chunks: MatchedChunk[],
  sourceTitles: Record<string, string>,
): Citation[] {
  return parseCitations(text)
    .filter((n) => n <= chunks.length)
    .map((n) => {
      const chunk = chunks[n - 1];
      return {
        n,
        chunk_id: chunk.id,
        source_id: chunk.source_id,
        source_title: sourceTitles[chunk.source_id] ?? "Untitled source",
        idx: chunk.idx,
        content: chunk.content,
      };
    });
}
