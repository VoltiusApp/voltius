import { afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { EditorView, runScopeHandlers } from "@codemirror/view";
import { startCompletion } from "@codemirror/autocomplete";

vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (k: string) => k }) }));
vi.mock("@iconify/react", () => ({ Icon: () => null }));
vi.mock("@/components/filetransfer/editor/useCmTheme", () => ({ useCmTheme: () => [] }));

const { NotesEditor } = await import("./NotesEditor");

beforeAll(() => {
  Range.prototype.getClientRects ??= () => [] as unknown as DOMRectList;
  Range.prototype.getBoundingClientRect ??= () => new DOMRect();
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

let setHarnessText: (text: string) => void = () => {};

function ModeHarness({ initial, value = "x" }: { initial: "edit" | "preview"; value?: string }) {
  const [mode, setMode] = useState(initial);
  const [text, setText] = useState(value);
  setHarnessText = setText;
  return <NotesEditor value={text} onChange={setText} mode={mode} onModeChange={setMode} />;
}

async function settle() {
  await act(async () => { await Promise.resolve(); });
}

function editorView(): EditorView {
  return EditorView.findFromDOM(document.querySelector(".cm-editor") as HTMLElement)!;
}

describe("NotesEditor with the real CodeMirror", () => {
  test.each([
    ["Mod-e", () => fireEvent.keyDown(document.querySelector("[data-notes-editor]")!, { key: "e", ctrlKey: true })],
    ["the edit toggle", () => fireEvent.click(screen.getByTitle(/notes.toolbar.edit/))],
  ])("switching from preview with %s focuses the editor once", async (_how, switchToEdit) => {
    const focus = vi.spyOn(EditorView.prototype, "focus");
    render(<ModeHarness initial="preview" />);
    await settle();
    act(() => { switchToEdit(); });
    await settle();
    expect(document.querySelector(".cm-editor")).toBeTruthy();
    expect(focus).toHaveBeenCalledTimes(1);
  });

  test.each(["edit", "preview"] as const)("mounting in %s never focuses the editor", async (initial) => {
    const focus = vi.spyOn(EditorView.prototype, "focus");
    render(<ModeHarness initial={initial} />);
    await settle();
    expect(focus).not.toHaveBeenCalled();
  });

  test("an empty editor shows the placeholder hint", async () => {
    render(<ModeHarness initial="edit" value="" />);
    await settle();
    expect(document.querySelector(".cm-placeholder")?.textContent).toBe("notes.editor.placeholder");
  });

  test("the slash menu renders outside the editor's clipping containers and goes away with it", async () => {
    render(<ModeHarness initial="edit" value="" />);
    await settle();
    const view = editorView();
    act(() => { view.dispatch({ changes: { from: 0, insert: "/" }, selection: { anchor: 1 } }); startCompletion(view); });
    const menu = await waitFor(() => {
      const el = document.querySelector(".cm-tooltip-autocomplete");
      expect(el).toBeTruthy();
      return el!;
    });
    expect(view.dom.contains(menu)).toBe(false);
    expect(document.body.contains(menu)).toBe(true);
    expect(menu.textContent).toContain("notes.slash.h1");
    expect(menu.textContent).not.toContain("/h1");
    cleanup();
    expect(document.querySelector(".cm-tooltip-autocomplete")).toBeNull();
  });

  test.each(["notes.toolbar.heading", "notes.toolbar.more"])("Escape with the %s menu open closes it and stays in edit", async (menu) => {
    render(<ModeHarness initial="edit" />);
    await settle();
    fireEvent.click(screen.getByTitle(menu));
    const row = menu === "notes.toolbar.heading" ? "notes.toolbar.h1" : "notes.toolbar.code";
    expect(screen.getByText(row)).toBeTruthy();
    act(() => { fireEvent.keyDown(editorView().contentDOM, { key: "Escape" }); });
    await settle();
    expect(screen.queryByText(row)).toBeNull();
    expect(document.querySelector(".cm-editor")).toBeTruthy();
    act(() => { fireEvent.keyDown(editorView().contentDOM, { key: "Escape" }); });
    await settle();
    expect(document.querySelector(".cm-editor")).toBeNull();
  });

  describe("switching to preview and back keeps the caret", () => {
    async function roundTrip(whileInPreview?: () => void) {
      act(() => { runScopeHandlers(editorView(), new KeyboardEvent("keydown", { key: "e", ctrlKey: true }), "editor"); });
      await settle();
      expect(document.querySelector(".cm-editor")).toBeNull();
      if (whileInPreview) act(whileInPreview);
      act(() => { fireEvent.keyDown(document.querySelector("[data-notes-editor]")!, { key: "e", ctrlKey: true }); });
      await settle();
      return editorView().state.selection.main;
    }

    test("restores the selection", async () => {
      render(<ModeHarness initial="edit" value={"first line\nsecond line"} />);
      await settle();
      act(() => { editorView().dispatch({ selection: { anchor: 13, head: 16 } }); });
      const selection = await roundTrip();
      expect([selection.anchor, selection.head]).toEqual([13, 16]);
    });

    test("clamps the selection to a document shortened in preview", async () => {
      render(<ModeHarness initial="edit" value={"first line\nsecond line"} />);
      await settle();
      act(() => { editorView().dispatch({ selection: { anchor: 20 } }); });
      const selection = await roundTrip(() => setHarnessText("short"));
      expect([selection.anchor, selection.head]).toEqual([5, 5]);
    });
  });

  test("Tab outside a list item is released; on a list item it indents", async () => {
    render(<ModeHarness initial="edit" value="plain" />);
    await settle();
    let view = editorView();
    expect(runScopeHandlers(view, new KeyboardEvent("keydown", { key: "Tab" }), "editor")).toBe(false);
    expect(view.state.doc.toString()).toBe("plain");
    cleanup();
    render(<ModeHarness initial="edit" value="- item" />);
    await settle();
    view = editorView();
    expect(runScopeHandlers(view, new KeyboardEvent("keydown", { key: "Tab" }), "editor")).toBe(true);
    expect(view.state.doc.toString()).toBe("  - item");
  });
});
