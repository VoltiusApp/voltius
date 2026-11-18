// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { useSyncedFormKey } from "./useSyncedFormKey";

describe("useSyncedFormKey", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("bumps when updated_at changes and nothing is focused or dirty", () => {
    const { result, rerender } = renderHook(({ at }) => useSyncedFormKey(at, true, () => false), {
      initialProps: { at: "1" },
    });
    rerender({ at: "2" });
    expect(result.current).toBe(1);
  });

  it("does not bump while the user has local edits", () => {
    const { result, rerender } = renderHook(({ at }) => useSyncedFormKey(at, true, () => true), {
      initialProps: { at: "1" },
    });
    rerender({ at: "2" });
    expect(result.current).toBe(0);
  });

  it("does not bump while an input has focus, so a click is not lost", () => {
    const input = document.createElement("input");
    document.body.appendChild(input);
    input.focus();
    const { result, rerender } = renderHook(({ at }) => useSyncedFormKey(at, true, () => false), {
      initialProps: { at: "1" },
    });
    rerender({ at: "2" });
    expect(result.current).toBe(0);
  });
});
