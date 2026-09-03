import { lookup } from "node:dns/promises";
import { isIPv4 } from "node:net";

/** Long enough for a slow origin, short enough that the dialog stays honest. */
const TIMEOUT_MS = 10_000;

/** Content-Length is advisory and absent on chunked responses, so the cap is
 *  enforced while reading rather than trusted up front. */
const MAX_BYTES = 5 * 1024 * 1024;

/** A public URL that redirects to 169.254.169.254 is the actual attack, so every
 *  hop is re-checked and the chain is short. */
const MAX_REDIRECTS = 3;

const HTML_TYPES = ["text/html", "application/xhtml+xml"];

/**
 * Only this domain may be fetched. A server-side fetcher that will retrieve any
 * address the user types is an SSRF primitive no matter how carefully the address
 * is vetted, so the reachable surface is pinned to the one domain this app is for.
 * Amazon's other storefronts and its amzn.to/amzn.eu shortlinks are deliberately
 * not listed: a shortlink can only resolve to a page the allowlist already covers.
 */
const ALLOWED_DOMAINS = ["amazon.de"] as const;

/** Exact host or a subdomain of one. Deliberately not endsWith(domain):
 *  that would also accept "notamazon.de". */
export function isAllowedHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  return ALLOWED_DOMAINS.some(
    (domain) => host === domain || host.endsWith(`.${domain}`),
  );
}

/** Carries a message meant for the user, so route handlers can pass it straight
 *  through without inventing their own wording. */
export class BlockedUrlError extends Error {}

/** True once every part of an IPv4 dotted quad is a valid octet. */
function isValidV4Parts(parts: number[]): parts is [number, number, number, number] {
  return parts.length === 4 && parts.every((p) => Number.isInteger(p) && p >= 0 && p <= 255);
}

/** The IPv4 rules, applied once the address is known to be (or embed) an IPv4 host. */
function isBlockedV4(a: number, b: number): boolean {
  if (a === 0) return true; // unspecified
  if (a === 127) return true; // loopback
  if (a === 10) return true; // private
  if (a === 169 && b === 254) return true; // link-local / metadata
  if (a === 172 && b >= 16 && b <= 31) return true; // private
  if (a === 192 && b === 168) return true; // private
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  return false;
}

/**
 * Expands any valid IPv6 spelling — "::" compression, an embedded IPv4 dotted
 * quad, a zone index — to 8 lowercase, zero-padded hextets. Returns null for
 * anything that does not parse, which callers treat as blocked: an address this
 * function cannot make sense of is not one it can vouch for as public.
 */
function expandIPv6(raw: string): string[] | null {
  let address = raw.toLowerCase();
  const zoneIndex = address.indexOf("%");
  if (zoneIndex !== -1) address = address.slice(0, zoneIndex);

  // A trailing embedded IPv4 dotted quad (mapped, compatible, or NAT64 forms all
  // end this way) is folded into two hex hextets before the "::" expansion below,
  // so the rest of the parser only ever deals with hextets.
  const embedded = /^(.*:)(\d+\.\d+\.\d+\.\d+)$/.exec(address);
  if (embedded) {
    const parts = embedded[2].split(".").map(Number);
    if (!isValidV4Parts(parts)) return null;
    const [a, b, c, d] = parts;
    const hi = ((a << 8) | b).toString(16);
    const lo = ((c << 8) | d).toString(16);
    address = `${embedded[1]}${hi}:${lo}`;
  }

  let hextets: string[];
  if (address.includes("::")) {
    const halves = address.split("::");
    if (halves.length !== 2) return null; // "::" may appear at most once
    const head = halves[0] ? halves[0].split(":") : [];
    const tail = halves[1] ? halves[1].split(":") : [];
    const missing = 8 - head.length - tail.length;
    if (missing < 0) return null;
    hextets = [...head, ...Array<string>(missing).fill("0"), ...tail];
  } else {
    hextets = address.split(":");
  }

  if (hextets.length !== 8 || hextets.some((h) => !/^[0-9a-f]{1,4}$/.test(h))) return null;
  return hextets.map((h) => h.padStart(4, "0"));
}

/**
 * Fetching a user-supplied URL server-side means a user can point this server at
 * infrastructure only it can reach — cloud metadata at 169.254.169.254, a local
 * Supabase on 127.0.0.1. Every address the hostname resolves to is checked
 * against the ranges that are never legitimate fetch targets.
 */
