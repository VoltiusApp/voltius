import { test, expect, beforeEach, afterEach } from "vitest";
import { renderHook, cleanup } from "@testing-library/react";
import { useKeyboard } from "./useKeyboard";
import { useUIStore } from "@/stores/uiStore";
import { useShortcutStore } from "@/stores/shortcutStore";

function press(key: string, target?: HTMLElement) {
  const e = new KeyboardEvent("keydown", { key, ctrlKey: true, bubbles: true, cancelable: true });
  (target ?? document.body).dispatchEvent(e);
}

let seen: string[];
const record = (e: Event) => seen.push(e.type);
const EVENTS = ["voltius:clipboard-copy", "voltius:clipboard-cut", "voltius:clipboard-paste"];

beforeEach(() => {
  seen = [];
  useShortcutStore.getState().resetAll();
  EVENTS.forEach((n) => window.addEventListener(n, record));
});
afterEach(() => {
  cleanup();
  EVENTS.forEach((n) => window.removeEventListener(n, record));
});

test("dispatches clipboard events on a vault tab", () => {
  useUIStore.setState({ activeNav: "hosts" });
  renderHook(() => useKeyboard());
  press("c"); press("x"); press("v");
  expect(seen).toEqual([
    "voltius:clipboard-copy",
    "voltius:clipboard-cut",
    "voltius:clipboard-paste",
  ]);
});

test("stays silent in the terminal so Ctrl+C remains SIGINT", () => {
  useUIStore.setState({ activeNav: "terminal" });
  renderHook(() => useKeyboard());
  press("c"); press("x"); press("v");
  expect(seen).toEqual([]);
});

test("stays silent while typing in an input", () => {
  useUIStore.setState({ activeNav: "hosts" });
  renderHook(() => useKeyboard());
  const input = document.createElement("input");
  document.body.appendChild(input);
  press("c", input);
  expect(seen).toEqual([]);
  input.remove();
});

test("does not hijack Ctrl+C when the user has selected text", () => {
  useUIStore.setState({ activeNav: "hosts" });
  renderHook(() => useKeyboard());
  const p = document.createElement("p");
  p.textContent = "root@10.0.0.1";
  document.body.appendChild(p);
  const range = document.createRange();
  range.selectNodeContents(p);
  const sel = window.getSelection()!;
  sel.removeAllRanges();
  sel.addRange(range);

  press("c");
  expect(seen).toEqual([]);

  // Cut and paste are unaffected — only copy competes with a text selection.
  press("v");
  expect(seen).toEqual(["voltius:clipboard-paste"]);

  sel.removeAllRanges();
  p.remove();
});
