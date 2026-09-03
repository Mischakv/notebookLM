import { extractArticle } from "@/lib/extract-html";
import { fetchGuarded } from "@/lib/url-guard";
import type { SourceMetadata } from "@/lib/types";

/**
 * Guard, fetch, extract. Exists so the route handler stays a route handler
 * rather than composing three modules inline.
 */
export async function fetchUrlAsMarkdown(raw: string): Promise<{
  title: string;
  markdown: string;
  sourceUrl: string;
  metadata: SourceMetadata;
}> {
  const { html, finalUrl } = await fetchGuarded(raw);
  const { title, markdown, metadata } = extractArticle(html, finalUrl);

  // The final URL, not the one typed: a shortener or a canonical redirect should
  // leave the reader at the page actually read.
  return { title, markdown, sourceUrl: finalUrl.toString(), metadata };
}
