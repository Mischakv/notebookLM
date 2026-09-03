import { describe, expect, it } from "vitest";

import { chunk, estimateTokens } from "@/lib/chunk";

const paragraph = (words: number, word = "lorem") =>
  Array.from({ length: words }, () => word).join(" ");

describe("chunk", () => {
  it("returns nothing for empty or whitespace-only input", () => {
    expect(chunk("")).toEqual([]);
    expect(chunk("   \n\n  \t ")).toEqual([]);
  });

  it("keeps short text as a single chunk", () => {
    const result = chunk("One short paragraph.");
    expect(result).toHaveLength(1);
    expect(result[0].content).toBe("One short paragraph.");
    expect(result[0].idx).toBe(0);
    expect(result[0].tokenCount).toBeGreaterThan(0);
  });

  it("splits on paragraph boundaries rather than mid-paragraph", () => {
    const paragraphs = Array.from({ length: 12 }, (_, i) => `P${i} ${paragraph(60)}`);
    const result = chunk(paragraphs.join("\n\n"), { targetTokens: 200, overlapTokens: 0 });

    expect(result.length).toBeGreaterThan(1);
    // With overlap off, no paragraph may be cut in half: each one appears whole
    // inside some chunk.
    for (const p of paragraphs) {
      expect(result.some((c) => c.content.includes(p))).toBe(true);
    }
  });

  it("hard-splits a single paragraph that exceeds the budget", () => {
    const result = chunk(paragraph(2000), { targetTokens: 100, overlapTokens: 0 });
    expect(result.length).toBeGreaterThan(1);
    for (const c of result) {
      expect(c.tokenCount).toBeLessThanOrEqual(100);
    }
  });

  it("carries whole paragraphs over when they fit the overlap allowance", () => {
    // Unique markers, so this fails if overlap is removed — an assertion on
    // filler words would pass on coincidental repetition.
    const paragraphs = Array.from({ length: 40 }, (_, i) => `MARKER-${i} ${paragraph(8)}`);
    const result = chunk(paragraphs.join("\n\n"), { targetTokens: 200, overlapTokens: 60 });

    expect(result.length).toBeGreaterThan(1);
    for (let i = 1; i < result.length; i++) {
      const last = [...result[i - 1].content.matchAll(/MARKER-(\d+)/g)].at(-1)!;
      expect(result[i].content).toContain(`MARKER-${last[1]}`);
    }
  });

  it("carries a character tail when no whole paragraph fits the allowance", () => {
    // Paragraphs larger than the overlap budget: the tail of the previous chunk
    // still has to reappear, or a claim split across the boundary is retrievable
    // from neither side.
    const paragraphs = Array.from(
      { length: 10 },
      (_, i) => `${paragraph(40)} END-${i}`,
    );
    const result = chunk(paragraphs.join("\n\n"), { targetTokens: 200, overlapTokens: 60 });

    expect(result.length).toBeGreaterThan(1);
    for (let i = 1; i < result.length; i++) {
      const last = [...result[i - 1].content.matchAll(/END-(\d+)/g)].at(-1)!;
      expect(result[i].content).toContain(`END-${last[1]}`);
    }
  });

  it("never exceeds the token budget", () => {
    const text = Array.from({ length: 40 }, (_, i) => `P${i} ${paragraph(90)}`).join("\n\n");
    for (const c of chunk(text, { targetTokens: 300, overlapTokens: 50 })) {
      expect(c.tokenCount).toBeLessThanOrEqual(300);
    }
  });

  it("counts the paragraph separators against the budget", () => {
    // Regression: summing piece tokens instead of measuring the joined string let
    // chunks come out a token over budget once a chunk held many small pieces.
    const text = Array.from({ length: 200 }, (_, i) => `Paragraph ${i}. ${paragraph(12)}`).join(
      "\n\n",
    );
    for (const c of chunk(text)) {
      expect(c.tokenCount).toBeLessThanOrEqual(800);
      expect(c.tokenCount).toBe(estimateTokens(c.content));
    }
  });

  it("stays within budget across paragraph shapes and settings", () => {
    // Regression: the overlap carried into a new chunk was sized against the
    // incoming piece alone, ignoring the separator, so chunks came out one token
    // over. Only showed up on real documents, hence the spread of shapes here.
    const shapes = [
      Array.from({ length: 60 }, (_, i) => `P${i}. ${paragraph(120)}`).join("\n\n"),
      Array.from({ length: 300 }, (_, i) => `P${i}. ${paragraph(3)}`).join("\n\n"),
      paragraph(9000),
      [paragraph(700), paragraph(4), paragraph(650), paragraph(9)].join("\n\n"),
    ];
    const settings = [
      { targetTokens: 800, overlapTokens: 120 },
      { targetTokens: 200, overlapTokens: 60 },
      { targetTokens: 64, overlapTokens: 32 },
    ];

    for (const text of shapes) {
      for (const options of settings) {
        for (const c of chunk(text, options)) {
          expect(c.tokenCount).toBeLessThanOrEqual(options.targetTokens);
        }
      }
    }
  });

  it("numbers chunks sequentially from zero", () => {
    const text = Array.from({ length: 20 }, (_, i) => `P${i} ${paragraph(80)}`).join("\n\n");
    const result = chunk(text, { targetTokens: 200, overlapTokens: 40 });
    expect(result.map((c) => c.idx)).toEqual(result.map((_, i) => i));
  });

  it("normalizes line endings and drops empty paragraphs", () => {
    const result = chunk("A\r\n\r\n\r\n\r\nB");
    expect(result).toHaveLength(1);
    expect(result[0].content).toBe("A\n\nB");
  });

  it("estimates tokens as roughly a quarter of the character count", () => {
    expect(estimateTokens("")).toBe(0);
    expect(estimateTokens("abcd")).toBe(1);
    expect(estimateTokens("a".repeat(400))).toBe(100);
  });
});
