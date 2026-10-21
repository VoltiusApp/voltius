import { afterEach, describe, expect, it, vi } from "vitest";
import { DURATION, EASING, animate, durVar, easeVar, motionMs, timing, transition } from "./motion";

// Vitest strips CSS imports (even ?raw) and the project has no Node types: read the file via a loose import.
const { readFileSync } = (await import(/* @vite-ignore */ "node:" + "fs")) as {
  readFileSync: (file: URL, encoding: "utf8") => string;
};
const css = readFileSync(new URL("../styles/globals.css", import.meta.url), "utf8");

/** Declarations of the first block that follows `selector`. */
const block = (selector: string) => {
  const i = css.indexOf(selector);
  expect(i, selector).toBeGreaterThanOrEqual(0);
  const body = css.slice(css.indexOf("{", i) + 1, css.indexOf("}", i));
  return Object.fromEntries([...body.matchAll(/(--vt-[\w-]+)\s*:\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
};
const varName = (v: string) => v.slice(4, -1);

const setReduced = (reduce: boolean) =>
  vi.stubGlobal("matchMedia", (q: string) => ({ matches: reduce && q.includes("reduce"), media: q }));

afterEach(() => vi.unstubAllGlobals());

describe("motion tokens", () => {
  it("CSS custom properties mirror the TS tokens", () => {
    const root = block("/* Motion tokens");
    for (const [k, v] of Object.entries(EASING)) expect(root[varName(easeVar(k as keyof typeof EASING))], k).toBe(v);
    for (const [k, v] of Object.entries(DURATION)) expect(root[varName(durVar(k as keyof typeof DURATION))], k).toBe(`${v}ms`);
  });

  it("reduced motion zeroes every CSS duration", () => {
    const reduced = block("/* Motion tokens, reduced");
    for (const k of Object.keys(DURATION)) expect(reduced[varName(durVar(k as keyof typeof DURATION))], k).toBe("0ms");
  });

  it("builds transitions from the custom properties", () => {
    expect(easeVar("emphasizedDecelerate")).toBe("var(--vt-ease-emphasized-decelerate)");
    expect(transition(["transform", "opacity"], "medium2", "standard")).toBe(
      "transform var(--vt-dur-medium2) var(--vt-ease-standard), opacity var(--vt-dur-medium2) var(--vt-ease-standard)",
    );
    expect(transition("opacity", "short4", "linear")).toBe("opacity var(--vt-dur-short4) var(--vt-ease-linear)");
  });

  it("JS timing follows the tokens and collapses to 0 under reduced motion", () => {
    setReduced(false);
    expect(motionMs("medium1")).toBe(250);
    expect(motionMs(120)).toBe(120);
    expect(timing("short2", "emphasizedAccelerate", { fill: "forwards" })).toEqual({
      fill: "forwards", duration: 100, easing: EASING.emphasizedAccelerate,
    });
    setReduced(true);
    expect(motionMs("long4")).toBe(0);
    expect(motionMs(120)).toBe(0);
    expect(timing("medium2", "standard").duration).toBe(0);
  });

  it("animate() hands token timing to WAAPI", () => {
    setReduced(false);
    const el = { animate: vi.fn(() => ({}) as Animation) } as unknown as Element;
    const frames = [{ opacity: 0 }, { opacity: 1 }];
    animate(el, frames, "medium4", "emphasizedDecelerate");
    expect(el.animate).toHaveBeenCalledWith(frames, { duration: 400, easing: EASING.emphasizedDecelerate });
  });

  it("survives a runtime without matchMedia", () => {
    vi.stubGlobal("matchMedia", undefined);
    expect(motionMs("short3")).toBe(150);
  });
});
