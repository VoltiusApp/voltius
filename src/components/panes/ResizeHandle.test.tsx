import { it, expect, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { createRef } from "react";
import { useLayoutStore, type SplitNode } from "@/stores/layoutStore";
import { ResizeHandle } from "./ResizeHandle";

afterEach(() => {
  cleanup();
  useLayoutStore.setState({ root: null });
});

it("double-clicking the handle moves it back to the middle", () => {
  const root: SplitNode = {
    type: "split",
    id: "split",
    direction: "h",
    ratio: 0.8,
    first: { type: "leaf", id: "a", sessionId: "a" },
    second: { type: "leaf", id: "b", sessionId: "b" },
  };
  useLayoutStore.setState({ root });

  render(<ResizeHandle splitNodeId="split" direction="h" containerRef={createRef()} />);
  fireEvent.doubleClick(screen.getByRole("separator"));

  expect((useLayoutStore.getState().root as SplitNode).ratio).toBe(0.5);
});
