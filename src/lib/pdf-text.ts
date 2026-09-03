/**
 * Restoring paragraph structure to PDF text.
 *
 * `chunk()` splits on blank lines, because a paragraph is the unit that survives
 * retrieval intact. PDF extraction does not produce blank lines: `unpdf` returns
 * one `\n` per *visual line*, so a document arrives as hundreds of short lines
 * with no paragraph breaks at all. `splitParagraphs` then sees a single enormous
 * paragraph and hard-splits it at the token budget — mid-sentence, mid-word.
 *
 * That is the difference between a citation that reads as a quote and one that
 * starts "…rderung genehmigt, sofern". So before chunking, line breaks that are
 * merely wrapping get joined, and the ones that actually end a paragraph get
 * doubled into the blank line the chunker is looking for.
 *
 * Heuristics, not parsing: PDFs carry no paragraph markup, so there is nothing to
 * read. These rules are conservative — when a break is ambiguous it is treated as
 * a wrap and the text is joined, because a chunk that is slightly too long costs
 * far less than one split through the middle of a sentence.
 */

/** A line that ends a paragraph: terminal punctuation, optionally quoted or bracketed. */
const SENTENCE_END = /[.!?:;»"')\]]\s*$/;

/** Headings and list items stand alone rather than flowing into the next line. */
const STANDALONE = /^\s*(#{1,6}\s|[-*•·—–]\s|\d+[.)]\s|[A-Z0-9][.)]\s)/;

/** A hyphen at end of line is a word broken across the wrap: "Sicher-\nheit". */
const HYPHEN_BREAK = /(\p{Ll})-$/u;

/** Page furniture: a bare number, or "Seite 4 von 12" / "Page 4 of 12". */
const PAGE_NUMBER = /^\s*(\d{1,4}|(seite|page)\s+\d{1,4}(\s+(von|of)\s+\d{1,4})?)\s*$/i;

/**
 * True when `line` ends a paragraph and `next` starts a new one.
 *
 * The signal is mostly the *next* line: prose that continues a sentence starts
 * lowercase. A line ending in terminal punctuation followed by a line starting
 * uppercase is the clearest paragraph boundary a PDF offers.
 */
function endsParagraph(line: string, next: string | undefined): boolean {
  if (next === undefined) return true;
  if (next.length === 0) return true;
  if (STANDALONE.test(next)) return true;
  if (STANDALONE.test(line)) return true;
  if (!SENTENCE_END.test(line)) return false;

  // Terminal punctuation plus a capitalised (or numbered) start: a new paragraph.
  // "1." also counts — enumerations survive as their own units.
  return /^\s*[\p{Lu}\d"'«»(\[]/u.test(next);
}

/**
 * Normalises extracted PDF text so `chunk()` can find paragraph boundaries.
 * Safe to run on text that already has blank lines: those are preserved as-is.
 */
export function normalizePdfText(raw: string): string {
  const lines = raw
    .replace(/\r\n?/g, "\n")
    // Soft hyphen and non-breaking space are common in PDF text layers and
    // survive extraction as invisible junk that breaks word matching.
    .replace(/­/g, "")
    .replace(/ /g, " ")
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .filter((line) => !PAGE_NUMBER.test(line));

  const paragraphs: string[] = [];
  let current = "";

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.length === 0) {
      // An existing blank line is already a paragraph break; honour it.
      if (current) paragraphs.push(current);
      current = "";
      continue;
    }

    const next = lines.slice(i + 1).find((candidate) => candidate.length > 0);

    if (current === "") {
      current = line;
    } else if (HYPHEN_BREAK.test(current)) {
      // "Sicher-" + "heit" is one word; join without a space and drop the hyphen.
      current = current.replace(HYPHEN_BREAK, "$1") + line;
    } else {
      current = `${current} ${line}`;
    }

    if (endsParagraph(line, next)) {
      paragraphs.push(current);
      current = "";
    }
  }
  if (current) paragraphs.push(current);

  // Blank-line separated: exactly what splitParagraphs() looks for.
  return paragraphs.join("\n\n");
}
