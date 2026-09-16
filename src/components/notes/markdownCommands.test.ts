import { beforeAll, describe, expect, test } from "vitest";
import { EditorSelection, EditorState, type StateCommand } from "@codemirror/state";
import { CompletionContext, type Completion, type CompletionResult } from "@codemirror/autocomplete";
import { EditorView } from "@codemirror/view";
import { history, undo } from "@codemirror/commands";
import {
  BLOCKS,
  SLASH_ITEMS,
  insertBlock,
  insertLink,
  notesKeymap,
  slashCompletionSource,
  toggleLineKind,
  toggleTaskAtCursor,
  wrapSelection,
} from "./markdownCommands";

function run(doc: string, from: number, to: number, command: StateCommand) {
  let state = EditorState.create({ doc, selection: EditorSelection.single(from, to) });
  const ok = command({ state, dispatch: (tr) => { state = tr.state; } });
  const sel = state.selection.main;
  return { ok, doc: state.doc.toString(), selected: state.sliceDoc(sel.from, sel.to), head: sel.head };
}

describe("wrapSelection", () => {
  test("wraps and keeps the word selected", () => {
    expect(run("say hi", 4, 6, wrapSelection("**"))).toMatchObject({ doc: "say **hi**", selected: "hi" });
  });
  test("unwraps when already wrapped", () => {
    expect(run("say **hi**", 6, 8, wrapSelection("**"))).toMatchObject({ doc: "say hi", selected: "hi" });
  });
  test("empty selection puts the cursor between markers", () => {
    expect(run("x", 1, 1, wrapSelection("*"))).toMatchObject({ doc: "x**", head: 2 });
  });
});

describe("toggleLineKind", () => {
  test("adds a heading and replaces another heading level", () => {
    expect(run("title", 0, 0, toggleLineKind("h2")).doc).toBe("## title");
    expect(run("# title", 0, 0, toggleLineKind("h2")).doc).toBe("## title");
  });
  test("removes the prefix when every selected line already has it", () => {
    expect(run("- a\n- b", 0, 7, toggleLineKind("bullet")).doc).toBe("a\nb");
  });
  test("numbers ordered lines across a multi-line selection, keeping indentation", () => {
    expect(run("a\n  b\nc", 0, 7, toggleLineKind("ordered")).doc).toBe("1. a\n  2. b\n3. c");
  });
  test("converts a bullet into a task", () => {
    expect(run("- a", 0, 0, toggleLineKind("task")).doc).toBe("- [ ] a");
  });
});

describe("toggleTaskAtCursor", () => {
  test("toggles the task on the cursor line", () => {
    expect(run("x\n- [ ] do", 5, 5, toggleTaskAtCursor)).toMatchObject({ ok: true, doc: "x\n- [x] do" });
  });
  test("returns false on a non-task line so Mod-Enter falls through", () => {
    expect(run("plain", 0, 0, toggleTaskAtCursor)).toMatchObject({ ok: false, doc: "plain" });
  });
});

describe("insertLink", () => {
  test("wraps the selection and selects the url placeholder", () => {
    expect(run("see docs", 4, 8, insertLink)).toMatchObject({ doc: "see [docs](url)", selected: "url" });
  });
});

describe("insertBlock", () => {
  test("inserts a code block on a new line and places the cursor inside", () => {
    const [text, offset] = BLOCKS.codeBlock;
    const r = run("abc", 3, 3, insertBlock(text, offset));
    expect(r.doc).toBe("abc\n```\n\n```");
    expect(r.head).toBe(8);
  });
  test("places the cursor inside the first table body cell", () => {
    const [text, offset] = BLOCKS.table;
    const r = run("", 0, 0, insertBlock(text, offset));
    expect(r.doc.slice(r.head - 2, r.head + 2)).toBe("|  |");
  });
  test("inserts at the cursor when the line is empty", () => {
    const [text, offset] = BLOCKS.divider;
    expect(run("", 0, 0, insertBlock(text, offset)).doc).toBe("---\n");
  });
});

describe("slashCompletionSource", () => {
  beforeAll(() => {
    Range.prototype.getClientRects ??= () => [] as unknown as DOMRectList;
    Range.prototype.getBoundingClientRect ??= () => new DOMRect();
  });
  const source = slashCompletionSource(SLASH_ITEMS, (k) => k);
  function complete(doc: string) {
    const state = EditorState.create({ doc, selection: EditorSelection.cursor(doc.length) });
    return source(new CompletionContext(state, doc.length, false));
  }
  test("opens at line start and after whitespace", () => {
    expect(complete("/")).toMatchObject({ from: 0 });
    expect(complete("text /ta")).toMatchObject({ from: 5 });
  });
  test("does not open inside a word or a path", () => {
    expect(complete("a/b")).toBeNull();
    expect(complete("cd /etc/ho")).toBeNull();
  });
  test.each([["/h1", "# ", 2], ["text /h1", "# text ", 7], ["/code", "```\n\n```", 4]] as const)("applying a command on %j undoes in one step", (doc, applied, head) => {
    const view = new EditorView({
      state: EditorState.create({ doc, selection: EditorSelection.cursor(doc.length), extensions: [history()] }),
      parent: document.body,
    });
    const result = complete(doc) as CompletionResult;
    const id = doc.slice(result.from + 1);
    const option = result.options.find((o) => o.label === `/${id}`)! as Completion & { apply: (...a: unknown[]) => void };
    option.apply(view, option, result.from, doc.length);
    expect(view.state.doc.toString()).toBe(applied);
    expect(view.state.selection.main.head).toBe(head);
    expect(undo(view)).toBe(true);
    expect(view.state.doc.toString()).toBe(doc);
    view.destroy();
  });
  test("offers every slash item", () => {
    const result = complete("/") as unknown as { options: unknown[] };
    expect(result.options).toHaveLength(SLASH_ITEMS.length);
  });
});

describe("notesKeymap Tab", () => {
  const binding = (key: string) => notesKeymap(() => {}).find((b) => b.key === key)!.run as unknown as StateCommand;
  test("indents and outdents when every selected line is a list item", () => {
    expect(run("- a", 0, 0, binding("Tab"))).toMatchObject({ ok: true, doc: "  - a" });
    expect(run("- [ ] a\n1. b", 0, 12, binding("Tab"))).toMatchObject({ ok: true, doc: "  - [ ] a\n  1. b" });
    expect(run("  * a", 3, 3, binding("Shift-Tab"))).toMatchObject({ ok: true, doc: "* a" });
  });
  test("lets focus move when a selected line is not a list item", () => {
    expect(run("plain", 0, 0, binding("Tab"))).toMatchObject({ ok: false, doc: "plain" });
    expect(run("- a\nplain", 0, 9, binding("Tab"))).toMatchObject({ ok: false, doc: "- a\nplain" });
    expect(run("# h", 0, 0, binding("Shift-Tab"))).toMatchObject({ ok: false, doc: "# h" });
  });
});
