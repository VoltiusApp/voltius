import { useMemo } from "react";
import { useInlineSyntax } from "@/components/filetransfer/editor/useCmTheme";
import { snippetSearchText } from "@/services/snippetSteps";
import type { Snippet } from "@/types";
import { highlightScript, SNIPPET_VAR_CLASS } from "./scriptLanguage";

const VAR_STYLE = { color: "var(--t-accent)" };

/** Syntax-coloured script text as inline spans; the parent element owns font, wrapping and truncation. */
export function HighlightedScript({ code, limit }: { code: string; limit?: number }) {
  const { highlighter, styleOf } = useInlineSyntax();
  const text = limit !== undefined ? code.slice(0, limit) : code;
  const segments = useMemo(() => highlightScript(text, highlighter), [text, highlighter]);
  return (
    <>
      {segments.map((s, i) =>
        s.cls ? <span key={i} style={s.cls === SNIPPET_VAR_CLASS ? VAR_STYLE : styleOf(s.cls)}>{s.text}</span> : s.text,
      )}
    </>
  );
}

/** One-line list preview of a snippet's steps; only the head is parsed since callers truncate it. */
export function SnippetPreview({ snippet }: { snippet: Pick<Snippet, "steps"> }) {
  return <HighlightedScript code={snippetSearchText(snippet)} limit={300} />;
}
