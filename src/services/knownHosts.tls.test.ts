import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/invoke", () => ({ invoke: vi.fn() }));
const { isTlsPin } = await import("./knownHosts");

describe("isTlsPin", () => {
  it("tells certificate pins from SSH host keys", () => {
    expect(isTlsPin("tls-sha256:ab12")).toBe(true);
    expect(isTlsPin("SHA256:abc")).toBe(false);
  });
});
