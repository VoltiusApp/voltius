import { test, expect, afterEach } from "vitest";
import { render, act, cleanup } from "@testing-library/react";
import { ClipboardPill } from "./ClipboardPill";
import { escapeIsFree } from "./FloatingPill";
import { useVaultClipboardStore } from "@/stores/vaultClipboardStore";

afterEach(() => { cleanup(); useVaultClipboardStore.getState().clear(); });

const escape = (init: KeyboardEventInit = {}) => new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true, ...init });

test("clipboard_pill_still_clears_on_free_escape_and_not_under_a_dialog", async () => {
  render(<ClipboardPill navItem="hosts" />);
  const load = () => act(() => {
    useVaultClipboardStore.getState().setClipboard({
      tab: "hosts", mode: "cut", items: [{ id: "c", kind: "connection" }], folderIds: [], sourceVaultIds: ["personal"],
    });
  });
  const press = () => act(async () => { window.dispatchEvent(escape()); });

  load();
  const dialog = document.createElement("div");
  dialog.setAttribute("role", "dialog");
  document.body.appendChild(dialog);
  expect(escapeIsFree(escape())).toBe(false);
  await press();
  expect(useVaultClipboardStore.getState().clipboard).not.toBeNull();

  dialog.remove();
  expect(escapeIsFree(escape())).toBe(true);
  await press();
  expect(useVaultClipboardStore.getState().clipboard).toBeNull();
});
