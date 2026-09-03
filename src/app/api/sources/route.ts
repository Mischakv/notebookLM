import { NextResponse } from "next/server";
import { z } from "zod";

import { ExtractionError } from "@/lib/extract-html";
import { fetchUrlAsMarkdown } from "@/lib/fetch-url";
import { createClient } from "@/lib/supabase/server";
import type { SourceKind } from "@/lib/types";
import { BlockedUrlError } from "@/lib/url-guard";

export const runtime = "nodejs";

const MAX_BYTES = 10 * 1024 * 1024;

const KIND_BY_EXTENSION: Record<string, SourceKind> = {
  pdf: "pdf",
  md: "markdown",
  markdown: "markdown",
  txt: "text",
};

const pastedSchema = z.object({
  notebookId: z.uuid(),
  title: z.string().trim().min(1).max(200),
  text: z.string().trim().min(1),
  kind: z.enum(["text", "markdown"]).default("text"),
});

const urlSchema = z.object({
  notebookId: z.uuid(),
  url: z.url(),
});

const uploadSchema = z.object({
  notebookId: z.uuid(),
});

/**
 * Creates a source row and returns immediately so the rail can render a pending
 * item. The work happens in POST /api/sources/[id]/ingest, driven by the client.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const contentType = request.headers.get("content-type") ?? "";

  if (contentType.includes("application/json")) {
    // Annotated `unknown`, not left to inference: request.json() is `any`, and
    // the no-any rule applies to inferred types too.
    const body: unknown = await request.json().catch(() => null);

    // A website is a source like any other by the time it is stored, so the two
    // JSON shapes differ only in where the text comes from.
    if (body && typeof body === "object" && "url" in body) {
      const parsed = urlSchema.safeParse(body);
      if (!parsed.success) {
        return NextResponse.json({ error: issue(parsed.error) }, { status: 400 });
      }
      const { notebookId, url } = parsed.data;

      if (!(await ownsNotebook(supabase, notebookId))) {
        return NextResponse.json({ error: "Notebook not found" }, { status: 404 });
      }

      // Fetched and parsed before any row is inserted. Retry in the rail re-runs
      // *ingestion*, not the fetch, so a row whose fetch failed could never
      // recover — it would have no storage_path. Failing here instead puts the
      // real reason in the dialog and leaves nothing behind.
      let fetched: Awaited<ReturnType<typeof fetchUrlAsMarkdown>>;
      try {
        fetched = await fetchUrlAsMarkdown(url);
      } catch (error) {
        if (error instanceof BlockedUrlError || error instanceof ExtractionError) {
          return NextResponse.json({ error: error.message }, { status: 400 });
        }
        return NextResponse.json(
          { error: "Diese Seite konnte nicht geladen werden." },
          { status: 400 },
        );
      }

      const { data, error } = await supabase
        .from("sources")
        .insert({
          notebook_id: notebookId,
          user_id: user.id,
          title: fetched.title,
          kind: "url",
          status: "pending",
          source_url: fetched.sourceUrl,
          metadata: fetched.metadata,
          char_count: fetched.markdown.length,
        })
        .select("id")
        .single<{ id: string }>();

      if (error) return NextResponse.json({ error: error.message }, { status: 400 });

      const path = `${user.id}/${data.id}/page.md`;
      const upload = await supabase.storage
        .from("sources")
        .upload(path, new Blob([fetched.markdown], { type: "text/markdown" }));

      if (upload.error) {
        await supabase
          .from("sources")
          .update({ status: "error", error: upload.error.message })
          .eq("id", data.id);
        return NextResponse.json({ error: upload.error.message }, { status: 400 });
      }

      const recorded = await supabase
        .from("sources")
        .update({ storage_path: path })
        .eq("id", data.id);
      if (recorded.error) {
        await supabase
          .from("sources")
          .update({ status: "error", error: recorded.error.message })
          .eq("id", data.id);
        return NextResponse.json({ error: recorded.error.message }, { status: 500 });
      }

      return NextResponse.json({ id: data.id }, { status: 201 });
    }

    const parsed = pastedSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: issue(parsed.error) }, { status: 400 });
    }
    const { notebookId, title, text, kind } = parsed.data;

    if (!(await ownsNotebook(supabase, notebookId))) {
      return NextResponse.json({ error: "Notebook not found" }, { status: 404 });
    }

    if (Buffer.byteLength(text, "utf8") > MAX_BYTES) {
      return NextResponse.json({ error: "That text is over the 10 MB limit" }, { status: 400 });
    }

    // Pasted text has no file, so it goes straight into the row and Storage is
    // not involved; ingest reads it back from char_count-bearing chunks later.
    const { data, error } = await supabase
      .from("sources")
      .insert({
        notebook_id: notebookId,
        user_id: user.id,
        title,
        kind,
        status: "pending",
        char_count: text.length,
      })
      .select("id")
      .single<{ id: string }>();

    if (error) return NextResponse.json({ error: error.message }, { status: 400 });

    // The pasted body is stored as a file too, so ingest has exactly one path to
    // read from regardless of how the source arrived.
    const path = `${user.id}/${data.id}/pasted.${kind === "markdown" ? "md" : "txt"}`;
    const upload = await supabase.storage
      .from("sources")
      .upload(path, new Blob([text], { type: "text/plain" }));

    if (upload.error) {
      await supabase
        .from("sources")
        .update({ status: "error", error: upload.error.message })
        .eq("id", data.id);
      return NextResponse.json({ error: upload.error.message }, { status: 400 });
    }

    const recorded = await supabase
      .from("sources")
      .update({ storage_path: path })
      .eq("id", data.id);
    if (recorded.error) {
      // Without the path the row can never be ingested, so this is not a warning.
      await supabase
        .from("sources")
        .update({ status: "error", error: recorded.error.message })
        .eq("id", data.id);
      return NextResponse.json({ error: recorded.error.message }, { status: 500 });
    }

    return NextResponse.json({ id: data.id }, { status: 201 });
  }

  const formData = await request.formData().catch(() => null);
  if (!formData) return NextResponse.json({ error: "Expected a file" }, { status: 400 });

  const parsed = uploadSchema.safeParse({ notebookId: formData.get("notebookId") });
  if (!parsed.success) {
    return NextResponse.json({ error: issue(parsed.error) }, { status: 400 });
  }

  if (!(await ownsNotebook(supabase, parsed.data.notebookId))) {
    return NextResponse.json({ error: "Notebook not found" }, { status: 404 });
  }

  const file = formData.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Expected a file" }, { status: 400 });
  }
  if (file.size === 0) {
    return NextResponse.json({ error: "That file is empty" }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { error: `That file is ${(file.size / 1024 / 1024).toFixed(1)} MB. The limit is 10 MB.` },
      { status: 400 },
    );
  }

  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
  const kind = KIND_BY_EXTENSION[extension];
  if (!kind) {
    return NextResponse.json(
      { error: `Cannot read .${extension} files. Upload a PDF, .md or .txt.` },
      { status: 400 },
    );
  }

  const { data, error } = await supabase
    .from("sources")
    .insert({
      notebook_id: parsed.data.notebookId,
      user_id: user.id,
      title: file.name,
      kind,
      status: "pending",
    })
    .select("id")
    .single<{ id: string }>();

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  const path = `${user.id}/${data.id}/${sanitize(file.name)}`;
  const upload = await supabase.storage.from("sources").upload(path, file);

  if (upload.error) {
    await supabase
      .from("sources")
      .update({ status: "error", error: upload.error.message })
      .eq("id", data.id);
    return NextResponse.json({ error: upload.error.message }, { status: 400 });
  }

  const recorded = await supabase
    .from("sources")
    .update({ storage_path: path })
    .eq("id", data.id);
  if (recorded.error) {
    await supabase
      .from("sources")
      .update({ status: "error", error: recorded.error.message })
      .eq("id", data.id);
    return NextResponse.json({ error: recorded.error.message }, { status: 500 });
  }

  return NextResponse.json({ id: data.id }, { status: 201 });
}

/**
 * RLS stops a user reading another tenant's rows, but nothing stops them
 * *writing* a row that points at another tenant's notebook id: the sources
 * policy only asserts user_id = auth.uid(). Checking the notebook is visible
 * first keeps user_id from drifting away from its parent.
 */
async function ownsNotebook(
  supabase: Awaited<ReturnType<typeof createClient>>,
  notebookId: string,
): Promise<boolean> {
  const { data } = await supabase
    .from("notebooks")
    .select("id")
    .eq("id", notebookId)
    .maybeSingle<{ id: string }>();
  return Boolean(data);
}

function issue(error: z.ZodError): string {
  return error.issues[0]?.message ?? "Invalid request";
}

/** Storage keys are ASCII-safe; the display name lives in sources.title. */
function sanitize(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-120);
}
