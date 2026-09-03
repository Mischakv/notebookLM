import { describe, expect, it } from "vitest";

import { EVAL_DOCUMENTS } from "@/lib/eval/fixtures";
import { evaluateRetrieval, rankChunks, tokenize } from "@/lib/eval/retrieval";
import { chunk } from "@/lib/chunk";

/**
 * Regression floors, not targets. These are thresholds the current chunker
 * clears; they exist so a change that quietly makes retrieval worse fails here
 * rather than surfacing as a confidently wrong answer in the UI.
 *
 * Raise a floor in the same commit as a deliberate improvement. If a change
 * pushes one down, that is the finding — do not lower the floor to make it pass.
 */

/**
 * Small on purpose. At the production target of 800 tokens each fixture document
 * is a single chunk, and a single-chunk document makes every question a trivial
 * hit — the harness would report a number it had not earned. At 120 the corpus
 * splits into 8–9 chunks, so retrieval has to actually choose.
 */
const EVAL_TARGET_TOKENS = 120;

describe("retrieval quality", () => {
  const report = evaluateRetrieval(EVAL_DOCUMENTS, { targetTokens: EVAL_TARGET_TOKENS });

  it("splits the corpus into enough chunks for the measurement to mean anything", () => {
    for (const document of EVAL_DOCUMENTS) {
      const chunks = chunk(document.text, { targetTokens: EVAL_TARGET_TOKENS });
      expect(chunks.length).toBeGreaterThan(3);
    }
  });

  it("holds the hit rate at or above the established floor", () => {
    expect(report.hitRate).toBeGreaterThanOrEqual(0.9);
  });

  it("ranks the right chunk near the top, not merely inside the window", () => {
    // 1.0 would be rank 1 every time. This floor still fails if the correct
    // chunk starts sinking down the list, which hitRate alone would hide.
    expect(report.mrr).toBeGreaterThanOrEqual(0.85);
  });

  it("misses only the known compound-word case", () => {
    // Documented, not hidden: the question says "Weiterbildungsbudget" while the
    // text says "Weiterbildung" and "Budget" separately, so a lexical ranker
    // scores zero overlap. This is the specific weakness embeddings are for, and
    // it is exactly the kind of gap this harness exists to make visible.
    // If this list shrinks, the retrieval path improved — tighten the floors.
    expect(report.results.filter((r) => !r.hit).map((r) => r.id)).toEqual([
      "handbook-weiterbildung-budget",
    ]);
  });
});

describe("rankChunks", () => {
  it("prefers the chunk that actually answers the question", () => {
    const chunks = chunk(EVAL_DOCUMENTS[0].text, { targetTokens: EVAL_TARGET_TOKENS });
    const [top] = rankChunks("Wie viele Urlaubstage gibt es pro Jahr?", chunks);
    expect(top.content).toContain("30 Tage");
  });

  it("returns nothing when no term overlaps, rather than an arbitrary order", () => {
    const chunks = chunk("Ein Absatz über Fahrräder.\n\nEin Absatz über Brot.");
    expect(rankChunks("quantum chromodynamics", chunks)).toEqual([]);
  });
});

describe("tokenize", () => {
  it("drops stopwords and short tokens so scoring reflects content words", () => {
    expect(tokenize("Wie lange werden die Protokolldaten aufbewahrt?")).toEqual([
      "lange",
      "protokolldaten",
      "aufbewahrt",
    ]);
  });
});
