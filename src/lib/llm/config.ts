import "server-only";

import { z } from "zod";

import {
  providerConfigHeaderSchema,
  type ProviderConfigHeader,
} from "@/lib/provider-config";

/**
 * Provider configuration. This directory is the only place in the app that knows
 * a provider exists; route handlers call chat() and embed() and nothing else.
 */

/**
 * The embedding strategy is a deploy-time choice, not a runtime one: the pgvector
 * column has a fixed dimension, and every stored chunk was embedded by one model.
 *
 *   local     gte-small inside the Supabase Edge runtime. 384 dims, no key.
 *   external  any OpenAI-compatible /embeddings endpoint. 1536 dims by default.
 */
const embeddingEnvSchema = z.discriminatedUnion("EMBEDDING_STRATEGY", [
  z.object({ EMBEDDING_STRATEGY: z.literal("local") }),
  z.object({
    EMBEDDING_STRATEGY: z.literal("external"),
    EMBEDDING_BASE_URL: z.url(),
    EMBEDDING_API_KEY: z.string().min(1),
    EMBEDDING_MODEL: z.string().min(1),
    EMBEDDING_DIMENSIONS: z.coerce.number().int().positive(),
  }),
]);

export type EmbeddingConfig =
  | { strategy: "local"; model: "gte-small"; dimensions: 384 }
  | {
      strategy: "external";
      model: string;
      dimensions: number;
      baseUrl: string;
      apiKey: string;
    };

let cached: EmbeddingConfig | undefined;

export function embeddingConfig(): EmbeddingConfig {
  if (cached) return cached;

  const parsed = embeddingEnvSchema.safeParse({
    EMBEDDING_STRATEGY: process.env.EMBEDDING_STRATEGY ?? "local",
    EMBEDDING_BASE_URL: process.env.EMBEDDING_BASE_URL,
    EMBEDDING_API_KEY: process.env.EMBEDDING_API_KEY,
    EMBEDDING_MODEL: process.env.EMBEDDING_MODEL,
    EMBEDDING_DIMENSIONS: process.env.EMBEDDING_DIMENSIONS,
  });

  if (!parsed.success) {
    // Deliberately does not echo the values — one of them is an API key.
    const fields = Object.keys(z.flattenError(parsed.error).fieldErrors).join(", ");
    throw new Error(`Invalid embedding configuration. Check: ${fields}`);
  }

  const env = parsed.data;
  cached =
    env.EMBEDDING_STRATEGY === "local"
      ? { strategy: "local", model: "gte-small", dimensions: 384 }
      : {
          strategy: "external",
          model: env.EMBEDDING_MODEL,
          dimensions: env.EMBEDDING_DIMENSIONS,
          baseUrl: env.EMBEDDING_BASE_URL,
          apiKey: env.EMBEDDING_API_KEY,
        };

  return cached;
}

/**
 * Chat configuration, in precedence order:
 *
 *   1. The user's own config, arriving per-request in the x-provider-config header
 *      as base64 JSON. Validated here, used, and discarded. Never persisted.
 *   2. The server fallback key, so a visitor can try the app without signing up
 *      for a provider. Rate limited; see src/lib/rate-limit.ts.
 *
 * Nothing in this file ever logs a config or puts one in a response. An error
 * message names the field that was wrong, never its value.
 */

export type ResolvedChatConfig = {
  source: "user" | "fallback";
  baseUrl: string;
  apiKey: string;
  model: string;
};

const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";

/** Optional override, validated like everything else that comes from outside. */
const fallbackBaseUrlSchema = z.url().default(OPENROUTER_BASE_URL);

/** Decodes and validates the header. Throws with a readable message, not a value. */
export function parseProviderConfigHeader(
  header: string | null,
): ProviderConfigHeader | null {
  if (!header) return null;

  let decoded: string;
  try {
    decoded = Buffer.from(header, "base64").toString("utf8");
  } catch {
    throw new Error("Provider config header is not valid base64");
  }

  let json: unknown;
  try {
    json = JSON.parse(decoded);
  } catch {
    throw new Error("Provider config header is not valid JSON");
  }

  const parsed = providerConfigHeaderSchema.safeParse(json);
  if (!parsed.success) {
    const fields = Object.keys(z.flattenError(parsed.error).fieldErrors).join(", ");
    throw new Error(`Provider config is invalid. Check: ${fields || "chat, embedding"}`);
  }
  return parsed.data;
}

export function chatConfig(header: string | null): ResolvedChatConfig {
  const userConfig = parseProviderConfigHeader(header)?.chat;
  if (userConfig) {
    return { source: "user", ...userConfig };
  }

  const apiKey = process.env.OPENROUTER_API_KEY;
  const model = process.env.DEFAULT_CHAT_MODEL;
  if (!apiKey || !model) {
    throw new Error(
      "No chat provider configured. Add your own provider in Settings, or set OPENROUTER_API_KEY and DEFAULT_CHAT_MODEL on the server.",
    );
  }

  const baseUrl = fallbackBaseUrlSchema.safeParse(process.env.OPENROUTER_BASE_URL);
  if (!baseUrl.success) {
    throw new Error("OPENROUTER_BASE_URL is set but is not a valid URL");
  }

  return { source: "fallback", baseUrl: baseUrl.data, apiKey, model };
}

/**
 * Embedding configuration for a single request.
 *
 * A user may bring their own *endpoint and key* when the deployment runs
 * `external`, but not their own model or dimensions: those are fixed by the
 * pgvector column and by what every existing chunk was embedded with. A request
 * that asks for a different model is refused rather than honoured, because the
 * failure it would cause is silent — neighbours that are near nothing, and an
 * answer that looks grounded and is not.
 *
 * Under `local` there is no key to bring, so the header is ignored entirely.
 */
export function resolveEmbeddingConfig(header: string | null): EmbeddingConfig {
  const base = embeddingConfig();
  if (base.strategy === "local") return base;

  const userConfig = parseProviderConfigHeader(header)?.embedding;
  if (!userConfig) return base;

  if (userConfig.model !== base.model || userConfig.dimensions !== base.dimensions) {
    throw new Error(
      `This deployment embeds with ${base.model} at ${base.dimensions} dimensions and cannot mix models. Set your embedding config to that model, or leave it empty to use the server's.`,
    );
  }

  return { ...base, baseUrl: userConfig.baseUrl, apiKey: userConfig.apiKey };
}
