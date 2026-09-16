import { afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { EditorView, runScopeHandlers } from "@codemirror/view";

vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (k: string) => k }) }));
vi.mock("@iconify/react", () => ({ Icon: () => null }));
vi.mock("@/components/filetransfer/editor/useCmTheme", () => ({ useCmTheme: () => [] }));

const { NotesEditor } = await import("./NotesEditor");

beforeAll(() => {
  Range.prototype.getClientRects ??= () => [] as unknown as DOMRectList;
  Range.prototype.getBoundingClientRect ??= () => new DOMRect();
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

function ModeHarness({ initial, value = "x" }: { initial: "edit" | "preview"; value?: string }) {
  const [mode, setMode] = useState(initial);
  const [text, setText] = useState(value);
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
