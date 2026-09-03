import Link from "next/link";
import { notFound } from "next/navigation";

import { ChatPanel } from "@/components/chat-panel";
import { NotebookPanes } from "@/components/notebook-panes";
import { createClient } from "@/lib/supabase/server";
import type { Message, Notebook, Source } from "@/lib/types";

export default async function NotebookPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  // RLS filters out another user's notebook, so "not visible" and "does not
  // exist" are the same 404 from here.
  const { data: notebook } = await supabase
    .from("notebooks")
    .select("*")
    .eq("id", id)
    .maybeSingle<Notebook>();

  if (!notebook) notFound();

  const [{ data: sources }, { data: messages }] = await Promise.all([
    supabase
      .from("sources")
      .select("*")
      .eq("notebook_id", id)
      .order("created_at", { ascending: true })
      .returns<Source[]>(),
    supabase
      .from("messages")
      .select("*")
      .eq("notebook_id", id)
      // `id` is the tiebreaker, not decoration: ordering on a timestamp alone is
      // not a total order, and two turns that tie come back in an order the
      // planner is free to vary between reads. The chat panel resolves [n]
      // against the turn it renders, so a transcript that reorders makes a
      // citation open the neighbouring answer's passage.
      .order("created_at", { ascending: true })
      .order("id", { ascending: true })
      .returns<Message[]>(),
  ]);

  const ready = (sources ?? []).some((source) => source.status === "ready");
  const sourceTitles = (sources ?? [])
    .filter((source) => source.status === "ready")
    .map((source) => source.title);

  return (
    <NotebookPanes notebookId={notebook.id} initialSources={sources ?? []}>
      <div className="border-border flex shrink-0 items-baseline justify-between gap-4 border-b px-6 py-3">
        <h1 className="font-heading truncate text-lg">{notebook.title}</h1>
        <Link
          href="/notebooks"
          className="text-muted-foreground hover:text-foreground shrink-0 text-sm"
        >
          Alle Notizbücher
        </Link>
      </div>
      <ChatPanel
        notebookId={notebook.id}
        initialMessages={messages ?? []}
        hasReadySources={ready}
        sourceTitles={sourceTitles}
        sources={sources ?? []}
      />
    </NotebookPanes>
  );
}
