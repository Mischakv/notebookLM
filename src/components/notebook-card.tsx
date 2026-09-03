"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { FileText, MoreHorizontal } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { deleteNotebook, renameNotebook } from "@/lib/actions/notebooks";
import type { Notebook } from "@/lib/types";

export function NotebookCard({
  notebook,
  sourceCount,
}: {
  notebook: Notebook;
  sourceCount: number;
}) {
  const [renaming, setRenaming] = useState(false);
  const [confirming, setConfirming] = useState(false);
  // Separate transitions: a rename in flight must not disable the delete button.
  const [renamePending, startRename] = useTransition();
  const [deletePending, startDelete] = useTransition();

  function onRename(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    formData.set("id", notebook.id);
    startRename(async () => {
      const result = await renameNotebook(formData);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setRenaming(false);
    });
  }

  function onDelete() {
    const formData = new FormData();
    formData.set("id", notebook.id);
    startDelete(async () => {
      const result = await deleteNotebook(formData);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setConfirming(false);
    });
  }

  return (
    <li className="group border-border bg-card hover:border-primary/30 relative rounded-2xl border transition-all hover:-translate-y-0.5 hover:shadow-[var(--shadow-elevated)]">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 rounded-2xl opacity-0 transition-opacity group-hover:opacity-100"
        style={{ background: "var(--gradient-card)" }}
      />

      <Link href={`/notebooks/${notebook.id}`} className="relative block p-5">
        <span className="border-border bg-muted mb-4 flex size-10 items-center justify-center rounded-xl border">
          <FileText className="text-primary size-4" aria-hidden />
        </span>
        <span className="mb-1 block truncate font-medium" title={notebook.title}>
          {notebook.title}
        </span>
        <span className="text-muted-foreground block text-sm">
          {sourceCount === 1 ? "1 Quelle" : `${sourceCount} Quellen`} ·{" "}
          {new Date(notebook.created_at).toLocaleDateString("de-DE")}
        </span>
      </Link>

      <div className="absolute top-4 right-4">
        <DropdownMenu>
          <DropdownMenuTrigger
            aria-label={`Aktionen für ${notebook.title}`}
            className="text-muted-foreground hover:text-foreground hover:bg-muted focus-visible:ring-ring/50 flex size-8 items-center justify-center rounded-lg transition-colors outline-none focus-visible:ring-3"
          >
            <MoreHorizontal className="size-4" aria-hidden />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuItem onSelect={() => setRenaming(true)}>
              Umbenennen
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setConfirming(true)}>
              Löschen
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            {/* Diagnostic detail — off the card face, still reachable. */}
            <DropdownMenuLabel className="text-muted-foreground text-xs font-normal">
              Embedding-Modell
              <span className="text-foreground block truncate">
                {notebook.embedding_model}
              </span>
            </DropdownMenuLabel>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <Dialog open={renaming} onOpenChange={setRenaming}>
        <DialogContent>
          <form onSubmit={onRename}>
            <DialogHeader>
              <DialogTitle>Notizbuch umbenennen</DialogTitle>
              <DialogDescription>
                Nur der Name ändert sich; deine Quellen bleiben erhalten.
              </DialogDescription>
            </DialogHeader>
            <Input
              name="title"
              required
              autoFocus
              maxLength={200}
              defaultValue={notebook.title}
              className="my-4"
            />
            <DialogFooter>
              <Button type="submit" disabled={renamePending}>
                {renamePending ? "Wird gespeichert…" : "Speichern"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={confirming} onOpenChange={setConfirming}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>„{notebook.title}“ löschen?</DialogTitle>
            <DialogDescription>
              Die Quellen, Textabschnitte und der Chatverlauf werden mitgelöscht. Das
              lässt sich nicht rückgängig machen.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="mt-4">
            <Button
              variant="outline"
              onClick={() => setConfirming(false)}
              disabled={deletePending}
            >
              Abbrechen
            </Button>
            <Button variant="destructive" onClick={onDelete} disabled={deletePending}>
              {deletePending ? "Wird gelöscht…" : "Löschen"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </li>
  );
}
