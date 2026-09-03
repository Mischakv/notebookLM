import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";
import TurndownService from "turndown";

import type { SourceMetadata } from "@/lib/types";

/**
 * Below this, whatever readability found is navigation chrome or a paywall
 * teaser rather than an article. Storing it would produce a source that answers
 * questions confidently and wrongly, which is worse than an error.
 */
const MIN_CHARS = 200;

export class ExtractionError extends Error {}

/**
 * Turndown core ships no table/tr/td rules, so an untouched <table> falls
 * through to the default replacement, which concatenates every cell's text
 * with no delimiters — row and column relationships vanish. That corrupted
 * text still gets chunked and embedded, so a retrieval like "was kostet Pro?"
 * can surface a chunk pairing the wrong price with the wrong package. This
 * rule renders GFM pipe tables instead, so the structure survives into RAG.
 *
 * Rows are collected by walking `children` rather than `querySelectorAll`:
 * Turndown parses its input with its own minimal bundled DOM (not linkedom's),
 * which does not support the `:scope` combinator, and walking children also
 * means a table nested inside a cell is never descended into — its text is
 * simply folded into that cell via `textContent`, which is an acceptable
 * degradation for a case rare enough not to warrant structural support.
 */
function addTableRule(turndown: TurndownService): void {
  const collectRows = (el: HTMLElement, rows: HTMLElement[]): HTMLElement[] => {
    for (const child of Array.from(el.children) as HTMLElement[]) {
      if (child.tagName === "TR") rows.push(child);
      else if (["THEAD", "TBODY", "TFOOT"].includes(child.tagName)) collectRows(child, rows);
    }
    return rows;
  };

  turndown.addRule("table", {
    filter: "table",
    replacement: (_content, node) => {
      const rows = collectRows(node, []);
      if (rows.length === 0) return "";

      // <br> contributes nothing to textContent, so without this a line break
      // inside a cell would silently glue two words together.
      const cellText = (cell: Element): string => {
        for (const br of Array.from(cell.querySelectorAll("br"))) {
          br.replaceWith(cell.ownerDocument.createTextNode("\n"));
        }
        return (cell.textContent ?? "")
          .replace(/\s*\n\s*/g, " ")
          .trim()
          .replace(/\|/g, "\\|");
      };

      const rowCells = rows.map((row) =>
        (Array.from(row.children) as HTMLElement[])
          .filter((cell) => cell.tagName === "TD" || cell.tagName === "TH")
          .map(cellText),
      );

      const columnCount = Math.max(...rowCells.map((cells) => cells.length));
      if (columnCount === 0) return "";

      // No <thead>: synthesise a header from the first row, since a GFM
      // table with no header row renders incorrectly.
      const [header, ...body] = rowCells;
      const pad = (cells: string[]): string[] =>
        Array.from({ length: columnCount }, (_, i) => cells[i] ?? "");

      const toLine = (cells: string[]): string => `| ${pad(cells).join(" | ")} |`;
      const separator = `| ${Array<string>(columnCount).fill("---").join(" | ")} |`;

      const lines = [toLine(header), separator, ...body.map(toLine)];
      return `\n\n${lines.join("\n")}\n\n`;
    },
  });
}

/**
 * Turns a fetched page into the Markdown that gets stored and chunked. linkedom
 * supplies the DOM, readability picks the article subtree out of the chrome, and
 * turndown renders it.
 */
export function extractArticle(
  html: string,
  url: URL,
): { title: string; markdown: string; metadata: SourceMetadata } {
  const { document } = parseHTML(html);

  const meta = (selector: string): string | undefined => {
    const content = document.querySelector(selector)?.getAttribute("content")?.trim();
    return content && content.length > 0 ? content : undefined;
  };

  // Read before Readability runs: it mutates the document it parses.
  const siteName = meta('meta[property="og:site_name"]');
  const author =
    meta('meta[property="article:author"]') ?? meta('meta[name="author"]');
  const publishedAt =
    meta('meta[property="article:published_time"]') ??
    meta('meta[name="date"]') ??
    document.querySelector("time[datetime]")?.getAttribute("datetime")?.trim() ??
    undefined;
  const ogTitle = meta('meta[property="og:title"]');
  const documentTitle = document.title?.trim();
  const headingTitle = document.querySelector("h1")?.textContent?.trim();

  const article = new Readability(document).parse();

  if (!article?.content) {
    throw new ExtractionError(
      "Von dieser Seite konnte kein Artikeltext gelesen werden. Paywalls und Seiten, die ihren Inhalt per JavaScript nachladen, funktionieren nicht.",
    );
  }

  const turndown = new TurndownService({
    headingStyle: "atx",
    codeBlockStyle: "fenced",
    bulletListMarker: "-",
  });
  addTableRule(turndown);
  const markdown = turndown.turndown(article.content).trim();

  if (markdown.length < MIN_CHARS) {
    throw new ExtractionError(
      "Von dieser Seite konnte kein Artikeltext gelesen werden. Paywalls und Seiten, die ihren Inhalt per JavaScript nachladen, funktionieren nicht.",
    );
  }

  const title =
    article.title?.trim() || ogTitle || documentTitle || headingTitle || url.hostname;

  const metadata: SourceMetadata = {
    // The hostname is a decent site name and is always available, so provenance
    // never renders empty.
    site_name: siteName ?? url.hostname,
    author: author ?? article.byline?.trim() ?? undefined,
    published_at: publishedAt,
    excerpt: article.excerpt?.trim() || undefined,
    word_count: markdown.split(/\s+/).filter(Boolean).length,
  };

  return { title: title.slice(0, 200), markdown, metadata };
}
