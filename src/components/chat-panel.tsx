"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { CitationBody } from "@/components/citation-body";
import { CitationPanel, CitationTitle, resolveCitationSource } from "@/components/citation-panel";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { useIsMobile } from "@/hooks/use-is-mobile";
import { CITATION_PATTERN, stripEchoedMarkers } from "@/lib/citations";
import { PROVIDER_CONFIG_HEADER, providerConfigHeader } from "@/lib/provider-config";
import { chunkFor, reconcileTurns, toTurn, type Turn } from "@/lib/turns";
import type { Message, RetrievedChunk, Source } from "@/lib/types";

export function ChatPanel({
  notebookId,
  initialMessages,
  hasReadySources,
  sourceTitles,
  sources,
}: {
  notebookId: string;
  initialMessages: Message[];
  hasReadySources: boolean;
  sourceTitles: string[];
  sources: Source[];
}) {
  const [turns, setTurns] = useState<Turn[]>(() => initialMessages.map(toTurn));

  /**
   * Reconcile the optimistic turns with what the server actually stored.
   *
   * A streamed turn is created under a temporary `pending-<time>` id and keeps
   * that id forever — it is never swapped for the real `messages.id`. So once
   * the page re-runs (any router.refresh(), including the one the source rail
   * fires when an ingest finishes), `initialMessages` arrives holding the *same*
   * turns under their real ids while the pending copies are still in state.
   *
   * Left alone that duplicates the conversation, and the duplicate is the
   * dangerous half: the persisted copy carries `citations` but no `chunks`, and
   * `chunkFor` resolves a live `chunks` array positionally. Two turns for one
   * exchange means [1] can be answered by the wrong turn's array — which is
   * exactly "the second answer opens the first answer's passage".
   *
   * Server rows win: they are the durable truth. Only genuinely in-flight turns
   * (still streaming, not yet persisted) are kept on top.
   */
  useEffect(() => {
    setTurns((prev) => reconcileTurns(prev, initialMessages));
  }, [initialMessages]);
  const [input, setInput] = useState("");
  const [pending, setPending] = useState(false);
  const [open, setOpen] = useState<{ chunk: RetrievedChunk; n: number } | null>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const isMobile = useIsMobile();

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth" });
  }, [turns]);

  async function send(event: React.FormEvent) {
    event.preventDefault();
    const question = input.trim();
    if (!question || pending) return;

    setInput("");
    setPending(true);
    const answerId = `pending-${Date.now()}`;
    setTurns((prev) => [
      ...prev,
      { id: `q-${answerId}`, role: "user", content: question, citations: null },
      { id: answerId, role: "assistant", content: "", citations: null },
    ]);

    try {
      const configHeader = providerConfigHeader();
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(configHeader ? { [PROVIDER_CONFIG_HEADER]: configHeader } : {}),
        },
        body: JSON.stringify({ notebookId, message: question }),
      });

      if (!response.ok || !response.body) {
        const { error } = (await response.json().catch(() => ({ error: null }))) as {
          error?: string;
        };
        throw new Error(error ?? "Der Chat ist fehlgeschlagen");
      }

      await consume(response.body, answerId);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Der Chat ist fehlgeschlagen");
      // Drop the empty assistant bubble rather than leaving it hanging.
      setTurns((prev) => prev.filter((turn) => turn.id !== answerId));
    } finally {
      setPending(false);
    }
  }

  /**
   * The response is a JSON header line (the retrieved chunks) followed by the
   * answer text. Everything after the first newline is the answer.
   */
  async function consume(body: ReadableStream<Uint8Array>, answerId: string) {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffered = "";
    let chunks: RetrievedChunk[] | undefined;

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffered += decoder.decode(value, { stream: true });

      if (!chunks) {
        const newline = buffered.indexOf("\n");
        if (newline === -1) continue;
        chunks = (JSON.parse(buffered.slice(0, newline)) as { chunks: RetrievedChunk[] })
          .chunks;
        buffered = buffered.slice(newline + 1);
        setTurns((prev) =>
          prev.map((turn) => (turn.id === answerId ? { ...turn, chunks } : turn)),
        );
      }

      // Stripped here as well as on the server, and it has to be both. The
      // server stores the stripped text; reconcileTurns matches an optimistic
      // turn against the stored row by content, so a client holding the raw
      // string would fail to match its own row and show the exchange twice.
      const text = stripEchoedMarkers(buffered);
      setTurns((prev) =>
        prev.map((turn) => (turn.id === answerId ? { ...turn, content: text } : turn)),
      );
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col md:flex-row">
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-6">
          {turns.length === 0 ? (
            <div className="mx-auto max-w-2xl space-y-6">
              <div className="space-y-2">
                <p className="font-heading text-xl">Frag deine Quellen etwas</p>
                <p className="text-muted-foreground">
                  {hasReadySources
                    ? "Antworten stammen ausschließlich aus dem, was du hinzugefügt hast, und jede Aussage ist nummeriert, damit du sie an der Textstelle prüfen kannst."
                    : "Füge zuerst eine Quelle hinzu. Ohne etwas zu lesen gibt es nichts zu beantworten."}
                </p>
              </div>

              {hasReadySources && sourceTitles.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {sourceTitles.slice(0, 3).map((title) => (
                    <button
                      key={title}
                      type="button"
                      onClick={() => setInput(`Worum geht es in „${title}“?`)}
                      className="border-border bg-card hover:border-primary/30 max-w-full truncate rounded-full border px-4 py-2 text-sm transition-colors"
                    >
                      Worum geht es in „{title}“?
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="mx-auto max-w-2xl space-y-6">
              {turns.map((turn) => (
                <Turn key={turn.id} turn={turn} onOpen={setOpen} pending={pending} />
              ))}
              <div ref={bottom} />
            </div>
          )}
        </div>

        <form onSubmit={send} className="border-border shrink-0 border-t px-6 py-4">
          <div className="mx-auto flex max-w-2xl items-end gap-2">
            <Textarea
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  void send(event);
                }
              }}
              rows={1}
              placeholder={
                hasReadySources ? "Frag deine Quellen…" : "Füge eine Quelle hinzu, um zu starten"
              }
              className="max-h-40 min-h-9 resize-none"
              disabled={!hasReadySources}
            />
            <Button type="submit" disabled={pending || !hasReadySources || !input.trim()}>
              {pending ? "Denkt nach…" : "Fragen"}
            </Button>
          </div>
        </form>
      </div>

      {open && (
        <CitationPanel chunk={open.chunk} n={open.n} onClose={() => setOpen(null)} sources={sources} />
      )}

      {isMobile && (
        <Sheet open={open !== null} onOpenChange={(next) => !next && setOpen(null)}>
          <SheetContent side="bottom" className="h-[70dvh]">
            <SheetHeader>
              <SheetTitle className="font-heading">Beleg {open?.n}</SheetTitle>
            </SheetHeader>
            {open && <MobileCitationBody open={open} sources={sources} />}
          </SheetContent>
        </Sheet>
      )}
    </div>
  );
}

