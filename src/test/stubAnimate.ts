import { vi } from "vitest";

/**
 * Stub WAAPI for jsdom (it has no Element.animate): each animate() returns an
 * animation whose `finished` the test resolves. Undo with `unstubAnimate()`.
 */
export function stubAnimate() {
  const finishers: Array<() => void> = [];
  const animate = vi.fn(function (this: Element, _frames: Keyframe[], _opts?: KeyframeAnimationOptions) {
    let resolve!: () => void;
    const finished = new Promise<void>((r) => (resolve = r));
    finishers.push(resolve);
    return { finished, cancel: vi.fn() } as unknown as Animation;
  });
  Element.prototype.animate = animate as unknown as Element["animate"];
  return {
    animate,
    finishAll: () => finishers.splice(0).forEach((f) => f()),
  };
}

export function unstubAnimate() {
  delete (Element.prototype as Partial<Element>).animate;
}
