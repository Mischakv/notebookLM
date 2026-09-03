import "server-only";

/**
 * Shared plumbing for talking to an OpenAI-compatible endpoint. Kept inside
 * lib/llm/ so knowledge of the wire protocol does not leak into route handlers.
 */

export function trimSlash(url: string) {
  return url.replace(/\/+$/, "");
}

/** The upstream message, verbatim, so the user can act on it. Never our key. */
export async function errorText(response: Response): Promise<string> {
  const text = await response.text().catch(() => "");
  try {
    const json = JSON.parse(text) as { error?: { message?: string } | string };
    const message = typeof json.error === "string" ? json.error : json.error?.message;
    if (message) return `${response.status} ${message}`;
  } catch {
    // Not JSON; fall through to the raw body.
  }
  return `${response.status} ${response.statusText}${text ? ` — ${text.slice(0, 300)}` : ""}`;
}

const PRIVATE_HOST =
  /^(localhost|127\.|0\.|10\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.|\[?::1\]?|\[?f[cd]|metadata\.|.*\.internal$)/i;

/**
 * A user-supplied base URL means the server will make a request to wherever they
 * say. That is the point of BYOK, but it should not become a way to probe the
 * deployment's own network: require TLS, and refuse loopback and private ranges.
 *
 * This is a filter, not a proof. It checks the literal hostname, so it does not
 * stop a public name that resolves into private space, nor encoded IPv4 forms.
 * Closing those needs DNS resolution and per-request socket checks, which is more
 * than a demo warrants — but do not read this as airtight.
 *
 * Disabled outside production, where a local vLLM on 127.0.0.1 is the normal case.
 */
export function assertReachableBaseUrl(rawUrl: string) {
  const url = new URL(rawUrl);
  if (process.env.NODE_ENV !== "production") return;

  if (url.protocol !== "https:") {
    throw new Error("Provider base URL must use https");
  }
  if (PRIVATE_HOST.test(url.hostname)) {
    throw new Error("Provider base URL must be a public host");
  }
}
