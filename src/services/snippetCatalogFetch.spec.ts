import { beforeEach, describe, expect, it, vi } from "vitest";

const appFetch = vi.fn();
const invoke = vi.fn();
vi.mock("./http", () => ({ appFetch: (...a: unknown[]) => appFetch(...a) }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...a: unknown[]) => invoke(...a) }));

const { fetchCatalog, CATALOG_URL } = await import("./snippetCatalogFetch");

const body = JSON.stringify({
  version: 1,
  entries: [{ id: "e1", kind: "snippet", name: "N", tags: [], snippets: [{ name: "N", tags: [], favorite: false, only_for_connection_tags: [], only_for_distros: [], steps: [] }] }],
});

const ok = () => new Response(body, { status: 200 });

beforeEach(() => {
  appFetch.mockReset();
  invoke.mockReset();
  invoke.mockResolvedValue(undefined);
});

describe("fetchCatalog", () => {
  it("fetches the catalogue and reports it came from the network", async () => {
    appFetch.mockResolvedValue(ok());

    const result = await fetchCatalog();

    expect(appFetch).toHaveBeenCalledWith(CATALOG_URL);
    expect(result.entries.map(e => e.id)).toEqual(["e1"]);
    expect(result.fromCache).toBe(false);
  });

  it("caches the fetched body so a later offline load can use it", async () => {
    appFetch.mockResolvedValue(ok());

    await fetchCatalog();

    expect(invoke).toHaveBeenCalledWith("plugin_write_file", expect.objectContaining({ content: body }));
  });

  it("falls back to the cached copy when the network fails", async () => {
    appFetch.mockRejectedValue(new Error("offline"));
    invoke.mockResolvedValue(body);

    const result = await fetchCatalog();

    expect(result.entries.map(e => e.id)).toEqual(["e1"]);
    expect(result.fromCache).toBe(true);
  });

  it("falls back to the cache on an HTTP error rather than treating the error page as a catalogue", async () => {
    appFetch.mockResolvedValue(new Response("not found", { status: 404 }));
    invoke.mockResolvedValue(body);

    expect((await fetchCatalog()).fromCache).toBe(true);
  });

  it("throws when the network fails and nothing is cached", async () => {
    appFetch.mockRejectedValue(new Error("offline"));
    invoke.mockRejectedValue(new Error("no such file"));

    await expect(fetchCatalog()).rejects.toThrow();
  });

  it("does not overwrite the cache with a body it cannot parse", async () => {
    appFetch.mockResolvedValue(new Response("{not json", { status: 200 }));
    invoke.mockResolvedValue(body);

    const result = await fetchCatalog();

    expect(invoke).not.toHaveBeenCalledWith("plugin_write_file", expect.anything());
    expect(result.fromCache).toBe(true);
  });
});
