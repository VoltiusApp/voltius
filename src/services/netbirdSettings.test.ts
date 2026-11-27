// @vitest-environment jsdom
import { beforeEach, describe, expect, test, vi } from "vitest";
import type { Connection } from "@/types";
import { migrateLegacyNetbird, netbirdComplete, normalizeFingerprint, normalizeNetbird, NETBIRD_DEFAULTS } from "./netbirdSettings";

const body = "A".repeat(43);
const conn = (id: string, over: Partial<Connection> = {}) => ({ id, ...over }) as Connection;

beforeEach(() => localStorage.clear());

describe("NetBird settings", () => {
  test("fingerprints are stored the way ssh-keygen prints them", () => {
    for (const pasted of [`SHA256:${body}`, ` sha256:${body}= `, body]) {
      expect(normalizeFingerprint(pasted)).toBe(`SHA256:${body}`);
    }
    expect(normalizeFingerprint("  ")).toBe("");
  });

  test("only an HTTPS issuer, a client ID and a SHA256 pin make the settings usable", () => {
    const ok = normalizeNetbird({ ...NETBIRD_DEFAULTS, issuer: "https://id.example/t", client_id: " c ", fingerprint: body });
    expect(netbirdComplete(ok)).toBe(true);
    for (const issuer of ["http://id.example", "https://u@id.example", "https://id.example?x=1", "https://id.example#f"]) {
      expect(netbirdComplete({ ...ok, issuer }), issuer).toBe(false);
    }
    expect(netbirdComplete({ ...ok, client_id: "" })).toBe(false);
    expect(netbirdComplete({ ...ok, fingerprint: "SHA256:short" })).toBe(false);
  });

  test("settings an earlier build kept in this browser move onto their host once", async () => {
    const legacy = { issuer: "https://id.example", clientId: "public", fingerprint: `SHA256:${body}`,
      scope: "openid", audience: "", tokenType: "id_token" };
    localStorage.setItem("netbird-ssh:c1", JSON.stringify(legacy));
    localStorage.setItem("netbird-ssh:c2", JSON.stringify(legacy));
    localStorage.setItem("netbird-ssh:gone", JSON.stringify(legacy));
    const saved = { ...NETBIRD_DEFAULTS, issuer: "https://kept.example" };
    const save = vi.fn(async () => {});

    await migrateLegacyNetbird([conn("c1"), conn("c2", { netbird: saved })], save);

    expect(save).toHaveBeenCalledExactlyOnceWith(conn("c1"), {
      issuer: "https://id.example", client_id: "public", fingerprint: `SHA256:${body}`,
      scope: "openid", audience: "", token_type: "id_token",
    });
    expect(localStorage.getItem("netbird-ssh:c1")).toBeNull();
    expect(localStorage.getItem("netbird-ssh:c2")).toBeNull();
    expect(localStorage.getItem("netbird-ssh:gone")).not.toBeNull();
  });
});
