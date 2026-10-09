// @vitest-environment jsdom
import { test, expect, vi, afterEach } from "vitest";
import { renderHook, cleanup } from "@testing-library/react";
import { createRef } from "react";
import { useListKeyNav } from "./useListKeyNav";
import { useUIStore } from "@/stores/uiStore";

afterEach(() => {
  cleanup();
  useUIStore.setState({ sftpPanelOpen: false });
});

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

test("keys meant for the SFTP panel do not drive the page behind it", () => {
  const selectSingle = vi.fn();
  const onEnter = vi.fn();
  renderHook(() =>
    useListKeyNav({
      orderedIds: ["a", "b"],
      selectedIdSet: new Set(["a"]),
      selectSingle,
      setSelection: vi.fn(),
      itemAreaRef: createRef<HTMLDivElement>(),
      onEnter,
    }),
  );
  useUIStore.setState({ sftpPanelOpen: true });

  for (const key of ["ArrowDown", "Enter"]) document.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));

  expect(selectSingle).not.toHaveBeenCalled();
  expect(onEnter).not.toHaveBeenCalled();
});
