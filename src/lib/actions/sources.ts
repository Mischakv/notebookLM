"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { createClient } from "@/lib/supabase/server";
import type { ActionResult } from "@/lib/actions/notebooks";

export async function deleteSource(formData: FormData): Promise<ActionResult> {
  const id = z.uuid().safeParse(formData.get("id"));
  const notebookId = z.uuid().safeParse(formData.get("notebookId"));
  if (!id.success || !notebookId.success) return { ok: false, error: "Unknown source" };

  const supabase = await createClient();

  // Storage objects are not covered by the row's cascade, so remove the file
  // first; an orphaned row is recoverable, an orphaned private object is litter.
  const { data: source } = await supabase
    .from("sources")
    .select("storage_path")
    .eq("id", id.data)
    .maybeSingle<{ storage_path: string | null }>();

  if (source?.storage_path) {
    await supabase.storage.from("sources").remove([source.storage_path]);
  }

  const { data, error } = await supabase
    .from("sources")
    .delete()
    .eq("id", id.data)
    .select("id")
    .returns<{ id: string }[]>();

  if (error) return { ok: false, error: error.message };
  if (!data || data.length === 0) return { ok: false, error: "Source not found" };

  revalidatePath(`/notebooks/${notebookId.data}`);
  return { ok: true };
}
