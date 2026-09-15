import { test, expect, afterEach } from "vitest";
import { render, cleanup, screen } from "@testing-library/react";
import { StatusDot } from "./StatusDot";

afterEach(() => cleanup());

function root(ui: React.ReactElement) {
  return render(ui).container.firstChild as HTMLElement;
}

test("sizes come from a two-step scale, not per-site pixels", () => {
  expect(root(<StatusDot tone="connected" />).className).toContain("size-2");
  expect(root(<StatusDot tone="connected" size="sm" />).className).toContain("size-1.5");
});

test("colour comes from the theme token for the tone", () => {
  const fill = root(<StatusDot tone="warning" />).lastElementChild as HTMLElement;
  expect(fill.getAttribute("style")).toContain("--t-status-warning");
});

test("a label names the dot; without one it stays out of the accessibility tree", () => {
  render(<StatusDot tone="error" label="Failed" />);
  const dot = screen.getByRole("img", { name: "Failed" });
  expect(dot.getAttribute("title")).toBe("Failed");
  expect(root(<StatusDot tone="error" />).getAttribute("aria-hidden")).toBe("true");
});

test("a halo cuts the dot out of the surface it overlaps", () => {
  const fill = root(<StatusDot tone="connected" halo="var(--t-bg-card)" corner />).lastElementChild as HTMLElement;
  expect(fill.style.boxShadow).toBe("0 0 0 2px var(--t-bg-card)");
});

test("ping draws a pulse ring behind the dot; pulse fades the dot itself", () => {
  const ping = root(<StatusDot tone="connected" motion="ping" />);
  expect(ping.children).toHaveLength(2);
  expect((ping.firstElementChild as HTMLElement).className).toContain("animate-ping-slow");
  const pulse = root(<StatusDot tone="accent" motion="pulse" />);
  expect(pulse.children).toHaveLength(1);
  expect(pulse.className).toContain("animate-pulse");
});
