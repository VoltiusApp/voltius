import { describe, test, expect, vi, beforeEach } from "vitest";
import { createProfilesStore } from "./profilesStore";
import type { ProviderProfile } from "../types";

function fakeApi() {
  const store = new Map<string, unknown>();
  const keys = new Map<string, string>();
  return {
    api: {
      storage: {
        get: vi.fn(async (k: string) => (store.has(k) ? store.get(k) : null)),
        set: vi.fn(async (k: string, v: unknown) => void store.set(k, v)),
        delete: vi.fn(async (k: string) => void store.delete(k)),
      },
      keychain: {
        get: vi.fn(async (k: string) => (keys.has(k) ? keys.get(k)! : null)),
        set: vi.fn(async (k: string, v: string) => void keys.set(k, v)),
        delete: vi.fn(async (k: string) => void keys.delete(k)),
      },
    } as any,
    store, keys,
  };
}
const P = (id: string): ProviderProfile => ({ id, providerKind: "anthropic", label: id, model: "claude-x" });
beforeEach(() => vi.clearAllMocks());

describe("profilesStore", () => {
  test("save then list round-trips via api.storage", async () => {
    const { api } = fakeApi();
    const s = createProfilesStore(api);
    await s.save(P("a"));
    await s.save(P("b"));
    expect((await s.list()).map((p) => p.id)).toEqual(["a", "b"]);
  });

  test("save updates an existing profile in place (no dup)", async () => {
    const { api } = fakeApi();
    const s = createProfilesStore(api);
    await s.save(P("a"));
    await s.save({ ...P("a"), label: "renamed" });
    const list = await s.list();
    expect(list).toHaveLength(1);
    expect(list[0].label).toBe("renamed");
  });

  test("first saved profile becomes active; setActive switches", async () => {
    const { api } = fakeApi();
    const s = createProfilesStore(api);
    await s.save(P("a"));
    expect(await s.getActiveId()).toBe("a");
    await s.save(P("b"));
    expect(await s.getActiveId()).toBe("a");
    await s.setActive("b");
    expect(await s.getActiveId()).toBe("b");
  });

  test("remove deletes the profile, its key, and clears active if it was active", async () => {
    const { api } = fakeApi();
    const s = createProfilesStore(api);
    await s.save(P("a"));
    await s.setKey("a", "sk-1");
    await s.remove("a");
    expect(await s.list()).toEqual([]);
    expect(await s.getKey("a")).toBeNull();
    expect(await s.getActiveId()).toBeNull();
    expect(api.keychain.delete).toHaveBeenCalledWith("ai-agent:provider:a:apiKey");
  });

  test("keys go to keychain under the namespaced key", async () => {
    const { api } = fakeApi();
    const s = createProfilesStore(api);
    await s.setKey("a", "sk-1");
    expect(api.keychain.set).toHaveBeenCalledWith("ai-agent:provider:a:apiKey", "sk-1");
    expect(await s.getKey("a")).toBe("sk-1");
  });
});
