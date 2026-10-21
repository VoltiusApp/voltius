import { describe, expect, it } from "vitest";
import { PAGE_MOTION as M } from "@/lib/motion";
import { layerDir, layerFrames, pickLayers, stackLayers, stackRootVisible, type LayerTransition } from "./pageTransition";

const push = (from: string[]): LayerTransition<readonly string[]> => ({ dir: "push", from });
const pop = (from: string[]): LayerTransition<readonly string[]> => ({ dir: "pop", from });

describe("layerDir", () => {
  it("is a push or pop only for a one-level change", () => {
    expect(layerDir(0, 1)).toBe("push");
    expect(layerDir(2, 1)).toBe("pop");
    expect(layerDir(1, 1)).toBeNull();
    expect(layerDir(2, 0)).toBeNull(); // tab switch clearing a deep stack: no transition
  });
});

describe("layerFrames", () => {
  it("push: the incoming page slides in from the right and fades in, the covered one shifts left and dims", () => {
    const f = layerFrames("push");
    expect(f.front).toEqual([{ translate: `${M.frontShift} 0px`, opacity: 0 }, { translate: "0px 0px", opacity: 1 }]);
    expect(f.back).toEqual([{ translate: "0px 0px", opacity: 1 }, { translate: `${M.backShift} 0px`, opacity: M.backOpacity }]);
  });

  it("pop reverses the push", () => {
    const p = layerFrames("pop");
    const q = layerFrames("push");
    expect(p.front).toEqual([...q.front].reverse());
    expect(p.back).toEqual([...q.back!].reverse());
  });

  it("pop after a predictive back continues from the gesture's pose and leaves the revealed layer alone", () => {
    const f = layerFrames("pop", { scale: "0.93 0.93", translate: "9px 0px", clipPath: "inset(0 round 28px)" });
    expect(f.front[0]).toEqual({ scale: "0.93 0.93", clipPath: "inset(0 round 28px)", translate: "9px 0px", opacity: 1 });
    expect(f.front[1]).toEqual({ scale: "0.93 0.93", clipPath: "inset(0 round 28px)", translate: `${M.frontShift} 0px`, opacity: 0 });
    expect(f.back).toBeNull();
    expect(layerFrames("pop", { scale: "0.9 0.9", translate: "0px 0px", clipPath: "" }).front[0]).not.toHaveProperty("clipPath");
  });
});

describe("stackLayers", () => {
  it("renders only the top page at rest", () => {
    expect(stackLayers(["a", "b"], null, false)).toEqual([{ item: "b", index: 1, role: "top" }]);
    expect(stackLayers([], null, false)).toEqual([]);
  });

  it("keeps the covered page under a push and under a peek", () => {
    const layers = [{ item: "a", index: 0, role: "under" }, { item: "b", index: 1, role: "top" }];
    expect(stackLayers(["a", "b"], push(["a"]), false)).toEqual(layers);
    expect(stackLayers(["a", "b"], null, true)).toEqual(layers);
  });

  it("keeps the popped page above the new top while it leaves", () => {
    expect(stackLayers(["a"], pop(["a", "b"]), false)).toEqual([
      { item: "a", index: 0, role: "top" },
      { item: "b", index: 1, role: "leave" },
    ]);
    expect(stackLayers([], pop(["a"]), false)).toEqual([{ item: "a", index: 0, role: "leave" }]);
  });

  it("keeps each layer's index (its React key) when its role changes", () => {
    const peeked = stackLayers(["a", "b"], null, true);
    const popped = stackLayers(["a"], pop(["a", "b"]), false);
    expect(peeked.map((l) => l.index)).toEqual(popped.map((l) => l.index));
  });
});

describe("stackRootVisible", () => {
  it("shows the tab screen at root and while the only page over it moves or is peeked", () => {
    expect(stackRootVisible(0, null, false)).toBe(true);
    expect(stackRootVisible(1, null, false)).toBe(false);
    expect(stackRootVisible(1, push([]), false)).toBe(true);
    expect(stackRootVisible(1, null, true)).toBe(true);
    expect(stackRootVisible(2, push(["a"]), true)).toBe(false);
  });
});

describe("pickLayers", () => {
  const el = (name: string) => ({ name }) as unknown as HTMLElement;
  const layers: Record<string, HTMLElement> = { top: el("top"), under: el("under"), leave: el("leave") };
  const base = () => el("base");

  it("push: incoming top over the covered page, or over the base at the bottom", () => {
    expect(pickLayers("push", (r) => layers[r], base)).toEqual({ front: layers.top, back: layers.under });
    expect(pickLayers("push", (r) => (r === "under" ? null : layers[r]), base)).toEqual({ front: layers.top, back: el("base") });
  });

  it("pop: the leaving page over the new top, or over the base", () => {
    expect(pickLayers("pop", (r) => layers[r], base)).toEqual({ front: layers.leave, back: layers.top });
    expect(pickLayers("pop", (r) => (r === "top" ? null : layers[r]), base)).toEqual({ front: layers.leave, back: el("base") });
  });
});
