import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import CodeMirror from "@uiw/react-codemirror";
import {
  Decoration,
  EditorView,
  MatchDecorator,
  ViewPlugin,
  keymap,
  placeholder as cmPlaceholder,
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
import { useCmTheme } from "@/components/filetransfer/editor/useCmTheme";
import { cmPopupChrome } from "@/components/filetransfer/editor/cmTheme";
import { useFieldsReadOnly } from "@/components/shared/editAccess";
import { formInputStyle } from "@/components/shared/Panel";
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
  "&": { backgroundColor: "transparent", fontSize: "0.875rem" },
  ".cm-content": { padding: "8px 0" },
  ".cm-line": { padding: "0 12px" },
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

interface Props {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  minHeight?: string;
  onBlur?: () => void;
  "aria-invalid"?: boolean;
  required?: boolean;
  /** Grow to the parent's height (a flex column) instead of sizing to the script. */
  fill?: boolean;
  className?: string;
}

/** Snippet script editor: shell/PowerShell highlighting plus the `{{`-variable autocomplete. */
export function ScriptEditor({ value, onChange, placeholder, minHeight = "4.5rem", onBlur, "aria-invalid": invalid, required, fill, className = "" }: Props) {
  const { t } = useTranslation();
  const themeExt = useCmTheme();
  const readOnly = useFieldsReadOnly();
  const language = detectScriptLanguage(value);
  const defs = useMemo(
    () => DYNAMIC_VAR_DEF_KEYS.map((d) => ({ value: d.value, desc: t(d.descKey) })),
    [t],
  );

  const extensions = useMemo(
    () => [
      ...themeExt,
      cmPopupChrome,
      CHROME,
      SCRIPT_LANGUAGES[language],
      varHighlight,
      EditorView.lineWrapping,
      autocompletion({ override: [varCompletions(defs)], icons: false }),
      Prec.highest(keymap.of([{ key: "Tab", run: acceptCompletion }])),
      ...(placeholder ? [cmPlaceholder(placeholder)] : []),
    ],
    [themeExt, language, defs, placeholder],
  );

  return (
    <div
      data-script-editor
      aria-invalid={invalid || undefined}
      aria-required={required || undefined}
      className={`form-input w-full rounded-lg overflow-hidden ${fill ? "flex flex-col" : ""} ${readOnly ? "opacity-60" : ""} ${className}`}
      style={formInputStyle}
    >
      <CodeMirror
        value={value}
        onChange={onChange}
        onBlur={onBlur}
        extensions={extensions}
        editable={!readOnly}
        readOnly={readOnly}
        indentWithTab={false}
        theme="none"
        className={fill ? "flex-1 min-h-0" : undefined}
        height={fill ? "100%" : undefined}
        minHeight={minHeight}
        maxHeight={fill ? undefined : "24rem"}
        basicSetup={{ lineNumbers: false, foldGutter: false, highlightActiveLine: false, highlightActiveLineGutter: false, autocompletion: false }}
      />
    </div>
  );
}
