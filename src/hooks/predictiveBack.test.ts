import { describe, expect, it } from "vitest";
import { BACK_PREVIEW as M } from "@/lib/motion";
import { previewFrame } from "./predictiveBack";

describe("previewFrame", () => {
  it("is the identity at rest", () => {
    expect(previewFrame("page", 0, "left", 412, 915)).toEqual({ scaleX: 1, scaleY: 1, x: 0, radius: 0 });
    expect(previewFrame("sheet", 0, "left", 412, 400)).toEqual({ scaleX: 1, scaleY: 1, x: 0 });
  });

  it("shrinks a page to 90 % and shifts it toward the swiped edge", () => {
    const left = previewFrame("page", 1, "left", 412, 915);
    expect(left.scaleX).toBeCloseTo(M.pageMinScale);
    expect(left.scaleY).toBeCloseTo(M.pageMinScale);
    expect(left.x).toBeCloseTo(412 / 20 - 8);
    expect(left.radius).toBe(M.pageCornerPx);
    expect(previewFrame("page", 1, "right", 412, 915).x).toBeCloseTo(-(412 / 20 - 8));
    expect(previewFrame("page", 1, "none", 412, 915).x).toBe(0);
  });

  it("rounds the corners fully by a quarter of the gesture", () => {
    expect(previewFrame("page", 0.125, "left", 412, 915).radius).toBeCloseTo(M.pageCornerPx / 2);
    expect(previewFrame("page", 0.5, "left", 412, 915).radius).toBe(M.pageCornerPx);
  });

  it("shrinks a sheet by fixed px, without shifting it or touching its corners", () => {
    const f = previewFrame("sheet", 1, "right", 400, 300);
    expect(f.scaleX).toBeCloseTo(1 - M.sheetShrinkXPx / 400);
    expect(f.scaleY).toBeCloseTo(1 - M.sheetShrinkYPx / 300);
    expect(f.x).toBe(0);
    expect(f.radius).toBeUndefined();
  });

  it("clamps progress and survives an unmeasured layer", () => {
    expect(previewFrame("page", 2, "left", 412, 915)).toEqual(previewFrame("page", 1, "left", 412, 915));
    expect(previewFrame("page", -1, "left", 412, 915)).toEqual(previewFrame("page", 0, "left", 412, 915));
    expect(previewFrame("sheet", 1, "left", 0, 0)).toEqual({ scaleX: 1, scaleY: 1, x: 0 });
  });
});
