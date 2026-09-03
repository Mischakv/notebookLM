import { z } from "zod";

/**
 * Browser-safe half of the provider configuration: the shapes a user can enter in
 * Settings, and the localStorage read/write around them.
 *
 * Deliberately separate from lib/llm/config.ts, which is `server-only` because it
 * reads server keys out of the environment. This file imports no provider SDK and
 * touches no secret that the user did not type themselves.
 *
 * The XSS exposure of keeping a user key in localStorage is a knowing trade-off: a
 * script running on the page could read it. Production would proxy provider calls
 * server-side and never hand the browser a key at all.
 */

export const chatProviderConfigSchema = z.object({
  baseUrl: z.url("Base URL must be a URL"),
  apiKey: z.string().min(1, "API key is required"),
  model: z.string().min(1, "Model is required"),
});

export const embeddingProviderConfigSchema = chatProviderConfigSchema.extend({
  dimensions: z.coerce.number().int().positive(),
});

/** One header carries both blocks; either may be absent. */
export const providerConfigHeaderSchema = z.object({
  chat: chatProviderConfigSchema.optional(),
  embedding: embeddingProviderConfigSchema.optional(),
});

export type ChatProviderConfig = z.infer<typeof chatProviderConfigSchema>;
export type EmbeddingProviderConfig = z.infer<typeof embeddingProviderConfigSchema>;
export type ProviderConfigHeader = z.infer<typeof providerConfigHeaderSchema>;

export const CHAT_CONFIG_KEY = "notebook.chat-provider";
export const EMBEDDING_CONFIG_KEY = "notebook.embedding-provider";

/** The header the browser sends a user config in. Base64 JSON, never a cookie. */
export const PROVIDER_CONFIG_HEADER = "x-provider-config";

function read<T>(key: string, schema: z.ZodType<T>): T | null {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(key);
  if (!raw) return null;
  try {
    // Validated on every read: what is in storage was last written by some other
    // version of this app, or by hand.
    const parsed = schema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function readChatConfig() {
  return read(CHAT_CONFIG_KEY, chatProviderConfigSchema);
}

export function readEmbeddingConfig() {
  return read(EMBEDDING_CONFIG_KEY, embeddingProviderConfigSchema);
}

export function writeConfig(key: string, value: unknown) {
  window.localStorage.setItem(key, JSON.stringify(value));
}

export function clearConfig(key: string) {
  window.localStorage.removeItem(key);
}

/**
 * Builds the x-provider-config header value from whatever the user has stored.
 * Returns null when they have configured nothing, in which case the request
 * falls through to the server's own key.
 */
export function providerConfigHeader(): string | null {
  const chat = readChatConfig();
  const embedding = readEmbeddingConfig();
  if (!chat && !embedding) return null;

  const payload: ProviderConfigHeader = {};
  if (chat) payload.chat = chat;
  if (embedding) payload.embedding = embedding;
  return btoa(JSON.stringify(payload));
}
