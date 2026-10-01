import { useState } from "react";
import { test, expect, afterEach, vi } from "vitest";
import { act } from "react";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { ContextMenu, fitWithin, useContextMenu } from "./ContextMenu";

// vitest.config.ts sets no `globals: true`, so testing-library's automatic
// cleanup never registers; unmount explicitly between tests.
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const clicked: string[] = [];

function TwoTargets() {
  const { pos, open, close } = useContextMenu();
  const [target, setTarget] = useState("");
  return (
    <>
      <button onContextMenu={(e) => { setTarget("a"); open(e); }}>target-a</button>
      <button onContextMenu={(e) => { setTarget("b"); open(e); }}>target-b</button>
      <button>outsider</button>
      {pos && (
        <ContextMenu
          items={[{ label: `item-${target}`, onClick: () => clicked.push(target) }]}
          pos={pos}
          onClose={close}
        />
      )}
    </>
  );
}

// The swallowed-right-click bug itself is a hit-testing one (the old backdrop
// covered the page), and jsdom's fireEvent dispatches straight to the node, so
// only the live app can prove that half. What is checked here is the close
// semantics the fix relies on: an open menu retargets instead of going stale.
test("right-clicking another target while a menu is open retargets the menu", () => {
  render(<TwoTargets />);

  fireEvent.contextMenu(screen.getByText("target-a"));
  expect(screen.getByText("item-a")).toBeTruthy();

  fireEvent.contextMenu(screen.getByText("target-b"));
  expect(screen.getByText("item-b")).toBeTruthy();
  expect(screen.queryByText("item-a")).toBeNull();
});

test("a press outside closes the menu, and one inside still runs the entry", () => {
  render(<TwoTargets />);

  fireEvent.contextMenu(screen.getByText("target-a"));
  fireEvent.mouseDown(screen.getByText("outsider"));
  expect(screen.queryByText("item-a")).toBeNull();

  fireEvent.contextMenu(screen.getByText("target-a"));
  const entry = screen.getByText("item-a");
  fireEvent.mouseDown(entry);
  expect(screen.queryByText("item-a")).toBeTruthy();
  fireEvent.click(entry);
  expect(clicked).toEqual(["a"]);
  expect(screen.queryByText("item-a")).toBeNull();
});

test.each([
  ["a menu that fits keeps its position", 100, 190, 100],
  ["a menu near the left edge stays put", 2, 190, 2],
  ["a menu past the right edge moves back inside", 1180, 190, 1082],
  ["a menu wider than the window pins to the margin", 1180, 1400, 8],
])("%s", (_label, start, size, expected) => {
  expect(fitWithin(start, size, 1280)).toBe(expected);
});

test("a root menu opened near the right edge renders inside the window", () => {
  const width = window.innerWidth;
  window.innerWidth = 1280;
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ width: 190, height: 120 } as DOMRect);
  try {
    render(<ContextMenu items={[{ label: "Change", onClick: () => {} }]} pos={{ x: 1180, y: 40 }} onClose={() => {}} />);
    const menu = screen.getByText("Change").closest("[data-menu-portal]") as HTMLElement;
    expect(menu.style.left).toBe("1082px");
  } finally {
    vi.restoreAllMocks();
    window.innerWidth = width;
  }
});

test("labels and hints never wrap, so the measured width is the final width", () => {
  render(<ContextMenu items={[{ label: "A long label", hint: "a hint", onClick: () => {} }]} pos={{ x: 0, y: 0 }} onClose={() => {}} />);
  expect(screen.getByText("A long label").className).toContain("whitespace-nowrap");
  expect(screen.getByText("a hint").className).toContain("whitespace-nowrap");
});

test("a root menu is re-clamped when it grows after the first measurement", () => {
  const width = window.innerWidth;
  window.innerWidth = 1280;
  let menuWidth = 208;
  const observers: Array<() => void> = [];
  vi.stubGlobal("ResizeObserver", class {
    constructor(cb: () => void) { observers.push(cb); }
    observe() {}
    disconnect() {}
  });
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(() => ({ width: menuWidth, height: 120 }) as DOMRect);
  try {
    render(<ContextMenu items={[{ label: "Change", onClick: () => {} }]} pos={{ x: 1100, y: 40 }} onClose={() => {}} />);
    const menu = screen.getByText("Change").closest("[data-menu-portal]") as HTMLElement;
    expect(menu.style.left).toBe("1064px");
    menuWidth = 224;
    act(() => observers.forEach((cb) => cb()));
    expect(menu.style.left).toBe("1048px");
  } finally {
    window.innerWidth = width;
  }
});

test("a submenu opened low in the window is shifted up to stay inside it", () => {
  const height = window.innerHeight;
  window.innerHeight = 600;
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    return (this.hasAttribute("data-menu-portal") ? { width: 200, height: 300 } : { left: 0, right: 200, top: 560, bottom: 590, width: 200, height: 30 }) as DOMRect;
  });
  try {
    render(<ContextMenu items={[{ label: "Parent", children: [{ label: "Child", onClick: () => {} }] }]} pos={{ x: 0, y: 10 }} onClose={() => {}} />);
    fireEvent.mouseEnter(screen.getByText("Parent").closest("button") as HTMLElement);
    const sub = screen.getByText("Child").closest("[data-menu-portal]") as HTMLElement;
    expect(sub.style.top).toBe("292px");
  } finally {
    window.innerHeight = height;
  }
});
