import { z } from "zod";

export type SourceKind = "pdf" | "text" | "markdown" | "url";
export type SourceStatus = "pending" | "processing" | "ready" | "error";
export type MessageRole = "user" | "assistant";

export type Notebook = {
  id: string;
  user_id: string;
  title: string;
  embedding_model: string;
  embedding_dims: number;
  created_at: string;
};

/**
 * Provenance for a URL source, read from the page's own meta tags. Every field
 * is optional because most pages supply few of them, and the UI omits whatever
 * is missing rather than rendering an empty row.
 *
 * The `metadata` column is `jsonb` populated from arbitrary web pages, so a row
 * has zero runtime guarantee of matching this shape — every read site must
 * `.safeParse` it with this schema rather than trusting the column as typed.
 * `published_at` is nominally ISO 8601 but is copied from meta tags the source
 * page controls, so it is left as a bare (unvalidated-as-a-date) string here;
 * callers that render it must guard against unparseable values themselves.
 */
export const sourceMetadataSchema = z.object({
  site_name: z.string().optional(),
  author: z.string().optional(),
  /** ISO 8601, nominally — see note above. */
  published_at: z.string().optional(),
  excerpt: z.string().optional(),
  word_count: z.number().optional(),
});

export type SourceMetadata = z.infer<typeof sourceMetadataSchema>;

export type Source = {
  id: string;
  notebook_id: string;
  user_id: string;
  title: string;
  kind: SourceKind;
  storage_path: string | null;
  source_url: string | null;
  metadata: SourceMetadata | null;
  status: SourceStatus;
  error: string | null;
  char_count: number;
  next_chunk_idx: number;
  processing_started_at: string | null;
  created_at: string;
};

export type Chunk = {
  id: string;
  source_id: string;
  notebook_id: string;
  user_id: string;
  idx: number;
  content: string;
  token_count: number;
  created_at: string;
};

/** One retrieved chunk, as returned by the match_chunks SQL function. */
export type MatchedChunk = {
  id: string;
  content: string;
  source_id: string;
  idx: number;
  similarity: number;
};

/** A matched chunk with its source's title attached, as sent to the client. */
export type RetrievedChunk = MatchedChunk & { source_title: string };

/** A resolved citation: what `[n]` in an answer points at. */
export type Citation = {
  n: number;
  chunk_id: string;
  source_id: string;
  source_title: string;
  idx: number;
  content: string;
};

export type Message = {
  id: string;
  notebook_id: string;
  user_id: string;
  role: MessageRole;
  content: string;
  citations: Citation[] | null;
  created_at: string;
};
