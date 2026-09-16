import { EditorSelection, type EditorState, type StateCommand, type Transaction } from "@codemirror/state";
import type { KeyBinding } from "@codemirror/view";
import { indentLess, indentMore } from "@codemirror/commands";
import { pickedCompletion, type Completion, type CompletionContext, type CompletionResult, type CompletionSource } from "@codemirror/autocomplete";
import { toggleTaskAtLine } from "./notesText";

export type LineKind = "h1" | "h2" | "h3" | "bullet" | "ordered" | "task";

export const MOD_LABEL = typeof navigator !== "undefined" && /Mac/.test(navigator.userAgent) ? "⌘" : "Ctrl";

const LINE_PREFIX_RE = /^(\s*)(#{1,6}\s+|[-*+]\s+\[[ xX]\]\s+|[-*+]\s+|\d+[.)]\s+)?/;

const EDIT_ANNOTATIONS = { scrollIntoView: true, userEvent: "input" } as const;

function prefixFor(kind: LineKind, index: number): string {
  switch (kind) {
    case "h1": return "# ";
    case "h2": return "## ";
    case "h3": return "### ";
    case "bullet": return "- ";
    case "ordered": return `${index + 1}. `;
    case "task": return "- [ ] ";
  }
}

function parsePrefix(text: string): RegExpMatchArray {
  return text.match(LINE_PREFIX_RE)!;
}

function kindOf(parsed: RegExpMatchArray): LineKind | null {
  const prefix = parsed[2] ?? "";
  if (/^###\s/.test(prefix)) return "h3";
  if (/^##\s/.test(prefix)) return "h2";
  if (/^#\s/.test(prefix)) return "h1";
  if (/^[-*+]\s+\[/.test(prefix)) return "task";
  if (/^[-*+]\s/.test(prefix)) return "bullet";
  if (/^\d/.test(prefix)) return "ordered";
  return null;
}

const LIST_KINDS: ReadonlySet<LineKind | null> = new Set<LineKind>(["bullet", "ordered", "task"]);

function onListLines(command: StateCommand): StateCommand {
  return (target) => {
    const { state } = target;
    const allList = selectedLineNumbers(state).every((n) => LIST_KINDS.has(kindOf(parsePrefix(state.doc.line(n).text))));
    return allList && command(target);
  };
}

function selectedLineNumbers(state: EditorState): number[] {
  const numbers = new Set<number>();
  for (const range of state.selection.ranges) {
    const first = state.doc.lineAt(range.from).number;
    const last = state.doc.lineAt(range.to).number;
    for (let n = first; n <= last; n++) numbers.add(n);
  }
  return [...numbers].sort((a, b) => a - b);
}

export function wrapSelection(marker: string): StateCommand {
  return ({ state, dispatch }) => {
    const n = marker.length;
    const spec = state.changeByRange((range) => {
      const wrapped =
        state.sliceDoc(range.from - n, range.from) === marker &&
        state.sliceDoc(range.to, range.to + n) === marker;
      if (wrapped) {
        return {
          changes: [{ from: range.from - n, to: range.from }, { from: range.to, to: range.to + n }],
          range: EditorSelection.range(range.from - n, range.to - n),
        };
      }
      return {
        changes: [{ from: range.from, insert: marker }, { from: range.to, insert: marker }],
        range: EditorSelection.range(range.from + n, range.to + n),
      };
    });
    dispatch(state.update(spec, EDIT_ANNOTATIONS));
    return true;
  };
}

export function toggleLineKind(kind: LineKind): StateCommand {
  return ({ state, dispatch }) => {
    const lines = selectedLineNumbers(state).map((n) => state.doc.line(n));
    const parsed = lines.map((line) => parsePrefix(line.text));
    const remove = parsed.every((m) => kindOf(m) === kind);
    const changes = lines.map((line, i) => {
      const from = line.from + parsed[i][1].length;
      return { from, to: from + (parsed[i][2]?.length ?? 0), insert: remove ? "" : prefixFor(kind, i) };
    });
    dispatch(state.update({ changes, ...EDIT_ANNOTATIONS }));
    return true;
  };
}

export const toggleTaskAtCursor: StateCommand = ({ state, dispatch }) => {
  const line = state.doc.lineAt(state.selection.main.head);
  const next = toggleTaskAtLine(line.text, 1);
  if (next === line.text) return false;
  dispatch(state.update({ changes: { from: line.from, to: line.to, insert: next }, ...EDIT_ANNOTATIONS }));
  return true;
};

export const insertLink: StateCommand = ({ state, dispatch }) => {
  const spec = state.changeByRange((range) => {
    const text = state.sliceDoc(range.from, range.to);
    const urlFrom = range.from + text.length + 3;
    return {
      changes: { from: range.from, to: range.to, insert: `[${text}](url)` },
      range: EditorSelection.range(urlFrom, urlFrom + 3),
    };
  });
  dispatch(state.update(spec, EDIT_ANNOTATIONS));
  return true;
};

export function insertBlock(text: string, cursorOffset: number): StateCommand {
  return ({ state, dispatch }) => {
    const { from, to } = state.selection.main;
    const lead = state.doc.lineAt(from).text.trim() ? "\n" : "";
    const insert = lead + text;
    dispatch(
      state.update({
        changes: { from, to, insert },
        selection: EditorSelection.cursor(from + lead.length + cursorOffset),
        ...EDIT_ANNOTATIONS,
      }),
    );
    return true;
  };
}

export const BLOCKS = {
  codeBlock: ["```\n\n```", 4],
  table: ["| Column | Column |\n| --- | --- |\n|  |  |\n", 36],
  divider: ["---\n", 4],
} satisfies Record<string, [string, number]>;

export interface SlashItem {
  id: string;
  labelKey: string;
  command: StateCommand;
}

export const SLASH_ITEMS: SlashItem[] = [
  { id: "h1", labelKey: "notes.slash.h1", command: toggleLineKind("h1") },
  { id: "h2", labelKey: "notes.slash.h2", command: toggleLineKind("h2") },
  { id: "h3", labelKey: "notes.slash.h3", command: toggleLineKind("h3") },
  { id: "bullet", labelKey: "notes.slash.bullet", command: toggleLineKind("bullet") },
  { id: "numbered", labelKey: "notes.slash.numbered", command: toggleLineKind("ordered") },
  { id: "todo", labelKey: "notes.slash.todo", command: toggleLineKind("task") },
  { id: "code", labelKey: "notes.slash.code", command: insertBlock(...BLOCKS.codeBlock) },
  { id: "table", labelKey: "notes.slash.table", command: insertBlock(...BLOCKS.table) },
  { id: "divider", labelKey: "notes.slash.divider", command: insertBlock(...BLOCKS.divider) },
  { id: "link", labelKey: "notes.slash.link", command: insertLink },
];

export function slashCompletionSource(items: SlashItem[], label: (key: string) => string): CompletionSource {
  return (ctx: CompletionContext): CompletionResult | null => {
    const match = ctx.matchBefore(/(?:^|\s)\/\w*$/);
    if (!match) return null;
    const from = match.from + match.text.lastIndexOf("/");
    const options: Completion[] = items.map((item) => ({
      label: `/${item.id}`,
      displayLabel: label(item.labelKey),
      apply: (view, completion, applyFrom, applyTo) => {
        const removed = view.state.update({ changes: { from: applyFrom, to: applyTo } });
        let applied: Transaction | undefined;
        item.command({ state: removed.state, dispatch: (tr) => { applied = tr; } });
        const changes = applied ? removed.changes.compose(applied.changes) : removed.changes;
        view.dispatch({
          changes,
          selection: applied?.selection ?? view.state.selection.map(changes, 1),
          annotations: pickedCompletion.of(completion),
          ...EDIT_ANNOTATIONS,
        });
      },
    }));
    return { from, options, validFor: /^\/\w*$/ };
  };
}

export function notesKeymap(onPreview: () => void): KeyBinding[] {
  const preview = () => { onPreview(); return true; };
  return [
    { key: "Mod-b", run: wrapSelection("**") },
    { key: "Mod-i", run: wrapSelection("*") },
    { key: "Mod-k", run: insertLink },
    { key: "Mod-Shift-1", run: toggleLineKind("h1") },
    { key: "Mod-Shift-2", run: toggleLineKind("h2") },
    { key: "Mod-Shift-3", run: toggleLineKind("h3") },
    { key: "Mod-Shift-7", run: toggleLineKind("ordered") },
    { key: "Mod-Shift-8", run: toggleLineKind("bullet") },
    { key: "Mod-Shift-9", run: toggleLineKind("task") },
    { key: "Mod-Enter", run: toggleTaskAtCursor },
    { key: "Tab", run: onListLines(indentMore) },
    { key: "Shift-Tab", run: onListLines(indentLess) },
    { key: "Mod-e", run: preview },
    { key: "Escape", run: preview },
  ];
}
