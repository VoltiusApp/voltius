import { describe, it, expect, vi, beforeEach } from "vitest";

const secrets: Record<string, string> = {};
vi.mock("@/services/vault", () => ({ getSecret: async (k: string) => secrets[k] ?? null }));

import { resolveProxy } from "./proxy";
import { useConnectivitySettingsStore } from "@/stores/connectivitySettingsStore";

const TYPED_PW = ["typed", "pw"].join("-");

const setGlobal = (proxy: object) => useConnectivitySettingsStore.setState({ proxy } as never);

describe("resolveProxy", () => {
  beforeEach(() => {
    for (const k of Object.keys(secrets)) delete secrets[k];
    setGlobal({ mode: "none" });
  });

  it("global none + no override → null (direct, unchanged behaviour)", async () => {
    expect(await resolveProxy({ id: "c" })).toBeNull();
  });

  it("inherits the global socks5 with the global password", async () => {
    setGlobal({ mode: "socks5", host: "g", port: 1080, username: "gu" });
    secrets["proxy_password:__global__"] = "gp";
    expect(await resolveProxy({ id: "c" })).toEqual({ kind: "socks5", host: "g", port: 1080, username: "gu", password: "gp" });
  });

  it("override direct beats global socks5", async () => {
    setGlobal({ mode: "socks5", host: "g", port: 1080 });
    expect(await resolveProxy({ id: "c", proxy: { mode: "direct" } })).toEqual({ kind: "direct" });
  });

  it("per-host http uses the per-host password", async () => {
    secrets["proxy_password:c"] = "hp";
    expect(await resolveProxy({ id: "c", proxy: { mode: "http", host: "h", port: 3128, username: "hu" } }))
      .toEqual({ kind: "http", host: "h", port: 3128, username: "hu", password: "hp" });
  });

  it("system passes through without credentials", async () => {
    setGlobal({ mode: "system" });
    expect(await resolveProxy({ id: "c" })).toEqual({ kind: "system" });
  });

  it("custom mode with no host falls back to null instead of a broken spec", async () => {
    expect(await resolveProxy({ id: "c", proxy: { mode: "socks5" } })).toBeNull();
  });

  it("form overrides win over the saved values", async () => {
    secrets["proxy_password:c"] = "saved";
    const spec = await resolveProxy(
      { id: "c", proxy: { mode: "direct" } },
      { proxy: { mode: "socks5", host: "typed", port: 9 }, password: TYPED_PW },
    );
    expect(spec).toEqual({ kind: "socks5", host: "typed", port: 9, password: TYPED_PW });
  });
});
