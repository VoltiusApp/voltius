import { describe, expect, it } from "vitest";
import { anchoredScroll, effectiveScale, fitScale, stepZoom } from "./imageZoom";

describe("fitScale", () => {
  it("shrinks a large image to the tighter side", () => {
    expect(fitScale({ w: 3200, h: 1600 }, { w: 1600, h: 400 })).toBe(0.25);
  });
  it("never upscales a small image", () => {
    expect(fitScale({ w: 256, h: 256 }, { w: 1400, h: 700 })).toBe(1);
  });
  it("treats an unmeasured image or box as actual size", () => {
    expect(fitScale({ w: 0, h: 0 }, { w: 100, h: 100 })).toBe(1);
  });
});

describe("stepZoom", () => {
  it("steps by a quarter and clamps", () => {
    expect(stepZoom(1, 1)).toBe(1.25);
    expect(stepZoom(1, -1)).toBe(0.8);
    expect(stepZoom(7.5, 1)).toBe(8);
    expect(stepZoom(0.11, -1)).toBe(0.1);
  });
  it("steps from the fitted scale when the image is fitted", () => {
    const scale = effectiveScale("fit", { w: 2000, h: 1000 }, { w: 1000, h: 1000 });
    expect(stepZoom(scale, 1)).toBe(0.63);
  });
});

describe("anchoredScroll", () => {
  it("keeps the point under the cursor in place", () => {
    expect(anchoredScroll(100, 50, 1, 2)).toBe(250);
    expect(anchoredScroll(0, 0, 2, 1)).toBe(0);
  });
});
