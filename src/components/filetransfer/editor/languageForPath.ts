import type { Extension } from "@codemirror/state";
import { StreamLanguage } from "@codemirror/language";
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
import { toml } from "@codemirror/legacy-modes/mode/toml";
import { properties } from "@codemirror/legacy-modes/mode/properties";
import { dockerFile } from "@codemirror/legacy-modes/mode/dockerfile";
import { go } from "@codemirror/legacy-modes/mode/go";
import { lua } from "@codemirror/legacy-modes/mode/lua";
import { perl } from "@codemirror/legacy-modes/mode/perl";
import { ruby } from "@codemirror/legacy-modes/mode/ruby";
import { swift } from "@codemirror/legacy-modes/mode/swift";
import { c, cpp, java, csharp, kotlin } from "@codemirror/legacy-modes/mode/clike";
import { SCRIPT_LANGUAGES } from "@/components/snippets/scriptLanguage";

const legacy = (m: Parameters<typeof StreamLanguage.define>[0]) => () =>
  StreamLanguage.define(m);

const sh = () => SCRIPT_LANGUAGES.shell;
const ps = () => SCRIPT_LANGUAGES.powershell;
const ini = legacy(properties);

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
  // Shell
  sh: sh,
  bash: sh,
  zsh: sh,
  ksh: sh,
  // Config formats
  toml: legacy(toml),
  ini: ini,
  cfg: ini,
  conf: ini,
  properties: ini,
  env: ini,
  // Systems / other languages
  go: legacy(go),
  c: legacy(c),
  h: legacy(c),
  cpp: legacy(cpp),
  cc: legacy(cpp),
  cxx: legacy(cpp),
  hpp: legacy(cpp),
  hh: legacy(cpp),
  hxx: legacy(cpp),
  java: legacy(java),
  kt: legacy(kotlin),
  kts: legacy(kotlin),
  cs: legacy(csharp),
  rb: legacy(ruby),
  lua: legacy(lua),
  pl: legacy(perl),
  pm: legacy(perl),
  swift: legacy(swift),
  ps1: ps,
  psm1: ps,
};

// Extension-less / dotfile well-known basenames (lowercased).
const BASENAME_MAP: Record<string, () => Extension> = {
  ".bashrc": sh,
  ".bash_profile": sh,
  ".bash_aliases": sh,
  ".zshrc": sh,
  ".zprofile": sh,
  ".zshenv": sh,
  ".kshrc": sh,
  ".cshrc": sh,
  ".profile": sh,
  ".gitconfig": ini,
  ".editorconfig": ini,
  ".npmrc": ini,
  ".inputrc": ini,
};

export function languageForPath(path: string): Extension | null {
  const base = (path.split("/").pop() ?? path).toLowerCase();

  const byName = BASENAME_MAP[base];
  if (byName) return byName();
  if (base === "dockerfile" || base.startsWith("dockerfile."))
    return StreamLanguage.define(dockerFile);
  if (base === ".env" || base.startsWith(".env.")) return ini();

  const dot = base.lastIndexOf(".");
  if (dot <= 0) return null;
  const ext = base.slice(dot + 1);
  const factory = MAP[ext];
  return factory ? factory() : null;
}
