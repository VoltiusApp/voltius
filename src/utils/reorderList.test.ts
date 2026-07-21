import { describe, it, expect } from "vitest";
import { reorder } from "./reorderList";

const mk = (...ids: string[]) => ids.map((id) => ({ id }));
const ids = (l: { id: string }[]) => l.map((x) => x.id);

describe("reorder", () => {
  it("moves an item down, dropping after the target", () => {
    expect(ids(reorder(mk("a", "b", "c", "d"), "a", "c", "after"))).toEqual(["b", "c", "a", "d"]);
  });
  it("moves an item down, dropping before the target", () => {
    expect(ids(reorder(mk("a", "b", "c", "d"), "a", "c", "before"))).toEqual(["b", "a", "c", "d"]);
  });
  it("moves an item up, dropping before the target", () => {
    expect(ids(reorder(mk("a", "b", "c", "d"), "d", "b", "before"))).toEqual(["a", "d", "b", "c"]);
  });
  it("moves an item up, dropping after the target", () => {
    expect(ids(reorder(mk("a", "b", "c", "d"), "d", "b", "after"))).toEqual(["a", "b", "d", "c"]);
  });
  it("is a no-op when from === to", () => {
    expect(ids(reorder(mk("a", "b", "c"), "b", "b", "after"))).toEqual(["a", "b", "c"]);
  });
  it("returns input unchanged when an id is missing", () => {
    expect(ids(reorder(mk("a", "b"), "a", "zzz", "after"))).toEqual(["a", "b"]);
  });
  it("does not mutate the input array", () => {
    const input = mk("a", "b", "c");
    reorder(input, "a", "c", "after");
    expect(ids(input)).toEqual(["a", "b", "c"]);
  });
});
