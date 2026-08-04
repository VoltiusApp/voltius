import { describe, expect, it } from "vitest";
import { parseCatalog } from "./snippetCatalog";

const snippet = { name: "Tail journald", tags: [], favorite: false, only_for_connection_tags: [], only_for_distros: [], steps: [{ kind: "script", content: "journalctl -f" }] };
const entry = { id: "e1", kind: "snippet", name: "Tail journald", description: "d", author: "a", tags: ["logs"], updated_at: "2026-08-04", snippets: [snippet] };
const text = (over: object) => JSON.stringify({ version: 1, entries: [entry], ...over });

describe("parseCatalog", () => {
  it("returns the catalogue entries", () => {
    expect(parseCatalog(text({}))).toEqual([expect.objectContaining({ id: "e1", kind: "snippet" })]);
  });

  it("throws on malformed JSON", () => {
    expect(() => parseCatalog("{not json")).toThrow();
  });

  it("throws on an unsupported catalogue version", () => {
    expect(() => parseCatalog(text({ version: 2 }))).toThrow();
  });

  it("skips an entry missing required fields rather than blanking the catalogue", () => {
    const bad = { id: "e0", kind: "pack", snippets: [snippet] }; // no name
    expect(parseCatalog(text({ entries: [bad, entry] })).map(e => e.id)).toEqual(["e1"]);
  });

  it("skips a duplicate id, keeping the first", () => {
    const dupe = { ...entry, name: "Second" };
    expect(parseCatalog(text({ entries: [entry, dupe] })).map(e => e.name)).toEqual(["Tail journald"]);
  });

  it("skips a snippet-kind entry that does not carry exactly one snippet", () => {
    const two = { ...entry, id: "e2", snippets: [snippet, snippet] };
    expect(parseCatalog(text({ entries: [two, entry] })).map(e => e.id)).toEqual(["e1"]);
  });

  it("skips an entry whose snippets are not an array", () => {
    const bad = { ...entry, id: "e3", snippets: "nope" };
    expect(parseCatalog(text({ entries: [bad, entry] })).map(e => e.id)).toEqual(["e1"]);
  });
});
