import { afterEach, expect, test } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useHardwareKeyboard } from "./platform";

afterEach(() => document.documentElement.removeAttribute("data-hw-keyboard"));

test("follows the data-hw-keyboard flag the native shell sets on <html>", async () => {
  const { result } = renderHook(() => useHardwareKeyboard());
  expect(result.current).toBe(false);
  await act(async () => { document.documentElement.setAttribute("data-hw-keyboard", ""); });
  expect(result.current).toBe(true);
  await act(async () => { document.documentElement.removeAttribute("data-hw-keyboard"); });
  expect(result.current).toBe(false);
});
