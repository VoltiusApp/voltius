import { useMemo } from "react";
import CodeMirror from "@uiw/react-codemirror";
import { EditorView, placeholder as cmPlaceholder } from "@codemirror/view";
import { Prec, type Extension } from "@codemirror/state";
import { useCmTheme } from "@/components/filetransfer/editor/useCmTheme";
import { cmPopupChrome } from "@/components/filetransfer/editor/cmTheme";
import { useFieldsReadOnly } from "@/components/shared/editAccess";
import { formInputStyle } from "@/components/shared/Panel";

const CHROME = Prec.highest(EditorView.theme({
  "&": { backgroundColor: "transparent", fontSize: "0.875rem" },
  ".cm-content": { padding: "8px 0" },
  ".cm-line": { padding: "0 12px" },
}));

export interface CodeFieldProps {
  value: string;
  onChange: (value: string) => void;
  extensions: Extension[];
  placeholder?: string;
  minHeight?: string;
  onBlur?: () => void;
  "aria-invalid"?: boolean;
  "aria-label"?: string;
  required?: boolean;
  /** Grow to the parent's height (a flex column) instead of sizing to the content. */
  fill?: boolean;
  className?: string;
}

export function CodeField({ value, onChange, extensions, placeholder, minHeight = "4.5rem", onBlur, "aria-invalid": invalid, "aria-label": label, required, fill, className = "" }: CodeFieldProps) {
  const themeExt = useCmTheme();
  const readOnly = useFieldsReadOnly();

  const all = useMemo(
    () => [
      ...themeExt,
      cmPopupChrome,
      CHROME,
      EditorView.lineWrapping,
      ...extensions,
      ...(label ? [EditorView.contentAttributes.of({ "aria-label": label })] : []),
      ...(placeholder ? [cmPlaceholder(placeholder)] : []),
    ],
    [themeExt, extensions, label, placeholder],
  );

  return (
    <div
      data-code-field
      aria-invalid={invalid || undefined}
      aria-required={required || undefined}
      className={`form-input w-full rounded-lg overflow-hidden ${fill ? "flex flex-col" : ""} ${readOnly ? "opacity-60" : ""} ${className}`}
      style={formInputStyle}
    >
      <CodeMirror
        value={value}
        onChange={onChange}
        onBlur={onBlur}
        extensions={all}
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
