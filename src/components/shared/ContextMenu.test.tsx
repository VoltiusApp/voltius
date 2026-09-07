import { useState } from "react";
import { test, expect, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { ContextMenu, useContextMenu } from "./ContextMenu";

// vitest.config.ts sets no `globals: true`, so testing-library's automatic
// cleanup never registers; unmount explicitly between tests.
afterEach(() => cleanup());

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
