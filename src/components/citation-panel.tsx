"use client";

import { X } from "lucide-react";

import { CitationBody } from "@/components/citation-body";
import { sourceMetadataSchema, type RetrievedChunk, type Source } from "@/lib/types";

/**
 * Resolves the source a chunk was retrieved from and derives what the title
 * and site-name line should render as. Shared by the desktop panel below and
 * chat-panel.tsx's mobile bottom Sheet, which shows the same provenance in a
 * different container — pulling this out keeps the safeParse + link-vs-plain-text
 * decision in one place instead of two copies drifting apart.
 *
 * `sources` exists because a `RetrievedChunk` carries only the source's title
 * (see `Citation` in `src/lib/types.ts`), not its URL or metadata — widening
 * that persisted shape would touch every existing `messages.citations` row.
 * Looking the source up by id here keeps the persisted citation shape untouched.
 */
export function resolveCitationSource(chunk: RetrievedChunk, sources: Source[]) {
  const source = sources.find((candidate) => candidate.id === chunk.source_id);
  // `metadata` is jsonb from the open web — never trust it as typed. A malformed
  // value is decorative provenance, so it is silently dropped rather than
  // breaking the panel.
  const metadata = sourceMetadataSchema.safeParse(source?.metadata ?? undefined);
  const siteName = metadata.success ? metadata.data.site_name : undefined;

  return { source, siteName };
}

/**
 * The citation title: a link to the original page for a website source, plain
 * text otherwise. `className` lets each container (side panel vs. bottom sheet)
 * apply its own type scale while sharing the link/fallback decision and the
 * mandatory `rel="noopener noreferrer"` (the URL came from the open web).
 */
export function CitationTitle({
  chunk,
  source,
  className,
}: {
  chunk: RetrievedChunk;
  source: Source | undefined;
  className: string;
}) {
  if (source?.kind === "url" && source.source_url) {
    return (
      <a
        href={source.source_url}
        target="_blank"
        rel="noopener noreferrer"
        title={chunk.source_title}
        className={`hover:text-primary underline-offset-4 hover:underline ${className}`}
      >
        {chunk.source_title}
      </a>
    );
  }
  return (
    <p className={className} title={chunk.source_title}>
      {chunk.source_title}
    </p>
  );
}

/**
 * What a citation actually points at. Shown beside the answer rather than in a
 * dialog: checking a claim means reading the source next to the sentence that
 * made it, not instead of it. On mobile there is no room for a side pane, so
 * chat-panel.tsx renders this same idea as a bottom sheet instead — anchored
 * near the conversation rather than replacing it, for the same reason.
 */
export function CitationPanel({
  chunk,
  n,
  onClose,
  sources,
}: {
  chunk: RetrievedChunk;
  n: number;
  onClose: () => void;
  sources: Source[];
}) {
  const { source, siteName } = resolveCitationSource(chunk, sources);

  return (
    <aside className="border-border bg-card hidden h-full min-h-0 w-80 shrink-0 flex-col border-l md:flex">
      <div className="border-border flex shrink-0 items-start justify-between gap-3 border-b px-5 py-3">
        <div className="min-w-0">
          <p className="text-muted-foreground text-xs">Beleg {n}</p>
          <CitationTitle chunk={chunk} source={source} className="truncate font-medium" />
          {siteName && <p className="text-muted-foreground truncate text-xs">{siteName}</p>}
          <p className="text-muted-foreground text-xs">
            Passage {chunk.idx + 1}
            {/* A citation restored from the transcript has no similarity to show. */}
            {chunk.similarity > 0 ? ` · ${(chunk.similarity * 100).toFixed(0)}% Treffer` : ""}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Beleg schließen"
          className="text-muted-foreground hover:text-foreground hover:bg-muted flex size-7 shrink-0 items-center justify-center rounded-lg transition-colors"
        >
          <X className="size-4" aria-hidden />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
        <CitationBody content={chunk.content} />
      </div>
    </aside>
  );
}
