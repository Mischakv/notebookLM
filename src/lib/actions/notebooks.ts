"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { embeddingConfig } from "@/lib/llm/config";
import { createClient } from "@/lib/supabase/server";

/**
 * Notebook CRUD. Every statement runs as the signed-in user, so RLS — not a
 * check in this file — is what stops a user touching someone else's row.
 */

export type ActionResult = { ok: true } | { ok: false; error: string };

const titleSchema = z.string().trim().min(1, "Title is required").max(200);
const idSchema = z.uuid();

export async function createNotebook(formData: FormData): Promise<ActionResult> {
  const parsed = titleSchema.safeParse(formData.get("title"));
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in" };

  // The notebook is pinned to the strategy it was born under; ingesting a source
  // embedded by a different model is rejected rather than silently mixed.
  // A misconfigured deployment must say so here — an uncaught throw inside a
  // server action reaches the client as Next's redacted placeholder.
  let embedding;
  try {
    embedding = embeddingConfig();
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Bad configuration" };
  }

  const { error } = await supabase.from("notebooks").insert({
    user_id: user.id,
    title: parsed.data,
    embedding_model: embedding.model,
    embedding_dims: embedding.dimensions,
  });

  if (error) return { ok: false, error: error.message };

  revalidatePath("/notebooks");
  return { ok: true };
}

export async function renameNotebook(formData: FormData): Promise<ActionResult> {
  const id = idSchema.safeParse(formData.get("id"));
  const title = titleSchema.safeParse(formData.get("title"));
  if (!id.success) return { ok: false, error: "Unknown notebook" };
  if (!title.success) return { ok: false, error: title.error.issues[0].message };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("notebooks")
    .update({ title: title.data })
    .eq("id", id.data)
    .select("id")
    .returns<{ id: string }[]>();

  if (error) return { ok: false, error: error.message };
  // RLS filters the row out rather than erroring, so an empty result is the denial.
  if (!data || data.length === 0) return { ok: false, error: "Notebook not found" };

  revalidatePath("/notebooks");
  revalidatePath(`/notebooks/${id.data}`);
  return { ok: true };
}

export async function deleteNotebook(formData: FormData): Promise<ActionResult> {
  const id = idSchema.safeParse(formData.get("id"));
  if (!id.success) return { ok: false, error: "Unknown notebook" };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("notebooks")
    .delete()
    .eq("id", id.data)
    .select("id")
    .returns<{ id: string }[]>();

  if (error) return { ok: false, error: error.message };
  if (!data || data.length === 0) return { ok: false, error: "Notebook not found" };

  revalidatePath("/notebooks");
  revalidatePath(`/notebooks/${id.data}`);
  return { ok: true };
}
