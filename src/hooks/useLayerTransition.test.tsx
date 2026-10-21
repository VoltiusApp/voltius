import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { useLayerTransition } from "./pageTransition";
import { stubAnimate, unstubAnimate } from "@/test/stubAnimate";

afterEach(unstubAnimate);

describe("useLayerTransition", () => {
  it("reports a push with the previous value, animates both layers, then goes idle", async () => {
    const { animate, finishAll } = stubAnimate();
    const front = document.createElement("div");
    const back = document.createElement("div");
    const { result, rerender } = renderHook(({ v }) => useLayerTransition(v, v.length, () => ({ front, back })), {
      initialProps: { v: ["a"] },
    });
    expect(result.current).toBeNull();
    rerender({ v: ["a", "b"] });
    expect(result.current).toEqual({ dir: "push", from: ["a"] });
    expect(animate).toHaveBeenCalledTimes(2);
    await act(async () => finishAll());
    expect(result.current).toBeNull();
  });

  it("reports a pop and continues a handed-over predictive back pose", () => {
    const { animate } = stubAnimate();
    const front = document.createElement("div");
    front.style.scale = "0.9 0.9";
    front.style.translate = "12px 0px";
    const { result, rerender } = renderHook(({ v }) => useLayerTransition(v, v.length, () => ({ front, back: null })), {
      initialProps: { v: ["a", "b"] },
    });
    rerender({ v: ["a"] });
    expect(result.current).toEqual({ dir: "pop", from: ["a", "b"] });
    const frames = animate.mock.calls[0][0];
    expect(frames[0]).toMatchObject({ scale: "0.9 0.9", translate: "12px 0px", opacity: 1 });
    expect(front.style.scale).toBe(""); // the animation owns the pose now
  });

  it("swaps at once without WAAPI or for a multi-level jump", () => {
    const { result, rerender } = renderHook(({ v }) => useLayerTransition(v, v.length, () => ({ front: null, back: null })), {
      initialProps: { v: ["a"] },
    });
    rerender({ v: ["a", "b"] }); // jsdom: no Element.prototype.animate
    expect(result.current).toBeNull();
    stubAnimate();
    rerender({ v: [] });
    expect(result.current).toBeNull();
  });
});
