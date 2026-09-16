import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup, fireEvent } from "@testing-library/react";
import { fadeMask, useTabStripScroll, wheelToHorizontal } from "./useTabStripScroll";

afterEach(cleanup);

describe("wheelToHorizontal", () => {
  it("turns a vertical mouse wheel into horizontal travel", () => {
    expect(wheelToHorizontal({ deltaX: 0, deltaY: 100, deltaMode: 0 }, 500)).toBe(100);
    expect(wheelToHorizontal({ deltaX: 0, deltaY: -3, deltaMode: 1 }, 500)).toBe(-48);
    expect(wheelToHorizontal({ deltaX: 0, deltaY: 1, deltaMode: 2 }, 500)).toBe(500);
  });

  it("leaves horizontal-dominant touchpad gestures to the browser", () => {
    expect(wheelToHorizontal({ deltaX: 40, deltaY: 5, deltaMode: 0 }, 500)).toBe(0);
  });
});

describe("fadeMask", () => {
  it("fades only the edges that hide tabs", () => {
    expect(fadeMask({ start: false, end: false })).toBeUndefined();
    expect(fadeMask({ start: false, end: true })?.maskImage).toMatch(/^linear-gradient\(to right, black 0.*transparent 100%\)$/);
    expect(fadeMask({ start: true, end: false })?.maskImage).toMatch(/^linear-gradient\(to right, transparent 0.*black 100%\)$/);
  });
});

function Strip({ activeKey }: { activeKey: string }) {
  const { ref } = useTabStripScroll(activeKey);
  return <div ref={ref} data-testid="strip" />;
}

function overflowing(el: HTMLElement, clientWidth: number, scrollWidth: number) {
  Object.defineProperty(el, "clientWidth", { configurable: true, value: clientWidth });
  Object.defineProperty(el, "scrollWidth", { configurable: true, value: scrollWidth });
}

describe("useTabStripScroll wheel", () => {
  it("scrolls an overflowing strip sideways and swallows the wheel", () => {
    const { getByTestId } = render(<Strip activeKey="a" />);
    const strip = getByTestId("strip");
    overflowing(strip, 200, 800);
    const notCancelled = fireEvent.wheel(strip, { deltaY: 120 });
    expect(strip.scrollLeft).toBe(120);
    expect(notCancelled).toBe(false);
  });

  it("lets the wheel through when every tab already fits", () => {
    const { getByTestId } = render(<Strip activeKey="a" />);
    const strip = getByTestId("strip");
    overflowing(strip, 800, 800);
    expect(fireEvent.wheel(strip, { deltaY: 120 })).toBe(true);
    expect(strip.scrollLeft).toBe(0);
  });
});
