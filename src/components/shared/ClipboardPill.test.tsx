import { test, expect, beforeEach, beforeAll, afterEach } from "vitest";
import { render, screen, act, cleanup } from "@testing-library/react";
import { ClipboardPill } from "./ClipboardPill";
import { useVaultClipboardStore } from "@/stores/vaultClipboardStore";
import i18n from "@/i18n";

// vitest.config.ts sets no `globals: true`, so testing-library's automatic
// cleanup never registers; unmount explicitly between tests.
afterEach(() => cleanup());

beforeAll(async () => { await i18n.changeLanguage("en"); });

beforeEach(() => useVaultClipboardStore.getState().clear());

function load(mode: "cut" | "copy", count = 1) {
  act(() => {
    useVaultClipboardStore.getState().setClipboard({
      tab: "hosts", mode,
      items: Array.from({ length: count }, (_, i) => ({ id: `c${i}`, kind: "connection" as const })),
      folderIds: [], sourceVaultIds: ["personal"],
    });
  });
}

// NOTE: @testing-library/jest-dom is NOT installed in this repo and there is no
// vitest setupFiles. Assert on .textContent / firstChild, as the existing
// component tests do (see src/components/hosts/TeamSessions.test.tsx).

test("renders nothing with an empty clipboard", () => {
  const { container } = render(<ClipboardPill navItem="hosts" />);
  expect(container.firstChild).toBeNull();
});

test("shows the cut count and the move hint", () => {
  render(<ClipboardPill navItem="hosts" />);
  load("cut", 3);
  const text = screen.getByTestId("clipboard-pill").textContent ?? "";
  expect(text).toContain("3 items cut");
  expect(text).toContain("to move");
});

test("shows the copied count and the paste hint", () => {
  render(<ClipboardPill navItem="hosts" />);
  load("copy", 1);
  const text = screen.getByTestId("clipboard-pill").textContent ?? "";
  expect(text).toContain("1 item copied");
  expect(text).toContain("to paste");
});

test("renders nothing on a tab that does not own the clipboard", () => {
  const { container } = render(<ClipboardPill navItem="snippets" />);
  load("cut");
  expect(container.firstChild).toBeNull();
});

test("the clear button empties the clipboard", async () => {
  render(<ClipboardPill navItem="hosts" />);
  load("cut");
  await act(async () => { screen.getByTestId("clipboard-pill-clear").click(); });
  expect(useVaultClipboardStore.getState().clipboard).toBeNull();
});

const pressEscape = async (target: EventTarget = window, init: KeyboardEventInit = {}) => {
  await act(async () => {
    target.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, ...init }));
  });
};

test("Escape on the page empties the clipboard", async () => {
  render(<ClipboardPill navItem="hosts" />);
  load("cut");
  await pressEscape();
  expect(useVaultClipboardStore.getState().clipboard).toBeNull();
});

// Escape is the app's universal "cancel that" key. Cancelling a rename, a search
// or a modal must not also cost the user their clipboard.
test("Escape while typing in a field leaves the clipboard alone", async () => {
  render(<ClipboardPill navItem="hosts" />);
  load("cut");
  const input = document.createElement("input");
  document.body.appendChild(input);
  await pressEscape(input);
  expect(useVaultClipboardStore.getState().clipboard).not.toBeNull();
  input.remove();
});

test("Escape already handled by something nearer leaves the clipboard alone", async () => {
  render(<ClipboardPill navItem="hosts" />);
  load("cut");
  await act(async () => {
    const e = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    e.preventDefault();
    window.dispatchEvent(e);
  });
  expect(useVaultClipboardStore.getState().clipboard).not.toBeNull();
});

test("Escape with a dialog on screen leaves the clipboard alone", async () => {
  render(<ClipboardPill navItem="hosts" />);
  load("cut");
  const dialog = document.createElement("div");
  dialog.setAttribute("role", "dialog");
  document.body.appendChild(dialog);
  await pressEscape();
  expect(useVaultClipboardStore.getState().clipboard).not.toBeNull();
  dialog.remove();
});
