import { EditorView } from "@codemirror/view";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { tags as t } from "@lezer/highlight";
import type { Extension } from "@codemirror/state";
import type { AppTheme } from "@/themes/types";

// Relative luminance → decide light vs dark chrome for CodeMirror internals.
function isDark(hex: string): boolean {
  const m = hex.replace("#", "").match(/.{1,2}/g);
  if (!m || m.length < 3) return true;
  const [r, g, b] = m.map((h) => parseInt(h, 16) / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b < 0.5;
}

// Build a CodeMirror theme + syntax highlight from the app theme so the editor
// matches the rest of the UI (and follows theme switches).
export function cmTheme(theme: AppTheme): Extension[] {
  const ui = theme.ui;
  const term = theme.terminal;
  const dark = isDark(ui.bgCard);
  const bg = ui.bgCard;
  const fg = ui.textPrimary;

  const view = EditorView.theme(
    {
      "&": {
        color: fg,
        backgroundColor: bg,
        fontSize: "var(--t-terminal-font-size, 13px)",
        height: "100%",
      },
      ".cm-content": {
        fontFamily: "var(--t-terminal-font-family, monospace)",
        caretColor: term.cursor,
      },
      ".cm-scroller": {
        fontFamily: "var(--t-terminal-font-family, monospace)",
        lineHeight: "1.5",
      },
      "&.cm-focused": { outline: "none" },
      ".cm-cursor, .cm-dropCursor": { borderLeftColor: term.cursor },
      "&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection":
        { backgroundColor: term.selectionBackground },
      ".cm-gutters": {
        backgroundColor: ui.bgToolbar,
        color: ui.textDim,
        border: "none",
        borderRight: `1px solid ${ui.border}`,
      },
      ".cm-activeLineGutter": { backgroundColor: ui.bgElevated, color: ui.textMuted },
      ".cm-activeLine": { backgroundColor: ui.bgCardHover },
      ".cm-lineNumbers .cm-gutterElement": { padding: "0 8px 0 5px" },
      ".cm-foldPlaceholder": {
        backgroundColor: ui.bgElevated,
        border: "none",
        color: ui.textMuted,
      },
      "&.cm-editor .cm-matchingBracket": {
        backgroundColor: ui.bgElevated,
        outline: `1px solid ${ui.border}`,
      },
      ".cm-selectionMatch": { backgroundColor: ui.bgElevated },
      ".cm-panels": { backgroundColor: ui.bgToolbar, color: fg },
      ".cm-searchMatch": {
        backgroundColor: term.yellow + "33",
        outline: `1px solid ${term.yellow}`,
      },
      ".cm-searchMatch.cm-searchMatch-selected": { backgroundColor: term.yellow + "55" },
      ".cm-tooltip": {
        backgroundColor: ui.bgModal,
        border: `1px solid ${ui.border}`,
        color: fg,
      },
    },
    { dark },
  );

  const highlight = HighlightStyle.define([
    { tag: [t.comment, t.lineComment, t.blockComment], color: ui.textDim, fontStyle: "italic" },
    { tag: [t.keyword, t.modifier, t.operatorKeyword], color: term.magenta },
    { tag: [t.string, t.special(t.string), t.regexp], color: term.green },
    { tag: [t.number, t.bool, t.atom], color: term.yellow },
    { tag: [t.function(t.variableName), t.function(t.propertyName)], color: term.blue },
    { tag: [t.variableName, t.propertyName], color: fg },
    { tag: [t.typeName, t.className, t.namespace], color: term.cyan },
    { tag: [t.propertyName, t.attributeName], color: term.cyan },
    { tag: [t.tagName, t.angleBracket], color: term.red },
    { tag: [t.operator, t.punctuation, t.separator, t.bracket], color: ui.textMuted },
    { tag: [t.definitionKeyword, t.controlKeyword], color: term.magenta },
    { tag: [t.constant(t.name), t.standard(t.name)], color: term.brightCyan },
    { tag: [t.heading], color: term.blue, fontWeight: "bold" },
    { tag: [t.link, t.url], color: term.cyan, textDecoration: "underline" },
    { tag: [t.invalid], color: term.red },
  ]);

  return [view, syntaxHighlighting(highlight)];
}
