import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import {
  Decoration,
  EditorView,
  MatchDecorator,
  ViewPlugin,
  keymap,
  type DecorationSet,
  type ViewUpdate,
} from "@codemirror/view";
import { Prec } from "@codemirror/state";
import {
  acceptCompletion,
  autocompletion,
  insertCompletionText,
  pickedCompletion,
  type Completion,
  type CompletionSource,
} from "@codemirror/autocomplete";
import { CodeField, type CodeFieldProps } from "@/components/shared/CodeField";
import { SCRIPT_LANGUAGES, SNIPPET_VAR, detectScriptLanguage } from "./scriptLanguage";
import { activeVarQuery, filterDynamicVars, DYNAMIC_VAR_DEF_KEYS } from "./varAutocomplete";

const varMarks = new MatchDecorator({
  regexp: new RegExp(SNIPPET_VAR),
  decoration: Decoration.mark({ class: "cm-snippet-var" }),
});

const varHighlight = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) { this.decorations = varMarks.createDeco(view); }
    update(u: ViewUpdate) { this.decorations = varMarks.updateDeco(u, this.decorations); }
  },
  { decorations: (v) => v.decorations },
);

const CHROME = Prec.highest(EditorView.theme({
  ".cm-snippet-var": { color: "var(--t-accent)" },
  ".cm-tooltip-autocomplete > ul > li": { display: "flex", alignItems: "baseline", gap: "1.5rem" },
  ".cm-completionLabel": { fontFamily: "var(--t-terminal-font-family, monospace)", color: "var(--t-accent)" },
  ".cm-completionDetail": { marginLeft: "auto", fontStyle: "normal", color: "var(--t-text-dim)" },
}));

function varCompletions(defs: { value: string; desc: string }[]): CompletionSource {
  return (ctx) => {
    const line = ctx.state.doc.lineAt(ctx.pos);
    const query = activeVarQuery(line.text.slice(0, ctx.pos - line.from));
    if (query === null) return null;
    const options: Completion[] = filterDynamicVars(defs, query).map((d) => ({
      label: d.value,
      displayLabel: `{{${d.value}}}`,
      detail: d.desc,
      apply: (view, completion, from, to) => {
        const closed = view.state.sliceDoc(to, to + 2) === "}}" ? 2 : 0;
        view.dispatch({
          ...insertCompletionText(view.state, `${d.value}}}`, from, to + closed),
          annotations: pickedCompletion.of(completion),
        });
      },
    }));
    return options.length ? { from: ctx.pos - query.length, options, filter: false } : null;
  };
}

type Props = Omit<CodeFieldProps, "extensions">;

/** Snippet script editor: shell/PowerShell highlighting plus the `{{`-variable autocomplete. */
export function ScriptEditor(props: Props) {
  const { t } = useTranslation();
  const language = detectScriptLanguage(props.value);
  const defs = useMemo(
    () => DYNAMIC_VAR_DEF_KEYS.map((d) => ({ value: d.value, desc: t(d.descKey) })),
    [t],
  );

  const extensions = useMemo(
    () => [
      CHROME,
      SCRIPT_LANGUAGES[language],
      varHighlight,
      autocompletion({ override: [varCompletions(defs)], icons: false }),
      Prec.highest(keymap.of([{ key: "Tab", run: acceptCompletion }])),
    ],
    [language, defs],
  );

  return <CodeField {...props} extensions={extensions} />;
}
