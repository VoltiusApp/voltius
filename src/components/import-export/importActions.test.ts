import { describe, expect, it } from "vitest";
import { defaultActions, setActions } from "./importActions";

const meta = (keys: boolean[]) => ({
  connections: [{ isDupe: false }, { isDupe: true }],
  keys: keys.map((isDupe) => ({ isDupe })),
  identities: [],
  snippets: [],
  pfRules: [],
});

describe("defaultActions", () => {
  it("skips duplicates and includes the rest", () => {
    expect([...defaultActions(meta([false]), false, new Map(), new Set())]).toEqual([
      ["connections:0", "include"], ["connections:1", "skip"], ["keys:0", "include"],
    ]);
  });

  it("skips every key when a team vault is a destination", () => {
    expect(defaultActions(meta([false, true]), true, new Map(), new Set()).get("keys:0")).toBe("skip");
  });

  it("keeps choices the user made by hand", () => {
    const previous = new Map([["keys:0", "include" as const], ["connections:0", "skip" as const]]);
    const next = defaultActions(meta([false]), true, previous, new Set(["keys:0"]));
    expect(next.get("keys:0")).toBe("include");
    expect(next.get("connections:0")).toBe("include");
  });
});

describe("setActions", () => {
  it("records every changed key as hand-chosen so a destination change keeps it", () => {
    const touched = new Set<string>();
    const first = defaultActions(meta([false, false]), false, new Map(), touched);
    const chosen = setActions(first, ["keys:0", "keys:1"], "include", touched);
    expect([...touched]).toEqual(["keys:0", "keys:1"]);
    const next = defaultActions(meta([false, false]), true, chosen, touched);
    expect(next.get("keys:0")).toBe("include");
    expect(next.get("keys:1")).toBe("include");
  });
});
