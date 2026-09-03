"use client";

import { useState, useTransition } from "react";
import { Plus } from "lucide-react";
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
import { createNotebook } from "@/lib/actions/notebooks";

export function CreateNotebookDialog({ label = "Neues Notizbuch" }: { label?: string }) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    startTransition(async () => {
      const result = await createNotebook(formData);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setOpen(false);
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button><Plus aria-hidden />{label}</Button>
      </DialogTrigger>
      <DialogContent>
        <form onSubmit={onSubmit}>
          <DialogHeader>
            <DialogTitle>Neues Notizbuch</DialogTitle>
            <DialogDescription>
              Gib ihm einen Namen. Du kannst ihn später ändern.
            </DialogDescription>
          </DialogHeader>
          <Input
            name="title"
            required
            autoFocus
            maxLength={200}
            placeholder="Interview-Transkripte"
            className="my-4"
          />
          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {pending ? "Wird angelegt…" : "Anlegen"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
