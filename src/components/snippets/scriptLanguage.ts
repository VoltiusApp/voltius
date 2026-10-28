import { StreamLanguage } from "@codemirror/language";
import { shell } from "@codemirror/legacy-modes/mode/shell";
import { powerShell } from "@codemirror/legacy-modes/mode/powershell";
import { highlightTree, type Highlighter } from "@lezer/highlight";

export type ScriptLanguage = "shell" | "powershell";

export const SCRIPT_LANGUAGES: Record<ScriptLanguage, StreamLanguage<unknown>> = {
  shell: StreamLanguage.define(shell),
  powershell: StreamLanguage.define(powerShell),
};

const SHELL_SHEBANG = /^#!.*\b(?:ba|z|k|da)?sh\b/;
const POWERSHELL_MARKERS =
  /\$env:\w|\|\s*iex\b|\b(?:Get|Set|New|Remove|Invoke|Write|Test|Join|Start|Stop|Restart|Select|Where|ForEach|Out|Import|Export|Install|Add|Copy|Move|Resolve)-[A-Z][a-z]+/;

/** Snippets carry no language field, so it is read from the script itself; shell unless it looks like PowerShell. */
export function detectScriptLanguage(code: string): ScriptLanguage {
  return !SHELL_SHEBANG.test(code) && POWERSHELL_MARKERS.test(code) ? "powershell" : "shell";
}

export const SNIPPET_VAR = /\{\{[^{}\n]*\}\}/g;
export const SNIPPET_VAR_CLASS = "snippet-var";

export interface ScriptSegment {
  text: string;
  cls: string | null;
}

/** Splits a script into runs sharing one highlighter class; `{{vars}}` win over the token they sit in. */
export function highlightScript(code: string, highlighter: Highlighter): ScriptSegment[] {
  const classes: (string | null)[] = new Array(code.length).fill(null);
  const tree = SCRIPT_LANGUAGES[detectScriptLanguage(code)].parser.parse(code);
  highlightTree(tree, highlighter, (from, to, cls) => classes.fill(cls, from, to));
  for (const m of code.matchAll(SNIPPET_VAR)) classes.fill(SNIPPET_VAR_CLASS, m.index, m.index + m[0].length);

  const out: ScriptSegment[] = [];
  let start = 0;
  for (let i = 1; i <= code.length; i++) {
    if (i === code.length || classes[i] !== classes[start]) {
      out.push({ text: code.slice(start, i), cls: classes[start] });
      start = i;
    }
  }
  return out;
}
