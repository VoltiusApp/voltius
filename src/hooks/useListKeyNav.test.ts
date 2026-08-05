import { test, expect, vi, afterEach } from "vitest";
import { renderHook, cleanup } from "@testing-library/react";
import { createRef } from "react";
import { useListKeyNav } from "./useListKeyNav";

afterEach(() => cleanup());

test("a keydown whose target is not an Element still navigates", () => {
  const selectSingle = vi.fn();
  renderHook(() =>
    useListKeyNav({
      orderedIds: ["a", "b"],
      selectedIdSet: new Set<string>(),
      selectSingle,
      setSelection: vi.fn(),
      itemAreaRef: createRef<HTMLDivElement>(),
    }),
  );

  // document is a valid keydown target and has no .closest().
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));

  expect(selectSingle).toHaveBeenCalledWith("a");
});
