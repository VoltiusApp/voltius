import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { act, forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useState } from "react";
import { EditorState, type Extension } from "@codemirror/state";
import { keymap, type EditorView } from "@codemirror/view";

const h = vi.hoisted(() => ({ dispatched: [] as string[], extensions: [] as unknown[], focus: vi.fn(), android: false }));

vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (k: string) => k }) }));
vi.mock("@iconify/react", () => ({ Icon: () => null }));
vi.mock("@/utils/platform", () => ({ useIsAndroid: () => h.android }));
vi.mock("./NotesPreview", () => ({
  NotesPreview: ({ value, onRequestEdit }: { value: string; onRequestEdit?: () => void }) => (
    <div data-preview onDoubleClick={onRequestEdit}>{value}</div>
  ),
}));
vi.mock("@/components/filetransfer/editor/useCmTheme", () => ({ useCmTheme: () => [] }));
vi.mock("@uiw/react-codemirror", () => ({
  default: forwardRef(function FakeCm(
    { value, onChange, extensions, onCreateEditor }: {
      value: string; onChange: (v: string) => void; extensions: unknown[]; onCreateEditor?: (view: unknown) => void;
    },
    ref,
  ) {
    h.extensions = extensions;
    const [container, setContainer] = useState(false);
    useEffect(() => { setContainer(true); }, []);
    useLayoutEffect(() => { if (container) onCreateEditor?.({ focus: h.focus }); }, [container]);
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

afterEach(() => { cleanup(); h.dispatched = []; h.focus.mockClear(); h.android = false; });

function ModeHarness({ initial, value = "x" }: { initial: "edit" | "preview"; value?: string }) {
  const [mode, setMode] = useState(initial);
  return <NotesEditor value={value} onChange={() => {}} mode={mode} onModeChange={setMode} />;
}

function runEditorKey(key: string) {
  const state = EditorState.create({ extensions: h.extensions as Extension[] });
  const view = { state, dispatch: () => {} } as unknown as EditorView;
  const bindings = state.facet(keymap).flat().filter((b) => b.key === key && b.run);
  act(() => { bindings.some((b) => b.run!(view)); });
}

function previewSurface() {
  return document.querySelector("[data-notes-editor] [tabindex='0']");
}

function renderEditor(props: Partial<Parameters<typeof NotesEditor>[0]> = {}) {
  const onChange = vi.fn();
  const onModeChange = vi.fn();
  render(<NotesEditor value="" onChange={onChange} mode="edit" onModeChange={onModeChange} {...props} />);
  return { onChange, onModeChange };
}

describe("NotesEditor", () => {
  test("toolbar buttons run their markdown command", () => {
    const { onChange } = renderEditor({ value: "title" });
    fireEvent.mouseDown(screen.getByTitle(/notes.toolbar.bold/));
    expect(onChange).toHaveBeenLastCalledWith("****title");
  });

  test.each([
    ["notes.toolbar.heading", "notes.toolbar.h2", "Ctrl+Shift+2", "## title"],
    ["notes.toolbar.more", "notes.toolbar.codeBlock", null, "\n```\n\n```title"],
    ["notes.toolbar.more", "notes.toolbar.code", null, "``title"],
  ])("the %s menu runs %s without taking focus from the editor", (trigger, row, shortcut, expected) => {
    const { onChange } = renderEditor({ value: "title" });
    const button = screen.getByTitle(trigger);
    expect(fireEvent.mouseDown(button)).toBe(false);
    fireEvent.click(button);
    const item = screen.getByText(row).closest("button")!;
    if (shortcut) expect(item.textContent).toContain(shortcut);
    expect(fireEvent.mouseDown(item)).toBe(false);
    fireEvent.click(item);
    expect(onChange).toHaveBeenLastCalledWith(expected);
    expect(screen.queryByText(row)).toBeNull();
  });

  test("the toolbar keeps to one row: headings and code live in menus", () => {
    renderEditor({ value: "x" });
    const actions = screen.getByTitle(/notes.toolbar.bold/).parentElement!;
    expect(actions.parentElement!.className).not.toContain("flex-wrap");
    expect(actions.className).not.toContain("flex-wrap");
    expect(actions.querySelectorAll(":scope > button")).toHaveLength(8);
    expect(screen.queryByTitle(/notes.toolbar.h1/)).toBeNull();
    expect(screen.queryByTitle(/notes.toolbar.codeBlock/)).toBeNull();
  });

  test.each([false, true])("android=%s: only the formatting actions scroll; the mode toggle stays pinned outside", (android) => {
    h.android = android;
    renderEditor({ value: "x" });
    const actions = screen.getByTitle(/notes.toolbar.bold/).parentElement!;
    const toggle = screen.getByTitle(/notes.toolbar.preview/);
    expect(actions.className.split(" ")).toContain("overflow-x-auto");
    expect(actions.contains(toggle)).toBe(false);
    expect(toggle.parentElement).toBe(actions.parentElement);
    expect(toggle.className.split(" ")).toContain("shrink-0");
  });

  test.each([false, true])("android=%s: the toolbar's height-setting classes match in edit and preview", (android) => {
    h.android = android;
    const HEIGHT = /^(?:size-|h-|min-h-|w-6|p[ytb]?-|m[ytb]?-)/;
    const heightClasses = (mode: "edit" | "preview") => {
      renderEditor({ value: "x", mode });
      const toggle = screen.getByTitle(mode === "edit" ? /notes.toolbar.preview/ : /notes.toolbar.edit/);
      const root = toggle.parentElement!;
      const scroller = root.firstElementChild!;
      const pick = (el: Element) => el.className.split(" ").filter((c) => HEIGHT.test(c)).sort();
      const result = { root: pick(root), scroller: pick(scroller), toggle: pick(toggle) };
      cleanup();
      return result;
    };
    const edit = heightClasses("edit");
    expect(heightClasses("preview")).toEqual(edit);
    const block = (classes: string[], prefix: string) => classes.find((c) => c.startsWith(prefix))?.slice(prefix.length);
    expect(block(edit.toggle, "my-")).toBe(block(edit.scroller, "py-"));
  });

  test.each([
    [false, "w-6"],
    [true, "size-[36px]"],
  ])("android=%s sizes every toolbar button %s", (android, size) => {
    h.android = android;
    renderEditor({ value: "x" });
    const buttons = [
      ...screen.getByTitle(/notes.toolbar.bold/).parentElement!.querySelectorAll(":scope > button"),
      screen.getByTitle(/notes.toolbar.preview/),
    ];
    expect(buttons.every((b) => b.className.split(" ").includes(size))).toBe(true);
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

  test("in preview mode, an unhandled chord still reaches window listeners", () => {
    const listener = vi.fn();
    window.addEventListener("keydown", listener);
    renderEditor({ value: "x", mode: "preview" });
    fireEvent.keyDown(document.querySelector("[data-notes-editor]")!, { key: "N", ctrlKey: true, shiftKey: true });
    window.removeEventListener("keydown", listener);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  test("in preview mode, Mod-e is swallowed and switches to edit", () => {
    const listener = vi.fn();
    window.addEventListener("keydown", listener);
    const { onModeChange } = renderEditor({ value: "x", mode: "preview" });
    fireEvent.keyDown(document.querySelector("[data-notes-editor]")!, { key: "e", ctrlKey: true });
    window.removeEventListener("keydown", listener);
    expect(listener).not.toHaveBeenCalled();
    expect(onModeChange).toHaveBeenCalledWith("edit");
  });

  describe("focus follows mode switches made inside the editor", () => {
    test.each(["Escape", "Mod-e"])("%s in edit focuses the preview surface", (key) => {
      render(<ModeHarness initial="edit" />);
      runEditorKey(key);
      expect(document.querySelector("[data-cm]")).toBeNull();
      expect(previewSurface()).toBeTruthy();
      expect(document.activeElement).toBe(previewSurface());
    });

    test("the toolbar toggle to preview focuses the preview surface", () => {
      render(<ModeHarness initial="edit" />);
      fireEvent.click(screen.getByTitle(/notes.toolbar.preview/));
      expect(document.activeElement).toBe(previewSurface());
    });

    test("Mod-e in preview focuses the editor, and a second Mod-e returns to a focused preview", () => {
      render(<ModeHarness initial="preview" />);
      fireEvent.keyDown(document.querySelector("[data-notes-editor]")!, { key: "e", ctrlKey: true });
      expect(document.querySelector("[data-cm]")).toBeTruthy();
      expect(h.focus).toHaveBeenCalledTimes(1);
      runEditorKey("Mod-e");
      expect(document.activeElement).toBe(previewSurface());
    });

    test("the edit toggle, the empty-state action and double-click focus the editor", () => {
      render(<ModeHarness initial="preview" />);
      fireEvent.click(screen.getByTitle(/notes.toolbar.edit/));
      expect(h.focus).toHaveBeenCalledTimes(1);
      cleanup();
      render(<ModeHarness initial="preview" value="" />);
      fireEvent.click(screen.getByText("notes.empty.start"));
      expect(h.focus).toHaveBeenCalledTimes(2);
      cleanup();
      render(<ModeHarness initial="preview" />);
      fireEvent.doubleClick(document.querySelector("[data-preview]")!);
      expect(h.focus).toHaveBeenCalledTimes(3);
    });

    test("mounting never steals focus", () => {
      render(<ModeHarness initial="preview" />);
      expect(document.activeElement).toBe(document.body);
      cleanup();
      render(<ModeHarness initial="edit" />);
      expect(h.focus).not.toHaveBeenCalled();
    });
  });
});
