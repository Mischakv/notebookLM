import { CreateNotebookDialog } from "@/components/create-notebook-dialog";
import { NotebookCard } from "@/components/notebook-card";
import { createClient } from "@/lib/supabase/server";
import type { Notebook } from "@/lib/types";

/** A notebook plus the aggregate PostgREST returns for its sources. */
type NotebookWithCount = Notebook & { sources: { count: number }[] };

const STEPS = [
  { title: "Quellen hinzufügen", body: "PDFs, Markdown oder eingefügter Text." },
  { title: "Fragen stellen", body: "In deiner eigenen Sprache, wie im Gespräch." },
  { title: "Belege prüfen", body: "Jede Aussage verweist auf ihre Textstelle." },
];

export default async function NotebooksPage() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("notebooks")
    .select("*, sources(count)")
    .order("created_at", { ascending: false })
    .returns<NotebookWithCount[]>();

  if (error) {
    return (
      <main className="mx-auto max-w-5xl px-6 py-16">
        <p className="text-destructive">
          Die Notizbücher konnten nicht geladen werden: {error.message}
        </p>
      </main>
    );
  }

  const notebooks = data ?? [];

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <div className="flex items-center justify-between gap-4">
        <h1 className="font-heading text-2xl">Deine Notizbücher</h1>
        {notebooks.length > 0 && <CreateNotebookDialog />}
      </div>

      {notebooks.length === 0 ? (
        <div className="mt-16 flex flex-col items-center text-center">
          <div
            aria-hidden
            className="pointer-events-none absolute size-96 rounded-full"
            style={{ background: "radial-gradient(circle, #faef7014 0%, transparent 70%)" }}
          />
          <div className="relative max-w-lg space-y-4">
            <h2 className="font-heading text-2xl">Noch nichts hier</h2>
            <p className="text-muted-foreground">
              Ein Notizbuch bündelt deine Quellen und das Gespräch, das du mit ihnen
              führst. Starte eines für ein Projekt, einen Kurs oder den Stapel Papiere,
              den du schon lange lesen wolltest.
            </p>
            <div className="pt-2">
              <CreateNotebookDialog label="Erstes Notizbuch anlegen" />
            </div>
          </div>

          <ol className="relative mt-14 grid gap-6 text-left sm:grid-cols-3">
            {STEPS.map((step, index) => (
              <li key={step.title} className="border-border bg-card rounded-2xl border p-5">
                <span className="text-primary font-heading text-lg">{index + 1}</span>
                <p className="mt-2 font-medium">{step.title}</p>
                <p className="text-muted-foreground mt-1 text-sm">{step.body}</p>
              </li>
            ))}
          </ol>
        </div>
      ) : (
        <ul className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {notebooks.map((notebook) => (
            <NotebookCard
              key={notebook.id}
              notebook={notebook}
              sourceCount={notebook.sources[0]?.count ?? 0}
            />
          ))}
        </ul>
      )}
    </main>
  );
}
