import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { useFadeThrough, useSlideAway } from "./pageTransition";
import { stubAnimate, unstubAnimate } from "@/test/stubAnimate";

afterEach(unstubAnimate);

describe("useFadeThrough", () => {
  it("keeps the old value through the fade-out, then fades the new one in", async () => {
    const { animate, finishAll } = stubAnimate();
    const el = document.createElement("div");
    const { result, rerender } = renderHook(({ v }) => useFadeThrough(v, true, () => el), { initialProps: { v: "hosts" } });
    rerender({ v: "snippets" });
    expect(result.current).toBe("hosts");
    expect(animate.mock.calls[0][0]).toEqual([{ opacity: 1 }, { opacity: 0 }]);
    await act(async () => finishAll());
    expect(result.current).toBe("snippets");
    expect(animate.mock.calls[1][0][0]).toMatchObject({ opacity: 0, scale: "0.92" });
  });

  it("lands on the latest value when it changes again mid fade-out, even back to the shown one", async () => {
    const { animate, finishAll } = stubAnimate();
    const el = document.createElement("div");
    const { result, rerender } = renderHook(({ v }) => useFadeThrough(v, true, () => el), { initialProps: { v: "a" } });
    rerender({ v: "b" });
    rerender({ v: "a" });
    await act(async () => finishAll());
    expect(result.current).toBe("a");
    expect(animate).toHaveBeenCalledTimes(2); // one fade-out, then the fade-in (never stuck transparent)
  });

  it("swaps at once when disabled or without WAAPI", () => {
    const el = document.createElement("div");
    const { result, rerender } = renderHook(({ v, on }) => useFadeThrough(v, on, () => el), { initialProps: { v: "a", on: true } });
    rerender({ v: "b", on: true }); // jsdom: no Element.prototype.animate
    expect(result.current).toBe("b");
    const { animate } = stubAnimate();
    rerender({ v: "c", on: false });
    expect(result.current).toBe("c");
    expect(animate).not.toHaveBeenCalled();
  });
});

describe("useSlideAway", () => {
  it("slides out then hides, slides back then settles", async () => {
    const { animate, finishAll } = stubAnimate();
    const { result, rerender } = renderHook(({ v }) => {
      const s = useSlideAway<HTMLDivElement>(v);
      // The consumer renders the bar while not hidden; attach a node so the hook can animate it.
      if (s.phase !== "hidden" && !s.ref.current) (s.ref as { current: HTMLDivElement }).current = document.createElement("div");
      return s;
    }, { initialProps: { v: true } });
    expect(result.current.phase).toBe("shown");
    rerender({ v: false });
    expect(result.current.phase).toBe("hiding");
    expect(animate.mock.calls[0][0]).toEqual([{ translate: "0px 0px" }, { translate: "0px 100%" }]);
    await act(async () => finishAll());
    expect(result.current.phase).toBe("hidden");
    rerender({ v: true });
    expect(result.current.phase).toBe("showing");
    await act(async () => finishAll());
    expect(result.current.phase).toBe("shown");
  });

  it("toggles at once without WAAPI", () => {
    const { result, rerender } = renderHook(({ v }) => useSlideAway(v), { initialProps: { v: true } });
    rerender({ v: false });
    expect(result.current.phase).toBe("hidden");
  });
});
