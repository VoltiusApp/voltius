export const ANSI_SLOTS = [
  "black", "red", "green", "yellow", "blue", "magenta", "cyan", "white",
  "brightBlack", "brightRed", "brightGreen", "brightYellow",
  "brightBlue", "brightMagenta", "brightCyan", "brightWhite",
] as const;
export type AnsiSlot = (typeof ANSI_SLOTS)[number];

export interface KeywordRule {
  id: string;
  color: AnsiSlot;
  words: string[];
  enabled: boolean;
}

export interface KeywordMatch {
  start: number;
  end: number;
  color: AnsiSlot;
}

export type KeywordMatcher = (text: string) => KeywordMatch[];

export const MAX_KEYWORD_RULES = 20;
export const MAX_KEYWORD_WORDS = 50;
export const MAX_KEYWORD_LENGTH = 64;

export const DEFAULT_KEYWORD_RULES: KeywordRule[] = [
  {
    id: "error",
    color: "red",
    enabled: true,
    words: ["error", "errors", "failed", "failure", "fail", "fatal", "denied", "refused", "panic", "exception", "critical"],
  },
  { id: "warning", color: "yellow", enabled: true, words: ["warning", "warnings", "warn", "deprecated"] },
  { id: "success", color: "green", enabled: true, words: ["success", "successful", "succeeded", "ok", "done", "passed"] },
];

export function sameKeywordRules(a: KeywordRule[], b: KeywordRule[]): boolean {
  return a.length === b.length && a.every((rule, i) => {
    const other = b[i];
    return rule.id === other.id && rule.color === other.color && rule.enabled === other.enabled
      && rule.words.length === other.words.length && rule.words.every((word, w) => word === other.words[w]);
  });
}

function normalizeKeywords(words: unknown): string[] {
  if (!Array.isArray(words)) return [];
  const clean = new Set<string>();
  for (const word of words) {
    if (typeof word !== "string") continue;
    const text = word.trim().toLowerCase().slice(0, MAX_KEYWORD_LENGTH).trim();
    if (text) clean.add(text);
  }
  return [...clean].slice(0, MAX_KEYWORD_WORDS);
}

export function sanitizeKeywordRules(value: unknown): KeywordRule[] {
  if (!Array.isArray(value)) return DEFAULT_KEYWORD_RULES;
  const ids = new Set<string>();
  const rules: KeywordRule[] = [];
  for (const raw of value) {
    if (rules.length === MAX_KEYWORD_RULES) break;
    if (!raw || typeof raw !== "object") continue;
    const { id, color, words, enabled } = raw as Record<string, unknown>;
    if (typeof id !== "string" || !id || id.length > MAX_KEYWORD_LENGTH || ids.has(id)) continue;
    if (!ANSI_SLOTS.includes(color as AnsiSlot)) continue;
    ids.add(id);
    rules.push({ id, color: color as AnsiSlot, words: normalizeKeywords(words), enabled: enabled !== false });
  }
  return rules;
}

const WORD_CHAR = "[\\p{L}\\p{N}_]";
const UNSPACED = "\\p{sc=Han}\\p{sc=Hiragana}\\p{sc=Katakana}\\p{sc=Hangul}\\p{sc=Thai}";
const startsBounded = new RegExp(`^(?![${UNSPACED}])${WORD_CHAR}`, "u");
const endsBounded = new RegExp(`(?![${UNSPACED}])${WORD_CHAR}$`, "u");
const endsInWordChar = new RegExp(`${WORD_CHAR}$`, "u");

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function compileKeywordRules(rules: KeywordRule[]): KeywordMatcher | null {
  const colors = new Map<string, AnsiSlot>();
  for (const rule of rules) {
    if (!rule.enabled) continue;
    for (const word of rule.words) if (!colors.has(word)) colors.set(word, rule.color);
  }
  if (colors.size === 0) return null;

  const alternatives = [...colors.keys()]
    .sort((a, b) => b.length - a.length)
    .map((word) => escapeRegExp(word) + (endsBounded.test(word) ? `(?!${WORD_CHAR})` : ""));
  const pattern = new RegExp(alternatives.join("|"), "giu");

  return (text) => {
    const matches: KeywordMatch[] = [];
    pattern.lastIndex = 0;
    for (let found = pattern.exec(text); found; found = pattern.exec(text)) {
      const { index } = found;
      const color = colors.get(found[0].toLowerCase());
      const insideWord = startsBounded.test(found[0]) && endsInWordChar.test(text.slice(Math.max(0, index - 2), index));
      if (!color || insideWord) {
        // A /u regex steps back onto a lead surrogate, so advance by a whole code point.
        pattern.lastIndex = index + ((text.codePointAt(index) ?? 0) > 0xffff ? 2 : 1);
        continue;
      }
      matches.push({ start: index, end: index + found[0].length, color });
    }
    return matches;
  };
}
