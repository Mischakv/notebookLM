import { describe, expect, it } from "vitest";

import { chunk } from "@/lib/chunk";
import { normalizePdfText } from "@/lib/pdf-text";

/**
 * Heuristics with no ground truth to check against, operating on the input that
 * decides what every PDF citation looks like. A regression here is silent — the
 * app still works, the quotes just start reading like "…rderung genehmigt".
 */
describe("normalizePdfText", () => {
  it("joins wrapped lines into one paragraph", () => {
    const extracted = "Die Kernarbeitszeit liegt zwischen\n10:00 und 15:00 Uhr im Büro.";
    expect(normalizePdfText(extracted)).toBe(
      "Die Kernarbeitszeit liegt zwischen 10:00 und 15:00 Uhr im Büro.",
    );
  });

  it("breaks a paragraph where a sentence ends and a new one starts capitalised", () => {
    const extracted = "Der Urlaub beträgt 30 Tage.\nAnträge gehen an die Teamleitung.";
    expect(normalizePdfText(extracted).split("\n\n")).toEqual([
      "Der Urlaub beträgt 30 Tage.",
      "Anträge gehen an die Teamleitung.",
    ]);
  });

  it("does not break mid-sentence when the next line continues lowercase", () => {
    // The period belongs to "z.B." — a naive sentence split would cut here.
    const extracted = "Zugelassen sind Hardware-Token und TOTP.\nsofern sie registriert sind.";
    expect(normalizePdfText(extracted)).not.toContain("\n\n");
  });

  it("rejoins a word hyphenated across a line break", () => {
    expect(normalizePdfText("Die Sicher-\nheitsrichtlinie gilt.")).toBe(
      "Die Sicherheitsrichtlinie gilt.",
    );
  });

  it("keeps headings and list items as their own paragraphs", () => {
    const extracted = "## Urlaub\nDer Urlaub beträgt 30 Tage.\n- Antrag stellen\n- Freigabe abwarten";
    expect(normalizePdfText(extracted).split("\n\n")).toEqual([
      "## Urlaub",
      "Der Urlaub beträgt 30 Tage.",
      "- Antrag stellen",
      "- Freigabe abwarten",
    ]);
  });

  it("drops page furniture that would otherwise land inside a quote", () => {
    const extracted = "Ende des Abschnitts.\n12\nSeite 3 von 20\nNeuer Abschnitt beginnt.";
    const result = normalizePdfText(extracted);
    expect(result).not.toContain("Seite 3 von 20");
    expect(result).not.toMatch(/(^|\n)12($|\n)/);
  });

  it("preserves blank lines that the extractor already produced", () => {
    const extracted = "Erster Absatz.\n\nZweiter Absatz.";
    expect(normalizePdfText(extracted).split("\n\n")).toEqual([
      "Erster Absatz.",
      "Zweiter Absatz.",
    ]);
  });

  it("strips soft hyphens and non-breaking spaces from the text layer", () => {
    expect(normalizePdfText("Ver­trag mit Kunden.")).toBe("Vertrag mit Kunden.");
  });
});

describe("normalizePdfText + chunk", () => {
  /**
   * The reason this module exists, asserted end to end: raw extractor output is
   * one paragraph and chunks mid-sentence; normalised output chunks on
   * boundaries. This is the test that fails if the heuristics stop working.
   */
  const rawPdfLines = [
    "Die Kernarbeitszeit liegt zwischen 10:00 und 15:00 Uhr.",
    "Ausserhalb dieser Zeiten ist die Einteilung frei.",
    "Der Jahresurlaub beträgt 30 Tage bei einer Fünf-Tage-Woche.",
    "Urlaubsanträge werden vier Wochen im Voraus gestellt.",
  ].join("\n");

  it("turns single-newline extractor output into real paragraphs", () => {
    expect(rawPdfLines.split(/\n\s*\n/)).toHaveLength(1); // the bug: one blob
    expect(normalizePdfText(rawPdfLines).split("\n\n").length).toBeGreaterThan(1);
  });

  it("produces chunks that end at a sentence rather than mid-word", () => {
    const chunks = chunk(normalizePdfText(rawPdfLines), { targetTokens: 20 });
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) {
      expect(c.content.trim()).toMatch(/[.!?:;»"')\]]$/);
    }
  });
});
