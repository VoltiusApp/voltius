import { describe, expect, it } from "vitest";
import type { CatalogEntry } from "./snippetCatalog";
import { resolveSelection } from "./snippetCatalogSelection";

const sn = (eid: string, name: string, steps: unknown[] = []) =>
  ({ _eid: eid, name, tags: [], favorite: false, only_for_connection_tags: [], only_for_distros: [], steps }) as never;

const entry: CatalogEntry = {
  id: "p", kind: "pack", name: "P", tags: [],
  snippets: [
    sn("s0", "A", [{ kind: "snippet", _eid: "s1" }]),
    sn("s1", "B", [{ kind: "snippet", _eid: "s2" }]),
    sn("s2", "C"),
    sn("s3", "D"),
  ],
};

describe("resolveSelection", () => {
  it("leaves an independent pick alone", () => {
    expect(resolveSelection(entry, ["s3"])).toEqual({ selected: ["s3"], autoIncluded: [] });
  });

  it("pulls in the whole call chain behind a pick, naming the caller", () => {
    const r = resolveSelection(entry, ["s0"]);

    expect(r.selected.sort()).toEqual(["s0", "s1", "s2"]);
    expect(r.autoIncluded).toEqual([
      { eid: "s1", name: "B", becauseOf: "A" },
      { eid: "s2", name: "C", becauseOf: "B" },
    ]);
  });

  it("does not report a dependency the user picked themselves as auto-included", () => {
    expect(resolveSelection(entry, ["s0", "s1", "s2"]).autoIncluded).toEqual([]);
  });

  it("returns nothing for an empty pick", () => {
    expect(resolveSelection(entry, [])).toEqual({ selected: [], autoIncluded: [] });
  });
});
