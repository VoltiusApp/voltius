import { describe, expect, it } from "vitest";
import { avoidLift, dockedInset, snackbarDuration, swipeAction, swipeOpacity } from "./snackbarCore";

describe("snackbarDuration", () => {
  it("clamps to 4–10 s, 6 s minimum with an action", () => {
    expect(snackbarDuration(2000, false)).toBe(4000);
    expect(snackbarDuration(2000, true)).toBe(6000);
    expect(snackbarDuration(8000, false)).toBe(8000);
    expect(snackbarDuration(30000, true)).toBe(10000);
  });
  it("keeps sticky toasts sticky", () => {
    expect(snackbarDuration(0, false)).toBe(0);
    expect(snackbarDuration(-1, true)).toBe(0);
  });
});

describe("swipeAction", () => {
  it("dismisses past 35 % of the width either way", () => {
    expect(swipeAction(150, 0, 400)).toBe("dismiss");
    expect(swipeAction(-150, 0, 400)).toBe("dismiss");
    expect(swipeAction(100, 0, 400)).toBe("settle");
  });
  it("dismisses on a fling in the drag direction only", () => {
    expect(swipeAction(30, 0.8, 400)).toBe("dismiss");
    expect(swipeAction(-30, -0.8, 400)).toBe("dismiss");
    expect(swipeAction(30, -0.8, 400)).toBe("settle");
    expect(swipeAction(0, 0.8, 400)).toBe("settle");
  });
});

describe("swipeOpacity", () => {
  it("fades with the drag, never fully", () => {
    expect(swipeOpacity(0, 400)).toBe(1);
    expect(swipeOpacity(200, 400)).toBe(0.5);
    expect(swipeOpacity(-800, 400)).toBe(0.2);
    expect(swipeOpacity(50, 0)).toBe(1);
  });
});

describe("dockedInset", () => {
  const vh = 900;
  it("is null when nothing touches the bottom edge", () => {
    expect(dockedInset([], vh)).toBeNull();
    expect(dockedInset([{ top: 100, bottom: 200, height: 100 }], vh)).toBeNull();
    expect(dockedInset([{ top: 900, bottom: 900, height: 0 }], vh)).toBeNull();
  });
  it("measures from the highest docked element", () => {
    const navBar = { top: 796, bottom: 900, height: 104 };
    const cards = { top: 700, bottom: 900, height: 200 };
    expect(dockedInset([navBar], vh)).toBe(104);
    expect(dockedInset([navBar, cards], vh)).toBe(200);
  });
  it("docked_inset_stacks_contiguous_bars", () => {
    const tabBar = { top: 820, bottom: 900, height: 80 };
    const draftBar = { top: 764, bottom: 820, height: 56 };
    const lone = { top: 700, bottom: 750, height: 50 };
    expect(dockedInset([draftBar, tabBar], vh)).toBe(136);
    expect(dockedInset([lone, draftBar, tabBar], vh)).toBe(136);
    expect(dockedInset([lone, draftBar], vh)).toBeNull();
  });
});

describe("avoidLift", () => {
  it("raises a FAB overlapping the snackbar to sit gap px above it", () => {
    // FAB bottom at 800, snackbar top at 760, 8 px gap -> rise 48.
    expect(avoidLift(800, 760, 8)).toBe(48);
  });
  it("leaves an element that already clears the snackbar", () => {
    expect(avoidLift(700, 760, 8)).toBe(0);
    expect(avoidLift(752, 760, 8)).toBe(0);
  });
});
