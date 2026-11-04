export type Category = "all" | "snippets" | "marketplace" | "settings" | "join";

export const SCOPES: { category: Category; prefix: string }[] = [
  { category: "all",         prefix: "" },
  { category: "join",        prefix: "join>" },
  { category: "snippets",    prefix: ">" },
  { category: "marketplace", prefix: "m>" },
  { category: "settings",    prefix: "@" },
];

const SCOPE_PREFIXES: [RegExp, Category][] = [
  [/^join[> ]\s*/i, "join"],
  [/^m>\s*/, "marketplace"],
  [/^>\s*/, "snippets"],
  [/^@\s*/, "settings"],
];

export function detectScope(raw: string): { category: Category; rest: string } | null {
  for (const [re, category] of SCOPE_PREFIXES) {
    const m = re.exec(raw);
    if (m) return { category, rest: raw.slice(m[0].length) };
  }
  return null;
}
