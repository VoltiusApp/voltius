import { test, expect } from "vitest";
import { EditorState } from "@codemirror/state";
import { ensureSyntaxTree } from "@codemirror/language";
import { classHighlighter, highlightTree } from "@lezer/highlight";
import { dotenvLanguage } from "./dotenvLanguage";

function tokens(doc: string): [string, string][] {
  const state = EditorState.create({ doc, extensions: dotenvLanguage });
  const out: [string, string][] = [];
  highlightTree(ensureSyntaxTree(state, doc.length)!, classHighlighter, (from, to, cls) => out.push([doc.slice(from, to), cls]));
  return out;
}

test("colours comments, export, keys, values and inline comments", () => {
  expect(tokens("# db\nexport HOST=db.internal\nPORT = 5432   # default")).toEqual([
    ["# db", "tok-comment"],
    ["export", "tok-keyword"],
    ["HOST", "tok-propertyName"],
    ["=", "tok-operator"],
    ["db.internal", "tok-string"],
    ["PORT", "tok-propertyName"],
    ["=", "tok-operator"],
    ["5432", "tok-string"],
    ["# default", "tok-comment"],
  ]);
});

test("quoted values span lines and lines the parser ignores are marked invalid", () => {
  const out = tokens('KEY="a\nb" # note\n1BAD=x\nno equals');
  expect(out.filter(([, c]) => c === "tok-string").map(([s]) => s).join("")).toBe('"a' + 'b"');
  expect(out).toContainEqual(["# note", "tok-comment"]);
  expect(out).toContainEqual(["1BAD=x", "tok-invalid"]);
  expect(out).toContainEqual(["no equals", "tok-invalid"]);
});
