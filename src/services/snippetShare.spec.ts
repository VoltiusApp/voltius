import { describe, expect, it } from "vitest";
import type { Snippet } from "@/types";
import { SnippetRefError } from "./import-export/snippetRefs";
import { buildShareEntry, shareEntryJson, githubNewFileUrl } from "./snippetShare";

const snip = (over: Partial<Snippet> & { id: string; name: string }): Snippet => ({
  steps: [{ kind: "script", content: "echo hi" }], tags: [], favorite: false,
  only_for_connection_tags: [], only_for_distros: [],
  created_at: "", updated_at: "", vault_id: "personal", clocks: {}, ...over,
});

describe("buildShareEntry", () => {
  it("builds a snippet-kind entry from one snippet", () => {
    const entry = buildShareEntry([snip({ id: "a", name: "Tail journald" })], { author: "kipavy" });

    expect(entry.kind).toBe("snippet");
    expect(entry.name).toBe("Tail journald");
    expect(entry.author).toBe("kipavy");
    expect(entry.snippets).toHaveLength(1);
  });

  it("builds a pack-kind entry when given a name for several snippets", () => {
    const entry = buildShareEntry(
      [snip({ id: "a", name: "A" }), snip({ id: "b", name: "B" })],
      { packName: "Docker essentials" },
    );

    expect(entry.kind).toBe("pack");
    expect(entry.name).toBe("Docker essentials");
    expect(entry.snippets.map(s => s.name)).toEqual(["A", "B"]);
  });

  it("slugifies the id from the name", () => {
    expect(buildShareEntry([snip({ id: "a", name: "Docker & Compose Essentials!" })], {}).id)
      .toBe("docker-compose-essentials");
  });

  it("rewrites a nested call to the target's _eid", () => {
    const entry = buildShareEntry([
      snip({ id: "a", name: "A", steps: [{ kind: "snippet", snippet_id: "b" }] }),
      snip({ id: "b", name: "B" }),
    ], { packName: "P" });

    expect(entry.snippets[0].steps).toEqual([{ kind: "snippet", _eid: entry.snippets[1]._eid }]);
  });

  it("refuses to share a snippet whose call is not part of the selection", () => {
    expect(() => buildShareEntry([snip({ id: "a", name: "A", steps: [{ kind: "snippet", snippet_id: "gone" }] })], {}))
      .toThrow(SnippetRefError);
  });

  it("carries the union of the snippets' tags", () => {
    const entry = buildShareEntry([
      snip({ id: "a", name: "A", tags: ["docker"] }),
      snip({ id: "b", name: "B", tags: ["docker", "logs"] }),
    ], { packName: "P" });

    expect(entry.tags.sort()).toEqual(["docker", "logs"]);
  });
});

describe("shareEntryJson", () => {
  it("emits the entry as pretty JSON without vault or local ids", () => {
    const json = shareEntryJson(buildShareEntry([snip({ id: "local-uuid-1234", name: "Tail journald" })], {}));

    expect(json).toContain("\"kind\": \"snippet\"");
    expect(json).not.toContain("vault_id");
    expect(json).not.toContain("clocks");
    expect(json).not.toContain("local-uuid-1234");
  });
});

describe("githubNewFileUrl", () => {
  it("targets the entries directory with the entry id as the filename", () => {
    expect(githubNewFileUrl("docker-essentials"))
      .toBe("https://github.com/voltiusApp/marketplace/new/main?filename=snippets/entries/docker-essentials.json");
  });
});
