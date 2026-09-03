import "server-only";

import { assertReachableBaseUrl, errorText, trimSlash } from "@/lib/llm/http";
import { embeddingConfig } from "@/lib/llm/config";
import type {
  ChatProviderConfig,
  EmbeddingProviderConfig,
} from "@/lib/provider-config";

export type TestResult = { ok: true; detail: string } | { ok: false; error: string };

/**
 * One cheap round-trip against a config the user just typed, so Settings can say
 * what is actually wrong instead of "failed". Lives here rather than in the route
 * so that lib/llm/ stays the only place that speaks a provider's protocol.
 */
export async function testConnection(
  input:
    | { kind: "chat"; config: ChatProviderConfig }
    | { kind: "embedding"; config: EmbeddingProviderConfig },
): Promise<TestResult> {
  const { kind, config } = input;

  try {
    assertReachableBaseUrl(config.baseUrl);
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Bad base URL" };
  }

  if (kind === "embedding") {
    // The column width is not negotiable, so say so before the user spends a
    // round-trip discovering it.
    const deployment = embeddingConfig();
    if (deployment.strategy === "local") {
      return {
        ok: false,
        error: "This deployment embeds locally with gte-small. There is nothing to configure.",
      };
    }
    if (config.dimensions !== deployment.dimensions) {
      return {
        ok: false,
        error: `This deployment stores ${deployment.dimensions}-dimension vectors, so the dimensions must be ${deployment.dimensions}.`,
      };
    }
  }

  const url = `${trimSlash(config.baseUrl)}/${kind === "chat" ? "chat/completions" : "embeddings"}`;
  const body =
    kind === "chat"
      ? { model: config.model, messages: [{ role: "user", content: "ping" }], max_tokens: 1 }
      : { model: config.model, input: "ping" };

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) return { ok: false, error: await errorText(response) };

    if (kind === "embedding") {
      const json = (await response.json()) as { data?: { embedding: number[] }[] };
      const dimensions = json.data?.[0]?.embedding?.length;
      if (!dimensions) return { ok: false, error: "Provider returned no embedding" };
      if (dimensions !== config.dimensions) {
        return {
          ok: false,
          error: `Model returns ${dimensions} dimensions, but this deployment's column is ${config.dimensions}.`,
        };
      }
      return { ok: true, detail: `${dimensions} dimensions` };
    }

    return { ok: true, detail: `${config.model} responded` };
  } catch (error) {
    // Network-level failure: bad host, TLS, DNS. Names no credential.
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Could not reach the provider",
    };
  }
}
