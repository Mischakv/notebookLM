"use client";

import { useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

type Mode = "file" | "text" | "url";

export function AddSourceDialog({
  notebookId,
  onAdded,
  label = "Quelle hinzufügen",
  variant = "default",
}: {
  notebookId: string;
  onAdded: (sourceId: string) => void;
  label?: string;
  variant?: "default" | "outline";
}) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode>("file");
  const [pending, setPending] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  async function submit(body: BodyInit, headers?: HeadersInit) {
    setPending(true);
    try {
      const response = await fetch("/api/sources", { method: "POST", body, headers });
      const result = (await response.json()) as { id?: string; error?: string };
      if (!response.ok || !result.id) {
        toast.error(result.error ?? "Der Upload ist fehlgeschlagen");
        return;
      }
      setOpen(false);
      onAdded(result.id);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Der Upload ist fehlgeschlagen");
    } finally {
      setPending(false);
    }
  }

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);

    if (mode === "file") {
      const file = fileInput.current?.files?.[0];
      if (!file) {
        toast.error("Wähle zuerst eine Datei aus");
        return;
      }
      const body = new FormData();
      body.set("notebookId", notebookId);
      body.set("file", file);
      void submit(body);
      return;
    }

    if (mode === "url") {
      void submit(
        JSON.stringify({ notebookId, url: String(form.get("url") ?? "").trim() }),
        { "Content-Type": "application/json" },
      );
      return;
    }

    void submit(
      JSON.stringify({
        notebookId,
        title: String(form.get("title") ?? "").trim(),
        text: String(form.get("text") ?? "").trim(),
      }),
      { "Content-Type": "application/json" },
    );
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant={variant} size="sm">
          {label}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <form onSubmit={onSubmit}>
          <DialogHeader>
            <DialogTitle>Quelle hinzufügen</DialogTitle>
            <DialogDescription>
              Eine PDF-, Markdown- oder Textdatei bis 10 MB, direkt eingefügter Text,
              oder die Adresse einer Website.
            </DialogDescription>
          </DialogHeader>

          <div className="my-4 space-y-4">
            <div className="border-border bg-muted flex gap-1 rounded-xl border p-1">
              {(
                [
                  ["file", "Datei hochladen"],
                  ["text", "Text einfügen"],
                  ["url", "Website"],
                ] as const
              ).map(([value, text]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setMode(value)}
                  aria-pressed={mode === value}
                  className={`flex-1 rounded-lg px-3 py-1.5 text-sm transition-colors ${
                    mode === value
                      ? "bg-card text-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {text}
                </button>
              ))}
            </div>

            {mode === "file" ? (
              <Input ref={fileInput} type="file" accept=".pdf,.md,.markdown,.txt" required />
            ) : mode === "url" ? (
              <div className="space-y-2">
                <Input name="url" type="url" required placeholder="https://www.amazon.de/…" />
                <p className="text-muted-foreground text-xs">
                  Es können nur Seiten von amazon.de gelesen werden. Paywalls und Seiten,
                  die ihren Inhalt per JavaScript nachladen, funktionieren nicht.
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                <Input name="title" required maxLength={200} placeholder="Titel" />
                <Textarea name="text" required rows={8} placeholder="Füge deinen Text hier ein" />
              </div>
            )}
          </div>

          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {pending
                ? mode === "url"
                  ? "Seite wird gelesen…"
                  : "Wird hochgeladen…"
                : "Hinzufügen"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
