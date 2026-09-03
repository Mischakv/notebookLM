import { describe, expect, it } from "vitest";

import { resolveCitations } from "@/lib/citations";
import { buildSystemPrompt } from "@/lib/prompts";
import type { MatchedChunk } from "@/lib/types";

/**
 * The numbering contract: the block labelled [n] in the prompt and the chunk
 * `resolveCitations` returns for [n] must be the same passage. These two live in
 * different files and are joined only by an index, so nothing but a test holds
 * them together.
 */

function chunkOf(id: string, sourceId: string, content: string, idx = 0): MatchedChunk {
  return { id, source_id: sourceId, idx, content, similarity: 0.9 };
}

const CHUNKS: MatchedChunk[] = [
  chunkOf("c1", "s-handbook", "Der Jahresurlaub beträgt 30 Tage."),
  chunkOf("c2", "s-security", "Passwörter haben mindestens 16 Zeichen."),
  chunkOf("c3", "s-handbook", "Die Kernarbeitszeit liegt zwischen 10:00 und 15:00 Uhr.", 1),
];

const TITLES = {
  "s-handbook": "Onboarding-Handbuch",
  "s-security": "Sicherheitsrichtlinie",
};

describe("buildSystemPrompt", () => {
  it("numbers blocks from one, in retrieval order", () => {
    const prompt = buildSystemPrompt(CHUNKS, TITLES);
    expect(prompt).toContain("[1]");
    expect(prompt).toContain("[2]");
    expect(prompt).toContain("[3]");
    expect(prompt).not.toContain("[0]");
    // Order matters: [1] must precede [2] in the rendered context.
    expect(prompt.indexOf("[1]")).toBeLessThan(prompt.indexOf("[2]"));
  });

  it("names the document each block came from", () => {
    const prompt = buildSystemPrompt(CHUNKS, TITLES);
    // Blocks from different sources interleave; without the label the model
    // cannot tell [1] and [2] apart and attributes claims across documents.
    expect(prompt).toContain('[1] from "Onboarding-Handbuch"');
    expect(prompt).toContain('[2] from "Sicherheitsrichtlinie"');
    expect(prompt).toContain('[3] from "Onboarding-Handbuch"');
  });

  it("falls back to a bare number when a title is missing", () => {
    const prompt = buildSystemPrompt(CHUNKS);
    expect(prompt).toContain("[1]\n");
    expect(prompt).not.toContain("from \"undefined\"");
  });

  it("keeps the chunk body verbatim", () => {
    const prompt = buildSystemPrompt(CHUNKS, TITLES);
    for (const chunk of CHUNKS) expect(prompt).toContain(chunk.content);
  });

  it("tells the model to say so when nothing matched", () => {
    expect(buildSystemPrompt([], TITLES)).toContain("No sources matched");
  });
});

describe("prompt numbering round-trips through resolveCitations", () => {
  it("maps every [n] back to the block that carried that number", () => {
    const answer = "Urlaub sind 30 Tage [1]. Passwörter brauchen 16 Zeichen [2].";
    const resolved = resolveCitations(answer, CHUNKS, TITLES);

    expect(resolved.map((c) => c.n)).toEqual([1, 2]);
    expect(resolved[0].chunk_id).toBe("c1");
    expect(resolved[0].source_title).toBe("Onboarding-Handbuch");
    expect(resolved[1].chunk_id).toBe("c2");
    expect(resolved[1].source_title).toBe("Sicherheitsrichtlinie");
  });

  it("resolves a citation to the same content the prompt showed under that number", () => {
    const prompt = buildSystemPrompt(CHUNKS, TITLES);
    for (let n = 1; n <= CHUNKS.length; n++) {
      const [resolved] = resolveCitations(`Claim [${n}].`, CHUNKS, TITLES);
      // The body under "[n]" in the prompt is the body the panel will open.
      const blockStart = prompt.indexOf(`[${n}]`);
      expect(prompt.slice(blockStart)).toContain(resolved.content);
    }
  });

  it("drops a number the retrieval set does not contain", () => {
    // The model inventing [9] must not render as evidence pointing nowhere.
    expect(resolveCitations("Behauptung [9].", CHUNKS, TITLES)).toEqual([]);
  });
});
