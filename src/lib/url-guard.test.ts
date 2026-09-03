import { describe, expect, it } from "vitest";

import { assertFetchable, isAllowedHost, isBlockedAddress } from "@/lib/url-guard";

describe("isBlockedAddress", () => {
  it("blocks loopback", () => {
    expect(isBlockedAddress("127.0.0.1")).toBe(true);
    expect(isBlockedAddress("127.1.2.3")).toBe(true);
    expect(isBlockedAddress("::1")).toBe(true);
  });

  it("blocks link-local, which is where cloud metadata lives", () => {
    expect(isBlockedAddress("169.254.169.254")).toBe(true);
    expect(isBlockedAddress("169.254.0.1")).toBe(true);
    expect(isBlockedAddress("fe80::1")).toBe(true);
  });

  it("blocks the RFC1918 private ranges", () => {
    expect(isBlockedAddress("10.0.0.1")).toBe(true);
    expect(isBlockedAddress("172.16.0.1")).toBe(true);
    expect(isBlockedAddress("172.31.255.255")).toBe(true);
    expect(isBlockedAddress("192.168.1.1")).toBe(true);
  });

  it("does not block the public addresses that neighbour 172.16/12", () => {
    expect(isBlockedAddress("172.15.0.1")).toBe(false);
    expect(isBlockedAddress("172.32.0.1")).toBe(false);
  });

  it("blocks CGNAT and the unspecified address", () => {
    expect(isBlockedAddress("100.64.0.1")).toBe(true);
    expect(isBlockedAddress("0.0.0.0")).toBe(true);
    expect(isBlockedAddress("::")).toBe(true);
  });

  it("blocks IPv6 unique-local", () => {
    expect(isBlockedAddress("fc00::1")).toBe(true);
    expect(isBlockedAddress("fd12:3456::1")).toBe(true);
  });

  it("unmaps IPv4-mapped IPv6 before deciding", () => {
    expect(isBlockedAddress("::ffff:10.0.0.1")).toBe(true);
    expect(isBlockedAddress("::ffff:169.254.169.254")).toBe(true);
    expect(isBlockedAddress("::ffff:93.184.216.34")).toBe(false);
  });

  it("allows ordinary public addresses", () => {
    expect(isBlockedAddress("93.184.216.34")).toBe(false);
    expect(isBlockedAddress("8.8.8.8")).toBe(false);
    expect(isBlockedAddress("2606:2800:220:1:248:1893:25c8:1946")).toBe(false);
  });

  it("catches every equivalent spelling of an embedded IPv4 host", () => {
    expect(isBlockedAddress("::ffff:7f00:1")).toBe(true); // mapped loopback, hex hextets
    expect(isBlockedAddress("::ffff:0:127.0.0.1")).toBe(true); // ::ffff:0:0/96 form
    expect(isBlockedAddress("0:0:0:0:0:ffff:127.0.0.1")).toBe(true); // fully expanded mapped
    expect(isBlockedAddress("::127.0.0.1")).toBe(true); // deprecated IPv4-compatible
    expect(isBlockedAddress("::7f00:1")).toBe(true); // same, hex
    expect(isBlockedAddress("64:ff9b::127.0.0.1")).toBe(true); // NAT64 well-known prefix
    expect(isBlockedAddress("0:0:0:0:0:0:0:1")).toBe(true); // loopback, fully expanded
  });

  it("respects the exact CGNAT boundary, 100.64.0.0/10", () => {
    expect(isBlockedAddress("100.63.0.1")).toBe(false);
    expect(isBlockedAddress("100.128.0.1")).toBe(false);
    expect(isBlockedAddress("100.64.0.1")).toBe(true);
    expect(isBlockedAddress("100.127.255.255")).toBe(true);
  });

  it("respects the exact link-local boundary, 169.254.0.0/16", () => {
    expect(isBlockedAddress("169.253.0.1")).toBe(false);
    expect(isBlockedAddress("169.255.0.1")).toBe(false);
  });

  it("respects the exact IPv6 prefix boundaries", () => {
    expect(isBlockedAddress("fe7f::1")).toBe(false); // just below fe80::/10
    expect(isBlockedAddress("febf::1")).toBe(true); // top of fe80::/10
    expect(isBlockedAddress("fec0::1")).toBe(true); // deprecated site-local, fec0::/10
    expect(isBlockedAddress("fb00::1")).toBe(false); // just below fc00::/7
    expect(isBlockedAddress("fdff::1")).toBe(true); // top of fc00::/7
  });
});

describe("assertFetchable", () => {
  it("rejects a non-https scheme before any network call", async () => {
    await expect(assertFetchable("http://de.wikipedia.org/")).rejects.toThrow(
      "Nur https-Adressen werden unterstützt.",
    );
  });

  it("rejects credentials in the URL before any network call", async () => {
    await expect(assertFetchable("https://user:pass@de.wikipedia.org/")).rejects.toThrow(
      "Adressen mit Zugangsdaten werden nicht unterstützt.",
    );
  });

  it("rejects a host outside the allowlist before any network call", async () => {
    // Asserts the invariant, not the domain list: the message names whatever is
    // currently allowed, so pinning the full string breaks on every allowlist edit.
    await expect(assertFetchable("https://example.com/")).rejects.toThrow(
      /^Es können nur Seiten von .+ hinzugefügt werden\.$/,
    );
  });
});

describe("isAllowedHost", () => {
  it("allows the domain itself and its subdomains", () => {
    expect(isAllowedHost("wikipedia.org")).toBe(true);
    expect(isAllowedHost("de.wikipedia.org")).toBe(true);
    expect(isAllowedHost("en.m.wikipedia.org")).toBe(true);
    expect(isAllowedHost("DE.WIKIPEDIA.ORG")).toBe(true);
    expect(isAllowedHost("de.wikipedia.org.")).toBe(true);
  });

  it("rejects lookalikes that merely end in the same letters", () => {
    expect(isAllowedHost("notwikipedia.org")).toBe(false);
    expect(isAllowedHost("mywikipedia.org")).toBe(false);
    expect(isAllowedHost("wikipedia.org.evil.com")).toBe(false);
  });

  it("rejects the sibling Wikimedia projects and shortlinks", () => {
    expect(isAllowedHost("wikimedia.org")).toBe(false);
    expect(isAllowedHost("de.wiktionary.org")).toBe(false);
    expect(isAllowedHost("commons.wikimedia.org")).toBe(false);
    expect(isAllowedHost("w.wiki")).toBe(false);
  });

  it("rejects unrelated hosts", () => {
    expect(isAllowedHost("example.com")).toBe(false);
    expect(isAllowedHost("localhost")).toBe(false);
    expect(isAllowedHost("")).toBe(false);
  });
});
