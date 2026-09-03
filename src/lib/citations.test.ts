import { describe, expect, it } from "vitest";

import {
  parseCitations,
  resolveCitations,
  stripCitationMarkers,
  stripEchoedMarkers,
} from "@/lib/citations";
import type { MatchedChunk } from "@/lib/types";

const chunks: MatchedChunk[] = [
  { id: "c1", content: "First chunk", source_id: "s1", idx: 0, similarity: 0.9 },
  { id: "c2", content: "Second chunk", source_id: "s2", idx: 3, similarity: 0.8 },
  { id: "c3", content: "Third chunk", source_id: "s1", idx: 1, similarity: 0.7 },
];

const titles = { s1: "Paper A", s2: "Paper B" };

describe("parseCitations", () => {
  it("finds nothing in text without citations", () => {
    expect(parseCitations("No citations here at all.")).toEqual([]);
  });

  it("finds single citations in order of first appearance", () => {
    expect(parseCitations("Water is wet [2]. Fire is hot [1].")).toEqual([2, 1]);
  });

  it("deduplicates repeated citations", () => {
    expect(parseCitations("[1] and again [1] and [2] and [1]")).toEqual([1, 2]);
  });

  it("handles adjacent citations", () => {
    expect(parseCitations("Both agree [1][2].")).toEqual([1, 2]);
  });

  it("handles comma-separated groups", () => {
    expect(parseCitations("All three say so [1, 2,3].")).toEqual([1, 2, 3]);
  });

  it("ignores brackets that are not citations", () => {
    expect(parseCitations("An aside [see below] and code arr[i] and [] and [0].")).toEqual([]);
  });

  it("ignores markdown links", () => {
    expect(parseCitations("See [1](https://example.com) for more.")).toEqual([]);
  });
});

describe("resolveCitations", () => {
  it("maps [n] to the nth retrieved chunk, one-indexed", () => {
    const resolved = resolveCitations("Claim [1] and claim [3].", chunks, titles);
    expect(resolved.map((c) => c.n)).toEqual([1, 3]);
    expect(resolved[0].chunk_id).toBe("c1");
    expect(resolved[0].source_title).toBe("Paper A");
    expect(resolved[1].chunk_id).toBe("c3");
    expect(resolved[1].content).toBe("Third chunk");
  });

  it("drops citations that point past the retrieved chunks", () => {
    // A model that invents [9] must not produce a citation that opens nothing.
    expect(resolveCitations("Claim [9].", chunks, titles)).toEqual([]);
  });

  it("falls back to a placeholder title for an unknown source", () => {
    const resolved = resolveCitations("Claim [2].", chunks, {});
    expect(resolved[0].source_title).toBe("Untitled source");
  });

  it("returns nothing when there is nothing to resolve", () => {
    expect(resolveCitations("Plain answer.", chunks, titles)).toEqual([]);
    expect(resolveCitations("Claim [1].", [], titles)).toEqual([]);
  });
});

/**
 * Stale citation markers are the reason citations drifted: every turn retrieves a
 * different set of blocks, so a [2] from an earlier answer means something else
 * now. Replaying it teaches the model a wrong pairing that it goes on to imitate.
 *
 * The replacement is `[*]`, not nothing. Deleting the markers outright shipped
 * once and stopped the model citing at all: several turns of its own prose with
 * no citation anywhere is a stronger example than the instruction telling it to
 * cite. These tests pin both halves — no live numbers, but the shape survives.
 */
describe("stripCitationMarkers", () => {
  it("replaces a marker with the neutral one", () => {
    expect(stripCitationMarkers("Der Urlaub beträgt 30 Tage [1].")).toBe(
      "Der Urlaub beträgt 30 Tage [*].",
    );
  });

  it("replaces grouped and multi-number markers", () => {
    expect(stripCitationMarkers("Beides gilt [1][2].")).toBe("Beides gilt [*][*].");
    expect(stripCitationMarkers("Beides gilt [1, 2].")).toBe("Beides gilt [*].");
  });

  it("leaves no digit that could be read as a current block number", () => {
    const replayed = stripCitationMarkers("30 Tage [1]. 16 Zeichen [2]. Beides [1,3].");
    expect(replayed).not.toMatch(/\[\d/);
  });

  it("keeps a citation marker present, so the answer still looks cited", () => {
    // The regression this guards: with the markers deleted the model saw
    // uncited answers as the house style and stopped citing entirely.
    const replayed = stripCitationMarkers("Passwörter brauchen 16 Zeichen [2].");
    expect(replayed).toContain("[*]");
  });

  it("keeps the prose, which is the part worth replaying", () => {
    expect(stripCitationMarkers("Passwörter brauchen 16 Zeichen [2]. SMS ist nicht erlaubt [3].")).toBe(
      "Passwörter brauchen 16 Zeichen [*]. SMS ist nicht erlaubt [*].",
    );
  });

  it("leaves a markdown link alone", () => {
    // CITATION_PATTERN excludes [text](url); replacing must honour that too.
    const text = "Siehe [die Richtlinie](https://example.com/policy) für Details.";
    expect(stripCitationMarkers(text)).toBe(text);
  });

  it("leaves text with no citations unchanged", () => {
    expect(stripCitationMarkers("Ein Satz ohne Belege.")).toBe("Ein Satz ohne Belege.");
  });
});

/**
 * The other half of the `[*]` mechanism. The system prompt tells the model never
 * to copy the marker into a new answer, but an instruction is not a guarantee —
 * and an echoed `[*]` carries no number, so it can never open a passage. Left
 * alone it renders as literal debris mid-sentence, which reads to the user as a
 * citation that failed.
 */
describe("stripEchoedMarkers", () => {
  it("removes a marker the model copied out of the history", () => {
    expect(stripEchoedMarkers("Der Urlaub beträgt 30 Tage [*].")).toBe(
      "Der Urlaub beträgt 30 Tage.",
    );
  });

  it("removes the space before the marker, leaving no double spacing", () => {
    expect(stripEchoedMarkers("30 Tage [*] und mehr")).toBe("30 Tage und mehr");
  });

  it("removes several markers", () => {
    expect(stripEchoedMarkers("Eins [*]. Zwei [*]. Drei [*].")).toBe("Eins. Zwei. Drei.");
  });

  it("leaves real citations untouched — only the numberless marker goes", () => {
    expect(stripEchoedMarkers("30 Tage [1] und 16 Zeichen [2].")).toBe(
      "30 Tage [1] und 16 Zeichen [2].",
    );
  });

  it("leaves an answer with no markers unchanged", () => {
    expect(stripEchoedMarkers("Ein Satz ohne Belege.")).toBe("Ein Satz ohne Belege.");
  });

  it("survives a full replay round trip without accumulating debris", () => {
    // What actually happens across turns: an answer is stripped for replay, the
    // model echoes the marker back, and the echo is removed before storage. The
    // stored text must not carry a marker into the *next* replay.
    const replayed = stripCitationMarkers("30 Tage [1].");
    expect(replayed).toBe("30 Tage [*].");
    expect(stripEchoedMarkers(`Wie gesagt ${replayed}`)).toBe("Wie gesagt 30 Tage.");
  });
});
