"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ExternalLink, FileText, Globe, MoreHorizontal, Type } from "lucide-react";
import { toast } from "sonner";

import { AddSourceDialog } from "@/components/add-source-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { deleteSource } from "@/lib/actions/sources";
import { createClient } from "@/lib/supabase/client";
import { sourceMetadataSchema, type Source } from "@/lib/types";

/** Enough calls for a very large document; short of an unbounded retry loop. */
const MAX_INGEST_CALLS = 40;
const POLL_MS = 3000;

const STATUS_DOT: Record<Source["status"], string> = {
  pending: "bg-muted-foreground/40",
  processing: "bg-primary animate-pulse ring-2 ring-primary/30",
  ready: "bg-primary",
  error: "bg-destructive",
};

const STATUS_LABEL: Record<Source["status"], string> = {
  pending: "In der Warteschlange",
  processing: "Wird gelesen…",
  ready: "Bereit",
  error: "Fehlgeschlagen",
};

const KIND_ICON: Record<Source["kind"], typeof FileText> = {
  pdf: FileText,
  text: Type,
  markdown: Type,
  url: Globe,
};

export function SourceRail({
  notebookId,
  initialSources,
}: {
  notebookId: string;
  initialSources: Source[];
}) {
  const [sources, setSources] = useState(initialSources);
  const ingesting = useRef(new Set<string>());
  const router = useRouter();
  /**
   * Which sources this rail has already announced as ready. `ChatPanel` is a
   * *sibling*, not a child: it receives `hasReadySources` as a prop computed on
   * the server in page.tsx. Updating local state here therefore cannot unlock
   * the chat input — only re-running the server component can, which is what
   * router.refresh() does.
   *
   * Tracked as a ref of ids rather than a boolean so the refresh fires on the
   * *edge* into ready, once per source. The poll below calls refresh() every few
   * seconds; refreshing the route on each of those would re-render the page
   * continuously for as long as anything is processing.
   */
  const announced = useRef(
    // Seeded from what the server already rendered: those sources are the reason
    // the current props say what they say, so re-fetching them is not news.
    new Set(initialSources.filter((s) => s.status === "ready").map((s) => s.id)),
  );

  const refresh = useCallback(async () => {
    const supabase = createClient();
    const { data } = await supabase
      .from("sources")
      .select("*")
      .eq("notebook_id", notebookId)
      .order("created_at", { ascending: true })
      .returns<Source[]>();
    if (data) {
      setSources(data);

      // A source that just became ready changes what the server would render:
      // the chat input goes from disabled to enabled, and the source titles in
      // the empty state appear. Ask Next to re-run page.tsx so those props catch
      // up, instead of leaving the user to press reload.
      const freshlyReady = data.filter(
        (source) => source.status === "ready" && !announced.current.has(source.id),
      );
      if (freshlyReady.length > 0) {
        for (const source of freshlyReady) announced.current.add(source.id);
        router.refresh();
      }
    }
    return data ?? [];
  }, [notebookId, router]);

  /**
   * Ingestion is client-driven: there is no queue, so the page that uploaded a
   * source is the thing that asks for it to be processed, and keeps asking while
   * the route reports `processing` (which is how a long document resumes from
   * its cursor).
   *
   * Bounded, and paused between calls. `held` means another tab owns the lease,
   * in which case this tab stops driving and just watches.
   */
  const ingest = useCallback(
    async (sourceId: string) => {
      if (ingesting.current.has(sourceId)) return;
      ingesting.current.add(sourceId);
      try {
        for (let call = 0; call < MAX_INGEST_CALLS; call++) {
          const response = await fetch(`/api/sources/${sourceId}/ingest`, { method: "POST" });
          const result = (await response.json()) as {
            status?: string;
            error?: string;
            held?: boolean;
          };
          await refresh();

          if (result.held) return;
          if (result.status === "processing") {
            await new Promise((resolve) => setTimeout(resolve, 400));
            continue;
          }
          if (result.status !== "ready") {
            toast.error(result.error ?? "Diese Quelle konnte nicht gelesen werden");
          }
          return;
        }
        toast.error("Diese Quelle dauert ungewöhnlich lange. Versuche es in der Leiste noch einmal.");
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Die Verarbeitung ist fehlgeschlagen");
        await refresh();
      } finally {
        ingesting.current.delete(sourceId);
      }
    },
    [refresh],
  );

  // Anything left unfinished by a previous visit is picked back up here.
  useEffect(() => {
    for (const source of initialSources) {
      if (source.status === "pending" || source.status === "processing") {
        void ingest(source.id);
      }
    }
  }, [initialSources, ingest]);

  // A source being ingested in another tab changes status without this tab doing
  // anything, so poll while anything is unsettled — and stop as soon as it is.
  useEffect(() => {
    const unsettled = sources.some(
      (source) => source.status === "pending" || source.status === "processing",
    );
    if (!unsettled) return;

    const timer = setInterval(() => void refresh(), POLL_MS);
    return () => clearInterval(timer);
  }, [sources, refresh]);

  return (
    <div className="flex h-full flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-xs font-medium tracking-wide uppercase">Quellen</h2>
        {sources.length > 0 && (
          <AddSourceDialog
            notebookId={notebookId}
            variant="outline"
            label="Hinzufügen"
            onAdded={async (id) => {
              await refresh();
              void ingest(id);
            }}
          />
        )}
      </div>

      {sources.length === 0 ? (
        <div className="space-y-3">
          <p className="text-muted-foreground text-xs">
            Antworten kommen nur aus dem, was du hinzufügst. Füge ein Paper, ein
            Transkript oder deine Notizen hinzu — alles, was du sonst durchscrollen
            würdest.
          </p>
          <AddSourceDialog
            notebookId={notebookId}
            label="Erste Quelle hinzufügen"
            onAdded={async (id) => {
              await refresh();
              void ingest(id);
            }}
          />
        </div>
      ) : (
        <ul className="min-h-0 flex-1 space-y-1 overflow-y-auto">
          {sources.map((source) => (
            <SourceItem
              key={source.id}
              source={source}
              notebookId={notebookId}
              onChanged={refresh}
              onRetry={() => ingest(source.id)}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function SourceItem({
  source,
  notebookId,
  onChanged,
  onRetry,
}: {
  source: Source;
  notebookId: string;
  onChanged: () => Promise<Source[]>;
  onRetry: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const KindIcon = KIND_ICON[source.kind];
  const provenance = describeSource(source);

  function onDelete() {
    const formData = new FormData();
    formData.set("id", source.id);
    formData.set("notebookId", notebookId);
    startTransition(async () => {
      const result = await deleteSource(formData);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      await onChanged();
    });
  }

  return (
    <li className="group rounded-md px-2 py-2 hover:bg-muted/60">
      <div className="flex items-start gap-2">
        <span
          aria-hidden
          className={`mt-1.5 size-1.5 shrink-0 rounded-full ${STATUS_DOT[source.status]}`}
        />
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1.5 truncate" title={source.title}>
            <KindIcon className="text-muted-foreground size-3.5 shrink-0" aria-hidden />
            <span className="truncate">{source.title}</span>
          </p>
          <p className="text-muted-foreground text-xs">
            {STATUS_LABEL[source.status]}
            {source.status === "ready" && source.char_count > 0
              ? ` · ${source.char_count.toLocaleString()} Zeichen`
              : ""}
          </p>
          {provenance && <p className="text-muted-foreground truncate text-xs">{provenance}</p>}
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger
            aria-label={`Aktionen für ${source.title}`}
            disabled={pending}
            className="text-muted-foreground hover:text-foreground hover:bg-muted focus-visible:ring-ring/50 flex size-7 shrink-0 items-center justify-center rounded-lg transition-colors outline-none focus-visible:ring-3 disabled:opacity-50"
          >
            <MoreHorizontal className="size-4" aria-hidden />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {source.kind === "url" && source.source_url && (
              <DropdownMenuItem asChild>
                <a href={source.source_url} target="_blank" rel="noopener noreferrer">
                  <ExternalLink aria-hidden />
                  Original öffnen
                </a>
              </DropdownMenuItem>
            )}
            {source.status === "error" && (
              <DropdownMenuItem onSelect={onRetry}>Erneut versuchen</DropdownMenuItem>
            )}
            <DropdownMenuItem onSelect={onDelete}>
              {pending ? "Wird entfernt…" : "Entfernen"}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {source.status === "error" && source.error && (
        <div className="mt-2 ml-3.5 space-y-1">
          <p className="text-destructive text-xs">{source.error}</p>
          <button
            type="button"
            onClick={onRetry}
            className="text-muted-foreground hover:text-foreground text-xs underline"
          >
            Erneut versuchen
          </button>
        </div>
      )}
    </li>
  );
}

/** `site_name · 12. März 2024`, with each half omitted when the page did not
 *  supply it. Returns null rather than an empty string so the caller can skip
 *  the element entirely.
 *
 *  `metadata` is `jsonb` from arbitrary web pages, not a value we control, so
 *  it is Zod-parsed here rather than trusted as `SourceMetadata` — a malformed
 *  row renders no provenance instead of throwing or showing junk. */
function describeSource(source: Source): string | null {
  const parsed = sourceMetadataSchema.safeParse(source.metadata);
  if (!parsed.success) return null;
  const metadata = parsed.data;

  const parts: string[] = [];
  if (metadata.site_name) parts.push(metadata.site_name);

  if (metadata.published_at) {
    const date = new Date(metadata.published_at);
    // Pages publish all sorts of things in this field; an unparseable one is
    // simply not shown.
    if (!Number.isNaN(date.getTime())) {
      // This component is server-rendered before it hydrates client-side. Without
      // a pinned timeZone, formatting resolves the host's local zone — UTC on the
      // server, whatever the visitor is on in the browser — so a date near a day
      // boundary can print a different day on each side and React reports a
      // hydration mismatch. Berlin is the honest reading of "published on" for a
      // German-language app anyway.
      parts.push(
        date.toLocaleDateString("de-DE", {
          day: "numeric",
          month: "long",
          year: "numeric",
          timeZone: "Europe/Berlin",
        }),
      );
    }
  }

  return parts.length > 0 ? parts.join(" · ") : null;
}
