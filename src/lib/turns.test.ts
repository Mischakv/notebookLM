import { describe, expect, it } from "vitest";

import { chunkFor, reconcileTurns, type Turn } from "@/lib/turns";
import type { Citation, Message, RetrievedChunk } from "@/lib/types";

function citation(n: number, content: string, chunkId = `c${n}`): Citation {
  return {
    n,
    chunk_id: chunkId,
    source_id: "s1",
    source_title: "Handbuch",
    idx: n - 1,
    content,
  };
}

function retrieved(content: string, id = "live"): RetrievedChunk {
  return { id, content, source_id: "s1", source_title: "Handbuch", idx: 0, similarity: 0.9 };
}

function message(id: string, role: Message["role"], content: string, citations: Citation[] | null): Message {
  return { id, role, content, citations } as Message;
}

/**
 * The reported bug: the first answer cites [1] correctly, the second answer's [1]
 * opens the *first* answer's passage. Both halves are reproduced here.
 */
describe("reconcileTurns", () => {
  it("replaces an optimistic turn with the stored row of the same exchange", () => {
    const optimistic: Turn[] = [
      { id: "q-pending-1", role: "user", content: "Wie viel Urlaub?", citations: null },
      { id: "pending-1", role: "assistant", content: "30 Tage [1].", citations: null,
        chunks: [retrieved("Passage A")] },
    ];
    const stored: Message[] = [
      message("m1", "user", "Wie viel Urlaub?", null),
      message("m2", "assistant", "30 Tage [1].", [citation(1, "Passage A")]),
    ];

    const result = reconcileTurns(optimistic, stored);

    // The exchange appears once, under its real id — not twice.
    expect(result).toHaveLength(2);
    expect(result.map((t) => t.id)).toEqual(["m1", "m2"]);
  });

  it("keeps a turn that is still streaming and not yet stored", () => {
    const previous: Turn[] = [
      { id: "m1", role: "user", content: "Erste Frage", citations: null },
      { id: "m2", role: "assistant", content: "Erste Antwort [1].", citations: [citation(1, "A")] },
      { id: "q-pending-2", role: "user", content: "Zweite Frage", citations: null },
      { id: "pending-2", role: "assistant", content: "Teilantwort…", citations: null,
        chunks: [retrieved("Passage B")] },
    ];
    const stored: Message[] = [
      message("m1", "user", "Erste Frage", null),
      message("m2", "assistant", "Erste Antwort [1].", [citation(1, "A")]),
    ];

    const result = reconcileTurns(previous, stored);

    expect(result).toHaveLength(4);
    expect(result[3].content).toBe("Teilantwort…");
  });

  it("leaves state alone before anything is stored", () => {
    const previous: Turn[] = [
      { id: "pending-1", role: "assistant", content: "…", citations: null },
    ];
    expect(reconcileTurns(previous, [])).toBe(previous);
  });

  it("does not duplicate the conversation across repeated refreshes", () => {
    const stored: Message[] = [
      message("m1", "user", "Frage", null),
      message("m2", "assistant", "Antwort [1].", [citation(1, "A")]),
    ];
    const once = reconcileTurns([], stored);
    const twice = reconcileTurns(once, stored);
    const thrice = reconcileTurns(twice, stored);
    expect(thrice).toHaveLength(2);
  });
});

describe("chunkFor", () => {
  it("resolves [n] from the stored citation, keyed by n", () => {
    const turn: Turn = {
      id: "m2", role: "assistant", content: "…[2]",
      citations: [citation(1, "Passage A"), citation(2, "Passage B")],
    };
    expect(chunkFor(turn, 2)?.content).toBe("Passage B");
  });

  it("prefers the stored citation over a positional live array", () => {
    // The regression: a turn holding another turn's `chunks` must not win. The
    // keyed citation is right by construction; position is not.
    const turn: Turn = {
      id: "m2", role: "assistant", content: "…[1]",
      citations: [citation(1, "Richtige Passage")],
      chunks: [retrieved("Passage der ersten Antwort")],
    };
    expect(chunkFor(turn, 1)?.content).toBe("Richtige Passage");
  });

  it("falls back to live chunks while streaming, before anything is stored", () => {
    const turn: Turn = {
      id: "pending-1", role: "assistant", content: "…[1]", citations: null,
      chunks: [retrieved("Live Passage")],
    };
    expect(chunkFor(turn, 1)?.content).toBe("Live Passage");
  });

  it("returns null for a number nothing backs, rather than a wrong passage", () => {
    const turn: Turn = {
      id: "m2", role: "assistant", content: "…[9]", citations: [citation(1, "A")],
    };
    expect(chunkFor(turn, 9)).toBeNull();
  });
});

/**
 * The empty-array fallthrough. `resolveCitations` returns `[]` — not null — when
 * an answer cited nothing resolvable, and that empty array is what gets stored.
 * `.find()` on it returns undefined, which used to fall through to the positional
 * `chunks` array the doc comment says must never win for a persisted turn.
 */
describe("chunkFor: stored citations are authoritative once they exist", () => {
  it("does not fall back to positional chunks when citations is an empty array", () => {
    const turn: Turn = {
      id: "m2", role: "assistant", content: "…[1]",
      citations: [],
      chunks: [retrieved("Passage einer anderen Antwort")],
    };
    expect(chunkFor(turn, 1)).toBeNull();
  });

  it("does not fall back for an n the stored citations do not cover", () => {
    // [5] survived into the prose but was dropped server-side as out of range.
    // Answering it from position would open an unrelated passage.
    const turn: Turn = {
      id: "m2", role: "assistant", content: "…[1] und [5]",
      citations: [citation(1, "Richtige Passage")],
      chunks: [retrieved("A"), retrieved("B"), retrieved("C"), retrieved("D"), retrieved("E")],
    };
    expect(chunkFor(turn, 5)).toBeNull();
    expect(chunkFor(turn, 1)?.content).toBe("Richtige Passage");
  });
});

/**
 * Asking the same question twice is ordinary. Keying reconciliation on
 * role+content collapsed both exchanges into one, losing a turn from the
 * transcript entirely.
 */
describe("reconcileTurns: repeated identical exchanges", () => {
  it("keeps both exchanges when the same question is asked twice", () => {
    const stored: Message[] = [
      message("m1", "user", "Wie viel Urlaub?", null),
      message("m2", "assistant", "30 Tage [1].", [citation(1, "A")]),
      message("m3", "user", "Wie viel Urlaub?", null),
      message("m4", "assistant", "30 Tage [1].", [citation(1, "A")]),
    ];
    const result = reconcileTurns([], stored);
    expect(result).toHaveLength(4);
    expect(result.map((t) => t.id)).toEqual(["m1", "m2", "m3", "m4"]);
  });

  it("drops an optimistic turn once its row is stored, matching by id not content", () => {
    const optimistic: Turn[] = [
      { id: "q-pending-9", role: "user", content: "Wie viel Urlaub?", citations: null },
      { id: "pending-9", role: "assistant", content: "30 Tage [1].", citations: null,
        chunks: [retrieved("A")] },
    ];
    const stored: Message[] = [
      message("m1", "user", "Wie viel Urlaub?", null),
      message("m2", "assistant", "30 Tage [1].", [citation(1, "A")]),
    ];
    expect(reconcileTurns(optimistic, stored)).toHaveLength(2);
  });
});