export function isBlockedAddress(ip: string): boolean {
  if (isIPv4(ip)) {
    const parts = ip.split(".").map(Number);
    if (!isValidV4Parts(parts)) return true;
    return isBlockedV4(parts[0], parts[1]);
  }

  // Not a bare IPv4 address: everything else must be a valid IPv6 spelling, and
  // there are several equivalent ways to embed an IPv4 host inside one — dotted
  // ("::ffff:127.0.0.1"), hex ("::ffff:7f00:1"), fully expanded, IPv4-translated
  // ("::ffff:0:127.0.0.1"), the deprecated IPv4-compatible form, and the NAT64
  // well-known prefix. All of them reach the same host as the bare IPv4 form, so
  // every spelling is normalised to 8 hextets before any range is decided, rather
  // than pattern-matching the raw string.
  const hextets = expandIPv6(ip);
  if (!hextets) return true; // unparseable input is not something to vouch for

  const allZero = hextets.every((h) => h === "0000");
  if (allZero) return true; // "::", the unspecified address

  const isLoopback = hextets.slice(0, 7).every((h) => h === "0000") && hextets[7] === "0001";
  if (isLoopback) return true; // "::1" in any spelling, including fully expanded

  // IPv4-mapped: ::ffff:0:0/96, e.g. "::ffff:127.0.0.1" or its hex form "::ffff:7f00:1".
  const isMapped = hextets.slice(0, 5).every((h) => h === "0000") && hextets[5] === "ffff";
  // IPv4-translated (RFC 2765): ::ffff:0:0:0/96, e.g. "::ffff:0:127.0.0.1" — a second,
  // rarer "ffff" placement one hextet earlier than the mapped form above.
  const isTranslated = hextets.slice(0, 4).every((h) => h === "0000") &&
    hextets[4] === "ffff" && hextets[5] === "0000";
  // NAT64 well-known prefix: 64:ff9b::/96.
  const isNat64 = hextets[0] === "0064" && hextets[1] === "ff9b" && hextets.slice(2, 6).every((h) => h === "0000");
  // Deprecated IPv4-compatible form: ::a.b.c.d/96, excluding the all-zero and
  // loopback cases already handled above.
  const isCompatible = hextets.slice(0, 6).every((h) => h === "0000");

  if (isMapped || isTranslated || isNat64 || isCompatible) {
    // isBlockedV4 only inspects the first two octets, both of which live in the
    // first embedded hextet — the second hextet (the low two octets) never
    // changes the verdict, so it is not extracted.
    const hi = Number.parseInt(hextets[6], 16);
    return isBlockedV4((hi >> 8) & 0xff, hi & 0xff);
  }

  const v6 = hextets.join(":");
  if (v6.startsWith("fe8") || v6.startsWith("fe9") ||
      v6.startsWith("fea") || v6.startsWith("feb")) return true; // fe80::/10, link-local
  if (v6.startsWith("fec") || v6.startsWith("fed") ||
      v6.startsWith("fee") || v6.startsWith("fef")) return true; // fec0::/10, deprecated site-local
  if (v6.startsWith("fc") || v6.startsWith("fd")) return true;   // fc00::/7, unique-local
  return false;
}

/**
 * Resolves the hostname and rejects the URL unless every address it points at is
 * publicly routable. Returns the parsed URL so callers do not parse twice.
 */
export async function assertFetchable(raw: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new BlockedUrlError("Das ist keine gültige Adresse.");
  }

  if (url.protocol !== "https:") {
    throw new BlockedUrlError("Nur https-Adressen werden unterstützt.");
  }
  if (url.username || url.password) {
    throw new BlockedUrlError("Adressen mit Zugangsdaten werden nicht unterstützt.");
  }
  if (!isAllowedHost(url.hostname)) {
    throw new BlockedUrlError(
      `Es können nur Seiten von ${ALLOWED_DOMAINS.join(", ")} hinzugefügt werden.`,
    );
  }

  // The address checked here can, in principle, change before fetch() connects
  // (DNS rebinding). That is not closed by pinning the resolved address, because
  // the allowlist above already requires control of amazon.de's DNS to reach
  // this point at all — an attacker in that position has no need to rebind.
  let addresses: { address: string }[];
  try {
    addresses = await lookup(url.hostname, { all: true });
  } catch {
    throw new BlockedUrlError("Diese Adresse konnte nicht aufgelöst werden.");
  }

  if (addresses.length === 0) {
    throw new BlockedUrlError("Diese Adresse konnte nicht aufgelöst werden.");
  }
  // Every address, not just the first: a hostname that resolves to one public and
  // one private address must not be reachable through the private one.
  if (addresses.some(({ address }) => isBlockedAddress(address))) {
    throw new BlockedUrlError("Diese Adresse verweist auf ein internes Netzwerk.");
  }

  return url;
}

/**
 * Fetches the page with redirects followed by hand, so each hop passes through
 * assertFetchable. `redirect: "manual"` is what makes that possible.
 */
export async function fetchGuarded(raw: string): Promise<{ html: string; finalUrl: URL }> {
  let url = await assertFetchable(raw);

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    let response: Response;
    try {
      response = await fetch(url, {
        redirect: "manual",
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: {
          "User-Agent": "NotebookBot/1.0 (+https://github.com/notebook; article reader)",
          Accept: "text/html,application/xhtml+xml",
        },
      });
    } catch (error) {
      if (error instanceof Error && error.name === "TimeoutError") {
        throw new BlockedUrlError("Die Seite hat nicht rechtzeitig geantwortet.");
      }
      throw new BlockedUrlError("Diese Seite konnte nicht geladen werden.");
    }

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) throw new BlockedUrlError("Diese Seite konnte nicht geladen werden.");
      url = await assertFetchable(new URL(location, url).toString());
      continue;
    }

    if (!response.ok) {
      throw new BlockedUrlError("Die Seite ist derzeit nicht erreichbar.");
    }

    const contentType = response.headers.get("content-type") ?? "";
    if (!HTML_TYPES.some((type) => contentType.includes(type))) {
      throw new BlockedUrlError("Diese Adresse ist keine Webseite.");
    }

    return { html: await readCapped(response), finalUrl: url };
  }

  throw new BlockedUrlError("Diese Seite leitet zu oft weiter.");
}

/**
 * Reads the body incrementally and aborts past the cap. Decoding is streamed
 * chunk-by-chunk rather than buffered into one Blob: that keeps peak memory to
 * roughly one copy of the page instead of several, and `stream: true` is what
 * makes a multi-byte UTF-8 character split across two chunks decode correctly.
 */
async function readCapped(response: Response): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) throw new BlockedUrlError("Diese Seite konnte nicht geladen werden.");

  const decoder = new TextDecoder();
  let html = "";
  let total = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > MAX_BYTES) {
      await reader.cancel();
      throw new BlockedUrlError("Diese Seite ist zu groß (Limit: 5 MB).");
    }
    html += decoder.decode(value, { stream: true });
  }
  html += decoder.decode();

  return html;
}
