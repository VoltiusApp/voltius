import type { Extension } from "@codemirror/state";
import { javascript } from "@codemirror/lang-javascript";
import { json } from "@codemirror/lang-json";
import { python } from "@codemirror/lang-python";
import { yaml } from "@codemirror/lang-yaml";
import { markdown } from "@codemirror/lang-markdown";
import { rust } from "@codemirror/lang-rust";
import { html } from "@codemirror/lang-html";
import { css } from "@codemirror/lang-css";
import { sql } from "@codemirror/lang-sql";
import { xml } from "@codemirror/lang-xml";

const MAP: Record<string, () => Extension> = {
  ts: () => javascript({ typescript: true }),
  tsx: () => javascript({ typescript: true, jsx: true }),
  js: () => javascript(),
  jsx: () => javascript({ jsx: true }),
  mjs: () => javascript(),
  cjs: () => javascript(),
  json: () => json(),
  py: () => python(),
  yml: () => yaml(),
  yaml: () => yaml(),
  md: () => markdown(),
  markdown: () => markdown(),
  rs: () => rust(),
  html: () => html(),
  htm: () => html(),
  css: () => css(),
  scss: () => css(),
  sql: () => sql(),
  xml: () => xml(),
};

export function languageForPath(path: string): Extension | null {
  const dot = path.lastIndexOf(".");
  if (dot < 0) return null;
  const ext = path.slice(dot + 1).toLowerCase();
  const factory = MAP[ext];
  return factory ? factory() : null;
}
