/**
 * Splitting text for retrieval. Pure, dependency-free and unit tested — chunking
 * decides what the model can and cannot see, so it is worth being able to reason
 * about in isolation.
 *
 * Paragraphs are the natural unit: a chunk that stops mid-sentence retrieves
 * badly and reads worse when cited. Only a paragraph that is itself over budget
 * gets hard-split.
 */

export type Chunk = {
  idx: number;
  content: string;
  tokenCount: number;
};

export type ChunkOptions = {
  /** Maximum tokens per chunk. */
  targetTokens?: number;
  /** Tokens of the previous chunk repeated at the start of the next one. */
  overlapTokens?: number;
};

const DEFAULT_TARGET_TOKENS = 800;
const DEFAULT_OVERLAP_TOKENS = 120;
const CHARS_PER_TOKEN = 4;

/**
 * Deliberately an estimate. A real tokenizer would pull in a model-specific
 * dependency to buy accuracy we do not need: the budget only has to keep chunks
 * comfortably inside the embedding model's context.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

export function chunk(text: string, options: ChunkOptions = {}): Chunk[] {
  const targetTokens = options.targetTokens ?? DEFAULT_TARGET_TOKENS;
  const overlapTokens = Math.min(
    options.overlapTokens ?? DEFAULT_OVERLAP_TOKENS,
    Math.floor(targetTokens / 2),
  );

  const paragraphs = splitParagraphs(text);
  if (paragraphs.length === 0) return [];

  // Anything over budget is broken down first, so packing never has to.
  const pieces = paragraphs.flatMap((paragraph) =>
    estimateTokens(paragraph) <= targetTokens
      ? [paragraph]
      : hardSplit(paragraph, targetTokens),
  );

  const chunks: string[] = [];
  let current: string[] = [];

  // Joined, not summed: the "\n\n" between pieces costs tokens too, and summing
  // the parts lets a chunk drift a token or two over budget.
  const tokensWith = (pieces: string[], next?: string) =>
    estimateTokens([...pieces, ...(next ? [next] : [])].join("\n\n"));

  for (const piece of pieces) {
    if (current.length > 0 && tokensWith(current, piece) > targetTokens) {
      chunks.push(current.join("\n\n"));
      current = overlapFrom(current, overlapTokens, targetTokens, piece);
    }
    current.push(piece);
  }
  if (current.length > 0) chunks.push(current.join("\n\n"));

  return chunks.map((content, idx) => ({
    idx,
    content,
    tokenCount: estimateTokens(content),
  }));
}

function splitParagraphs(text: string): string[] {
  return text
    .replace(/\r\n?/g, "\n")
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph.length > 0);
}

/**
 * The tail of the chunk just emitted, to repeat at the head of the next one.
 * Whole pieces where they fit; a character tail when the previous chunk was one
 * large hard-split piece and there is nothing smaller to carry.
 */
function overlapFrom(
  previous: string[],
  overlapTokens: number,
  targetTokens: number,
  incoming: string,
): string[] {
  const room = targetTokens - estimateTokens(incoming);
  if (overlapTokens <= 0 || room <= 0) return [];

  const allowance = Math.min(overlapTokens, room);
  const fits = (carried: string[]) =>
    estimateTokens([...carried, incoming].join("\n\n")) <= targetTokens;

  const carried: string[] = [];
  for (let i = previous.length - 1; i >= 0; i--) {
    const candidate = [previous[i], ...carried];
    if (estimateTokens(candidate.join("\n\n")) > allowance) break;
    if (!fits(candidate)) break;
    carried.unshift(previous[i]);
  }

  if (carried.length > 0) return carried;

  // Nothing whole fits, so carry a character tail of the last piece — and check
  // it against the joined length, since the separator costs a token too.
  let tail = trimLoneSurrogate(
    previous[previous.length - 1].slice(-allowance * CHARS_PER_TOKEN),
  );
  while (tail.length > 0 && !fits([tail])) {
    tail = trimLoneSurrogate(tail.slice(CHARS_PER_TOKEN));
  }
  return tail.length > 0 ? [tail] : [];
}

/**
 * Slicing by character count can land between the halves of a surrogate pair,
 * leaving a replacement character at the head of a chunk — invisible to the
 * embedding, visible to anyone reading the citation.
 */
function trimLoneSurrogate(text: string): string {
  const first = text.charCodeAt(0);
  return first >= 0xdc00 && first <= 0xdfff ? text.slice(1) : text;
}

/** Sentence boundaries where they exist, characters where they do not. */
function hardSplit(paragraph: string, targetTokens: number): string[] {
  const maxChars = targetTokens * CHARS_PER_TOKEN;
  const sentences = paragraph.match(/[^.!?]+[.!?]+[\s]*|[^.!?]+$/g) ?? [paragraph];

  const pieces: string[] = [];
  let current = "";

  for (const sentence of sentences) {
    for (const part of splitByLength(sentence, maxChars)) {
      if (current.length + part.length > maxChars && current.length > 0) {
        pieces.push(current.trim());
        current = "";
      }
      current += part;
    }
  }
  if (current.trim().length > 0) pieces.push(current.trim());

  return pieces;
}

function splitByLength(text: string, maxChars: number): string[] {
  if (text.length <= maxChars) return [text];
  const parts: string[] = [];
  for (let i = 0; i < text.length; i += maxChars) {
    parts.push(text.slice(i, i + maxChars));
  }
  return parts;
}
