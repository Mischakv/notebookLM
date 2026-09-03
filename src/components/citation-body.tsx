import type { ReactNode } from "react";

/**
 * Renders a retrieved chunk as formatted text rather than raw Markdown.
 *
 * URL sources are stored as Markdown (turndown), so a citation shown verbatim
 * displays "## Urlaub" and "**30 Tage**" as literal characters — the one place
 * in the app where the user reads source text directly, and it looks unfinished.
 *
 * Deliberately not `react-markdown`: that pulls in remark and a plugin chain to
 * render a handful of inline marks inside a citation box. AGENTS.md keeps the
 * dependency list narrow, and the subset that actually appears in a chunk is
 * small enough to handle here — headings, bullets, bold, italic, inline code,
 * and links. Anything unrecognised falls through as plain text, which is exactly
 * the current behaviour, so an unsupported construct degrades rather than breaks.
 *
 * No HTML is ever constructed from the string: every branch returns React
 * elements, so chunk content cannot inject markup. There is no
 * dangerouslySetInnerHTML here on purpose.
 */

/** Inline marks, in one pass so nesting cannot double-apply. */
const INLINE = /(\*\*[^*]+\*\*|__[^_]+__|\*[^*]+\*|_[^_]+_|`[^`]+`|\[[^\]]+\]\([^)]+\))/;

function renderInline(text: string, keyPrefix: string): ReactNode[] {
  return text.split(INLINE).filter(Boolean).map((part, i) => {
    const key = `${keyPrefix}-${i}`;

    if (part.startsWith("**") && part.endsWith("**")) {
      return <strong key={key}>{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith("__") && part.endsWith("__")) {
      return <strong key={key}>{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith("`") && part.endsWith("`")) {
      return (
        <code key={key} className="bg-muted rounded px-1 py-0.5 text-[0.9em]">
          {part.slice(1, -1)}
        </code>
      );
    }
    if (part.startsWith("*") && part.endsWith("*")) {
      return <em key={key}>{part.slice(1, -1)}</em>;
    }
    if (part.startsWith("_") && part.endsWith("_")) {
      return <em key={key}>{part.slice(1, -1)}</em>;
    }

    const link = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(part);
    if (link) {
      const href = link[2];
      // Only http(s) becomes a link. A chunk is untrusted text, and `javascript:`
      // in an href is the one way this renderer could do something unexpected.
      if (/^https?:\/\//i.test(href)) {
        return (
          <a
            key={key}
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="underline underline-offset-2"
          >
            {link[1]}
          </a>
        );
      }
      return <span key={key}>{link[1]}</span>;
    }

    return <span key={key}>{part}</span>;
  });
}

const HEADING = /^(#{1,6})\s+(.*)$/;
const BULLET = /^\s*[-*•]\s+(.*)$/;
const ORDERED = /^\s*(\d+)[.)]\s+(.*)$/;

/**
 * Blocks are separated by blank lines — the same unit the chunker splits on, so
 * a chunk usually contains a small number of them.
 */
export function CitationBody({ content, className }: { content: string; className?: string }) {
  const blocks = content.replace(/\r\n?/g, "\n").split(/\n\s*\n/);

  return (
    <div className={className}>
      {blocks.map((block, blockIndex) => {
        const trimmed = block.trim();
        if (!trimmed) return null;
        const key = `b${blockIndex}`;
        const lines = trimmed.split("\n");

        const heading = HEADING.exec(trimmed);
        if (heading && lines.length === 1) {
          // Rendered as a consistent small-caps label rather than h1..h6: inside a
          // citation box, a real <h1> would compete with the panel's own heading.
          return (
            <p key={key} className="text-foreground mt-3 mb-1 font-medium first:mt-0">
              {renderInline(heading[2], key)}
            </p>
          );
        }

        if (lines.every((line) => BULLET.test(line))) {
          return (
            <ul key={key} className="my-2 list-disc space-y-1 pl-5">
              {lines.map((line, i) => (
                <li key={`${key}-${i}`}>{renderInline(BULLET.exec(line)![1], `${key}-${i}`)}</li>
              ))}
            </ul>
          );
        }

        if (lines.every((line) => ORDERED.test(line))) {
          return (
            <ol key={key} className="my-2 list-decimal space-y-1 pl-5">
              {lines.map((line, i) => (
                <li key={`${key}-${i}`}>{renderInline(ORDERED.exec(line)![2], `${key}-${i}`)}</li>
              ))}
            </ol>
          );
        }

        // A plain paragraph. Single newlines inside it are soft wraps from the
        // source and are joined, matching how the text was meant to read.
        return (
          <p key={key} className="my-2 first:mt-0 last:mb-0">
            {renderInline(lines.join(" "), key)}
          </p>
        );
      })}
    </div>
  );
}
