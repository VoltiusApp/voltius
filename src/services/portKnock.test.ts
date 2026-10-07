import { describe, expect, it, vi } from "vitest";

vi.mock("@/i18n", () => ({ default: { t: (k: string) => k } }));
const stored = vi.hoisted(() => ({ value: null as string | null }));
vi.mock("@/services/vault", () => ({ getSecret: async () => stored.value }));
vi.mock("@/services/credentials", () => ({ findConnection: () => undefined }));

import { formatKnockSequence, parseKnockSequence, resolveKnock, toKnockSpec, KnockSequenceError } from "./portKnock";

describe("knock sequence codec", () => {
  it("round-trips ordered steps", () => {
    const steps = [{ port: 10001, protocol: "tcp" as const }, { port: 20002, protocol: "udp" as const }, { port: 30003, protocol: "tcp" as const }];
    expect(formatKnockSequence(steps)).toBe("10001/tcp,20002/udp,30003/tcp");
    expect(parseKnockSequence("10001/tcp,20002/udp,30003/tcp")).toEqual(steps);
  });

  it.each([
    ["", "empty"],
    ["0/tcp", "port"],
    ["65536/tcp", "port"],
    ["22/sctp", "protocol"],
    [Array.from({ length: 17 }, (_, i) => `${i + 1}/tcp`).join(","), "too-many"],
  ])("rejects %j as %s", (text, reason) => {
    expect(() => parseKnockSequence(text)).toThrow(KnockSequenceError);
    try { parseKnockSequence(text); } catch (e) { expect((e as KnockSequenceError).reason).toBe(reason); }
  });

  it("fills timing defaults", () => {
    expect(toKnockSpec({ enabled: true }, "666/tcp")).toEqual({ steps: [{ port: 666, protocol: "tcp" }], delay_ms: 200, settle_ms: 500 });
  });
});

describe("resolveKnock", () => {
  it("names a stored sequence that does not parse as invalid, not as a raw codec error", async () => {
    stored.value = "0/tcp";
    await expect(resolveKnock({ id: "c1", port_knock: { enabled: true } })).rejects.toThrow("connections.knock.sequenceInvalid");
    stored.value = null;
  });
});
