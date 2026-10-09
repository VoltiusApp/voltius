// @vitest-environment jsdom
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { act, cleanup, fireEvent, render, renderHook } from "@testing-library/react";
import { useInlineRename, requestRename } from "./useInlineRename";
import { useShortcutStore } from "@/stores/shortcutStore";
import { useUIStore } from "@/stores/uiStore";
import { useKeyboard } from "./useKeyboard";
import { usePageBulkActions } from "./usePageBulkActions";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));

function Name({ id, enabled = true, name = "web", onRename = vi.fn() }: { id: string; enabled?: boolean; name?: string; onRename?: (n: string) => void }) {
  const rename = useInlineRename(id, enabled, name, onRename);
  return <span data-testid={id}>{rename.editor ?? name}</span>;
}

beforeEach(() => {
  useShortcutStore.getState().resetAll();
  useUIStore.setState({ activeNav: "hosts", sftpPanelOpen: false });
});
afterEach(cleanup);

test("a rename request opens the editor only on the requested item", () => {
  const { container } = render(<><Name id="a" /><Name id="b" /></>);
  act(() => requestRename("b"));
  const inputs = container.querySelectorAll("input");
  expect(inputs).toHaveLength(1);
  expect(inputs[0].closest("[data-testid]")?.getAttribute("data-testid")).toBe("b");
});

test("an item the user cannot edit ignores the request", () => {
  const { container } = render(<Name id="a" enabled={false} />);
  act(() => requestRename("a"));
  expect(container.querySelector("input")).toBeNull();
});

test("commits a trimmed new name and drops an unchanged or empty one", () => {
  const onRename = vi.fn();
  const { container } = render(<Name id="a" onRename={onRename} />);
  for (const value of ["  web  ", "   ", "  db  "]) {
    act(() => requestRename("a"));
    const input = container.querySelector("input")!;
    fireEvent.change(input, { target: { value } });
    fireEvent.keyDown(input, { key: "Enter" });
  }
  expect(onRename.mock.calls).toEqual([["db"]]);
});

test("the menu item shows the rename shortcut and is absent without permission", () => {
  const editable = renderHook(() => useInlineRename("a", true, "web", vi.fn()));
  expect(editable.result.current.menuItems).toEqual([expect.objectContaining({ label: "common.action.rename", shortcut: "F2" })]);
  const readOnly = renderHook(() => useInlineRename("a", false, "web", vi.fn()));
  expect(readOnly.result.current.menuItems).toEqual([]);
});

function mountPage(selected: string[]) {
  renderHook(() => {
    useKeyboard();
    usePageBulkActions({ navItem: "hosts", filteredIds: selected, selectedIdSet: new Set(selected), setSelection: () => {} });
  });
}
const pressF2 = (target: HTMLElement = document.body) =>
  act(() => { target.dispatchEvent(new KeyboardEvent("keydown", { key: "F2", bubbles: true, cancelable: true })); });

test("F2 renames the single selected item on the active page", () => {
  const { container } = render(<Name id="a" />);
  mountPage(["a"]);
  pressF2();
  expect(container.querySelector("input")).not.toBeNull();
});

test.each([
  ["several items are selected", () => mountPage(["a", "b"])],
  ["the SFTP panel covers the page", () => { useUIStore.setState({ sftpPanelOpen: true }); mountPage(["a"]); }],
  ["another page is active", () => { useUIStore.setState({ activeNav: "keychain" }); mountPage(["a"]); }],
])("F2 does nothing when %s", (_, setup) => {
  const { container } = render(<Name id="a" />);
  setup();
  pressF2();
  expect(container.querySelector("input")).toBeNull();
});

test("F2 typed into a field stays with the field", () => {
  const { container } = render(<Name id="a" />);
  mountPage(["a"]);
  const field = document.createElement("textarea");
  document.body.appendChild(field);
  pressF2(field);
  expect(container.querySelector("input")).toBeNull();
  field.remove();
});

test("a remapped shortcut replaces F2", () => {
  useShortcutStore.getState().setKey("rename", "r", true, true, false);
  const { container } = render(<Name id="a" />);
  mountPage(["a"]);
  pressF2();
  expect(container.querySelector("input")).toBeNull();
  act(() => { document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "R", ctrlKey: true, shiftKey: true, bubbles: true })); });
  expect(container.querySelector("input")).not.toBeNull();
});
