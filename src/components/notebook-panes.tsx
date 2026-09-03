"use client";

import { useEffect, useState } from "react";
import { PanelLeft } from "lucide-react";

import { SourceRail } from "@/components/source-rail";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useIsMobile } from "@/hooks/use-is-mobile";
import type { Source } from "@/lib/types";

/**
 * Two panes on desktop. On mobile the rail is a bottom sheet rather than a block
 * above the chat, where it would push the conversation off screen.
 *
 * The mobile Sheet only mounts while `isMobile` is true (see `useIsMobile`):
 * `SheetContent` renders a portalled overlay that ignores `md:hidden`, so
 * gating on visibility alone would leave a full-viewport scrim over the
 * desktop layout. Because the Sheet unmounts as soon as the viewport widens
 * past 768px, `SourceRail` is mounted twice — once inside the mobile sheet,
 * once in the desktop aside — but never at the same time: each breakpoint
 * owns its own instance rather than one shared across a conditional. Both
 * instances would drive ingestion, but `ingest` already guards per source id
 * with the `ingesting` ref, and the server holds a lease
 * (`0003_ingest_lease.sql`) that returns `held` to a second driver — so the
 * duplicate mount is safe, and only one instance is ever mounted at a time.
 */
export function NotebookPanes({
  notebookId,
  initialSources,
  children,
}: {
  notebookId: string;
  initialSources: Source[];
  children: React.ReactNode;
}) {
  const [railOpen, setRailOpen] = useState(false);
  const isMobile = useIsMobile();

  // Widening past the mobile breakpoint hands the sources over to the desktop
  // aside and unmounts the Sheet. Reset `railOpen` so narrowing back down
  // doesn't silently re-open the sheet without the user tapping "Quellen"
  // again — the sheet should only ever appear in direct response to a click.
  useEffect(() => {
    if (!isMobile) setRailOpen(false);
  }, [isMobile]);

  return (
    <div className="flex h-full min-h-0 flex-col md:flex-row">
      <button
        type="button"
        onClick={() => setRailOpen(true)}
        className="border-border text-muted-foreground hover:text-foreground flex shrink-0 items-center gap-2 border-b px-6 py-3 text-sm md:hidden"
      >
        <PanelLeft className="size-4" aria-hidden />
        Quellen ({initialSources.length})
      </button>

      {isMobile && (
        <Sheet open={railOpen} onOpenChange={setRailOpen}>
          <SheetContent side="bottom" className="h-[70dvh] px-6 py-5">
            <SheetHeader className="p-0">
              <SheetTitle className="sr-only">Quellen</SheetTitle>
            </SheetHeader>
            <SourceRail notebookId={notebookId} initialSources={initialSources} />
          </SheetContent>
        </Sheet>
      )}

      <aside className="border-border bg-surface-raised hidden w-72 shrink-0 overflow-y-auto border-r px-5 py-5 md:block">
        <SourceRail notebookId={notebookId} initialSources={initialSources} />
      </aside>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col">{children}</div>
    </div>
  );
}
