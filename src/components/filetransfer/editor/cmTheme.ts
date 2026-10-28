import { EditorView, tooltips } from "@codemirror/view";
import { HighlightStyle, syntaxHighlighting, type TagStyle } from "@codemirror/language";
import { tagHighlighter, tags as t, type Highlighter } from "@lezer/highlight";
import type { CSSProperties } from "react";
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

  const highlight = HighlightStyle.define(syntaxTagStyles(theme));

  return [view, syntaxHighlighting(highlight)];
}

function syntaxTagStyles(theme: AppTheme): TagStyle[] {
  const ui = theme.ui;
  const term = theme.terminal;
  const fg = ui.textPrimary;
  return [
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
  ];
}

export interface InlineSyntax {
  highlighter: Highlighter;
  styleOf: (cls: string) => CSSProperties;
}

/** The editor's token colours as inline styles, for read-only code that does not mount an EditorView. */
export function inlineSyntax(theme: AppTheme): InlineSyntax {
  const specs = syntaxTagStyles(theme);
  const styles = specs.map(({ tag: _tag, ...css }) => css as CSSProperties);
  return {
    highlighter: tagHighlighter(specs.map((spec, i) => ({ tag: spec.tag, class: String(i) }))),
    styleOf: (cls) => Object.assign({}, ...cls.split(" ").map((i) => styles[Number(i)])),
  };
}

/** Placeholder and autocomplete popup styled like the app's own menus; fixed to body so panels cannot clip it. */
export const cmPopupChrome: Extension = [tooltips({ position: "fixed", parent: document.body }), EditorView.theme({
  ".cm-placeholder": { color: "var(--t-text-muted)" },
  ".cm-tooltip.cm-tooltip-autocomplete": {
    background: "var(--t-bg-card)",
    border: "none",
    borderRadius: "var(--r-md)",
    boxShadow: "var(--t-ring), var(--t-elev-2)",
    padding: "0.375rem",
    "& > ul": { fontFamily: "inherit", minWidth: "12.667rem", maxHeight: "320px" },
    "& > ul > li": {
      padding: "0.5rem 0.75rem",
      borderRadius: "0.5rem",
      fontSize: "0.75rem",
      lineHeight: "1rem",
      color: "var(--t-text-secondary)",
    },
    "& > ul > li:hover, & > ul > li[aria-selected]": {
      background: "var(--t-bg-card-hover)",
      color: "var(--t-text-primary)",
    },
  },
  ".cm-completionMatchedText": { textDecoration: "none" },
})];
