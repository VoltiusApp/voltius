import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { forwardRef, useImperativeHandle } from "react";
import { EditorState } from "@codemirror/state";

const h = vi.hoisted(() => ({ dispatched: [] as string[] }));

vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (k: string) => k }) }));
vi.mock("@iconify/react", () => ({ Icon: () => null }));
vi.mock("./NotesPreview", () => ({
  NotesPreview: ({ value, onRequestEdit }: { value: string; onRequestEdit?: () => void }) => (
    <div data-preview onDoubleClick={onRequestEdit}>{value}</div>
  ),
}));
vi.mock("@/components/filetransfer/editor/useCmTheme", () => ({ useCmTheme: () => [] }));
vi.mock("@uiw/react-codemirror", () => ({
  default: forwardRef(function FakeCm(
    { value, onChange }: { value: string; onChange: (v: string) => void },
    ref,
  ) {
    useImperativeHandle(ref, () => {
      let state = EditorState.create({ doc: value });
      return {
        view: {
          get state() { return state; },
          dispatch: (tr: { state: EditorState }) => { state = tr.state; h.dispatched.push(state.doc.toString()); onChange(state.doc.toString()); },
          focus: () => {},
        },
      };
    }, [value, onChange]);
    return <textarea data-cm value={value} onChange={(e) => onChange(e.target.value)} />;
  }),
}));

const { NotesEditor } = await import("./NotesEditor");

afterEach(() => { cleanup(); h.dispatched = []; });

function renderEditor(props: Partial<Parameters<typeof NotesEditor>[0]> = {}) {
  const onChange = vi.fn();
  const onModeChange = vi.fn();
  render(<NotesEditor value="" onChange={onChange} mode="edit" onModeChange={onModeChange} {...props} />);
  return { onChange, onModeChange };
}

describe("NotesEditor", () => {
  test("toolbar buttons run their markdown command", () => {
    const { onChange } = renderEditor({ value: "title" });
    fireEvent.mouseDown(screen.getByTitle(/notes.toolbar.h1/));
    expect(onChange).toHaveBeenLastCalledWith("# title");
  });

  test("the mode toggle switches to preview and back", () => {
    const edit = renderEditor({ value: "x" });
    fireEvent.click(screen.getByTitle(/notes.toolbar.preview/));
    expect(edit.onModeChange).toHaveBeenCalledWith("preview");
    cleanup();
    const preview = renderEditor({ value: "x", mode: "preview" });
    fireEvent.click(screen.getByTitle(/notes.toolbar.edit/));
    expect(preview.onModeChange).toHaveBeenCalledWith("edit");
  });

  test("Mod-e in preview switches to edit", () => {
    const { onModeChange } = renderEditor({ value: "x", mode: "preview" });
    fireEvent.keyDown(document.querySelector("[data-notes-editor]")!, { key: "e", ctrlKey: true });
    expect(onModeChange).toHaveBeenCalledWith("edit");
  });

  test("empty preview shows the empty state; its action starts editing", () => {
    const { onModeChange } = renderEditor({ value: "  ", mode: "preview" });
    expect(screen.getByText("notes.empty.title")).toBeTruthy();
    fireEvent.click(screen.getByText("notes.empty.start"));
    expect(onModeChange).toHaveBeenCalledWith("edit");
  });

  test("read-only hides the toolbar, the empty action, and never shows the editor", () => {
    renderEditor({ value: "", mode: "edit", readOnly: true });
    expect(screen.queryByTitle(/notes.toolbar.bold/)).toBeNull();
    expect(screen.queryByText("notes.empty.start")).toBeNull();
    expect(document.querySelector("[data-cm]")).toBeNull();
  });

  test("keydown inside the editor does not reach window listeners", () => {
    const listener = vi.fn();
    window.addEventListener("keydown", listener);
    renderEditor({ value: "x" });
    fireEvent.keyDown(document.querySelector("[data-cm]")!, { key: "b", ctrlKey: true });
    window.removeEventListener("keydown", listener);
    expect(listener).not.toHaveBeenCalled();
  });
});
