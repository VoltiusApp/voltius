// @vitest-environment jsdom
import { test, expect, afterEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { usePreviewStore } from "@/stores/previewStore";
import { startPreview, stopPreview } from "@/test/preview";
import { useViewAsExit } from "./useViewAsExit";

afterEach(() => {
  stopPreview();
  usePreviewStore.setState({ draft: null });
});

test("exit_without_draft_exits_at_once", () => {
  startPreview();
  const { result } = renderHook(() => useViewAsExit());
  act(() => result.current.requestExit());
  expect(usePreviewStore.getState().session).toBeNull();
  expect(result.current.confirming).toBe(false);
});

test("exit_with_draft_asks_first", () => {
  startPreview();
  usePreviewStore.setState({ draft: { permissions: 1 } });
  const { result } = renderHook(() => useViewAsExit());
  act(() => result.current.requestExit());
  expect(result.current.confirming).toBe(true);
  expect(usePreviewStore.getState().session).not.toBeNull();
  act(() => result.current.cancel());
  expect(result.current.confirming).toBe(false);
  expect(usePreviewStore.getState().session).not.toBeNull();
  act(() => result.current.requestExit());
  act(() => result.current.confirm());
  expect(usePreviewStore.getState().session).toBeNull();
});

test("after_exit_runs_only_after_a_voluntary_exit", () => {
  const afterExit = vi.fn(() => expect(usePreviewStore.getState().session).toBeNull());
  startPreview();
  const { result } = renderHook(() => useViewAsExit({ afterExit }));
  act(() => result.current.requestExit());
  expect(afterExit).toHaveBeenCalledOnce();

  startPreview();
  usePreviewStore.setState({ draft: { permissions: 1 } });
  act(() => result.current.requestExit());
  act(() => result.current.cancel());
  expect(afterExit).toHaveBeenCalledOnce();
  act(() => result.current.requestExit());
  act(() => result.current.confirm());
  expect(afterExit).toHaveBeenCalledTimes(2);

  startPreview();
  act(() => usePreviewStore.getState().exit());
  expect(afterExit).toHaveBeenCalledTimes(2);
});