/**
 * The mobile Sheet's citation body. Mirrors CitationPanel's provenance (link
 * for a website source, site name beneath it) via the shared helper, so a
 * phone gets the same "open the original page" affordance as desktop — just
 * inside a bottom sheet instead of a side pane.
 */
function MobileCitationBody({
  open,
  sources,
}: {
  open: { chunk: RetrievedChunk; n: number };
  sources: Source[];
}) {
  const { source, siteName } = resolveCitationSource(open.chunk, sources);

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-6">
      <CitationTitle chunk={open.chunk} source={source} className="text-sm font-medium" />
      {siteName && <p className="text-muted-foreground text-xs">{siteName}</p>}
      <p className="text-muted-foreground mb-3 text-sm">Passage {open.chunk.idx + 1}</p>
      <CitationBody content={open.chunk.content} className="text-sm" />
    </div>
  );
}

function Turn({
  turn,
  onOpen,
  pending,
}: {
  turn: Turn;
  onOpen: (open: { chunk: RetrievedChunk; n: number }) => void;
  pending: boolean;
}) {
  if (turn.role === "user") {
    return (
      <div className="flex justify-end">
        <p className="bg-muted max-w-[85%] rounded-2xl px-3 py-2 whitespace-pre-wrap">
          {turn.content}
        </p>
      </div>
    );
  }

  if (turn.content.length === 0) {
    if (!pending) return null;
    return (
      <div className="flex items-center gap-2" role="status" aria-label="Antwort wird erstellt">
        <span className="bg-primary size-1.5 animate-bounce rounded-full [animation-delay:-0.3s]" />
        <span className="bg-primary size-1.5 animate-bounce rounded-full [animation-delay:-0.15s]" />
        <span className="bg-primary size-1.5 animate-bounce rounded-full" />
        <span className="text-muted-foreground ml-1 text-sm">Deine Quellen werden gelesen…</span>
      </div>
    );
  }

  return (
    <div className="whitespace-pre-wrap">
      {renderWithCitations(turn, onOpen)}
    </div>
  );
}

/**
 * Splits the answer on `[n]` and makes each one a button. Uses the turn's own
 * retrieved chunks while streaming, and the persisted citations for turns loaded
 * from the database.
 */
function renderWithCitations(
  turn: Turn,
  onOpen: (open: { chunk: RetrievedChunk; n: number }) => void,
): React.ReactNode[] {
  // Same pattern the parser uses, so what is rendered and what is stored agree.
  // CITATION_PATTERN has exactly one capture group (the digits), so split
  // alternates: even indices are plain text, odd indices are citation numbers.
  const parts = turn.content.split(new RegExp(CITATION_PATTERN, "g"));

  return parts.map((part, i) => {
    const isCitation = i % 2 === 1;
    if (!isCitation) return <span key={i}>{part}</span>;

    const numbers = part.split(",").map((n) => Number.parseInt(n.trim(), 10));
    return (
      <span key={i}>
        {numbers.map((n) => {
          const chunk = chunkFor(turn, n);
          if (!chunk) return <span key={n}>[{n}]</span>;
          return (
            <button
              key={n}
              type="button"
              onClick={() => onOpen({ chunk, n })}
              className="bg-primary/15 text-primary hover:bg-primary/25 mx-0.5 inline-flex min-w-6 items-center justify-center rounded-md px-1.5 py-0.5 align-baseline text-xs font-medium transition-colors"
              title={chunk.source_title}
            >
              {n}
            </button>
          );
        })}
      </span>
    );
  });
}

