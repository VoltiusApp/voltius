import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/invoke", () => ({ invoke: vi.fn() }));
const { isTlsPin, fingerprintLabel } = await import("./knownHosts");

describe("isTlsPin", () => {
  it("tells certificate pins from SSH host keys", () => {
    expect(isTlsPin("tls-sha256:ab12")).toBe(true);
    expect(isTlsPin("tls-webpki")).toBe(true);
    expect(isTlsPin("SHA256:abc")).toBe(false);
  });
});

describe("fingerprintLabel", () => {
  const t = ((key: string) => key) as never;
  it("names the CA marker and truncates real fingerprints", () => {
    expect(fingerprintLabel("tls-webpki", t, (fp) => fp.slice(0, 4))).toBe("knownHosts.caVerified");
    expect(fingerprintLabel("SHA256:abcdef", t, (fp) => fp.slice(0, 4))).toBe("SHA2");
  });
});
