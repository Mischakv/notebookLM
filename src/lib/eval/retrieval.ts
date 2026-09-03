/**
 * Retrieval quality, measured.
 *
 * The claim a RAG app makes is not "it returns text" — it is "it returns the
 * *right* text". That claim fails silently: a bad chunk size or a lost heading
 * still produces a fluent, confident, wrong answer. This module makes the claim
 * a number, so a change to the chunker can be judged instead of guessed at.
 *
 * Deliberately no embeddings and no network. Scoring here uses a lexical ranker
 * over the *real* chunker output, which means:
 *
 *   - it runs in CI, offline, with no API key and no pgvector,
 *   - it is deterministic, so a moved number means a real change, and
 *   - it isolates the variable actually under test — chunking. A drop in recall
 *     is a chunking regression, not provider drift.
 *
 * What it therefore does NOT measure: embedding quality, or the behaviour of
 * `match_chunks` in Postgres. This is a lower bound on retrievability — if the
 * words are not in a findable chunk, no embedding model will rescue them.
 */

import { chunk, type Chunk } from "@/lib/chunk";

export type EvalCase = {
  /** Stable id so a failure names something greppable. */
  id: string;
  question: string;
  /** Substrings that the correct chunk(s) must contain. Case-insensitive. */
  expectedContent: string[];
};

export type EvalDocument = {
  name: string;
  text: string;
  cases: EvalCase[];
};

export type CaseResult = {
  id: string;
  question: string;
  /** 1-based rank of the first chunk containing every expected substring. */
  hitRank: number | null;
  hit: boolean;
};

export type EvalReport = {
  total: number;
  hits: number;
  /** Fraction of cases whose answer appeared in the top k. */
  hitRate: number;
  /**
   * Mean reciprocal rank. Rewards ranking the right chunk *first*, not merely
   * somewhere in the window — hitRate alone hides a ranker that always scrapes in
   * at position k.
   */
  mrr: number;
  results: CaseResult[];
};

/** English + German stopwords: the corpus and the UI are both German. */
const STOPWORDS = new Set([
  "the", "a", "an", "is", "are", "was", "were", "of", "for", "to", "in", "on",
  "and", "or", "what", "which", "who", "how", "does", "do", "did", "with", "at",
  "der", "die", "das", "ein", "eine", "einen", "und", "oder", "ist", "sind",
  "was", "wie", "wer", "wo", "für", "von", "mit", "im", "in", "den", "dem",
  "auf", "es", "sich", "bei", "wird", "werden", "man", "nicht",
]);

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word.length > 2 && !STOPWORDS.has(word));
}

/**
 * Ranks chunks by how much of the question's vocabulary they contain, with a
 * mild length normalisation so a long chunk does not win on volume alone. This
 * stands in for cosine similarity: crude, but monotonic in the same direction —
 * which is all that is needed to detect a chunking regression.
 */
export function rankChunks(question: string, chunks: Chunk[]): Chunk[] {
  const terms = new Set(tokenize(question));

  return chunks
    .map((c) => {
      const words = tokenize(c.content);
      if (words.length === 0) return { c, score: 0 };
      let overlap = 0;
      for (const word of new Set(words)) if (terms.has(word)) overlap++;
      return { c, score: overlap / Math.sqrt(words.length) };
    })
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score || a.c.idx - b.c.idx)
    .map(({ c }) => c);
}

function containsAll(text: string, needles: string[]): boolean {
  const haystack = text.toLowerCase();
  return needles.every((needle) => haystack.includes(needle.toLowerCase()));
}

/**
 * Chunks each document once, then scores every question against it.
 *
 * `matchCount` mirrors MATCH_COUNT in the chat route: evaluating a window the
 * app does not actually use would measure a system that does not exist.
 */
export function evaluateRetrieval(
  documents: EvalDocument[],
  { matchCount = 8, targetTokens }: { matchCount?: number; targetTokens?: number } = {},
): EvalReport {
  const results: CaseResult[] = [];

  for (const document of documents) {
    // `targetTokens` is explicit because it is the variable under test. A corpus
    // shorter than the production 800-token target collapses to a single chunk,
    // and a single-chunk document makes every question a trivial hit — the
    // harness would report a score it had not earned. Passing a smaller target
    // forces real boundaries without needing a book-length fixture.
    const chunks = chunk(document.text, targetTokens ? { targetTokens } : {});
    for (const testCase of document.cases) {
      const ranked = rankChunks(testCase.question, chunks).slice(0, matchCount);
      const index = ranked.findIndex((c) => containsAll(c.content, testCase.expectedContent));
      results.push({
        id: testCase.id,
        question: testCase.question,
        hitRank: index === -1 ? null : index + 1,
        hit: index !== -1,
      });
    }
  }

  const hits = results.filter((r) => r.hit).length;
  const reciprocal = results.reduce((sum, r) => sum + (r.hitRank ? 1 / r.hitRank : 0), 0);

  return {
    total: results.length,
    hits,
    hitRate: results.length === 0 ? 0 : hits / results.length,
    mrr: results.length === 0 ? 0 : reciprocal / results.length,
    results,
  };
}
