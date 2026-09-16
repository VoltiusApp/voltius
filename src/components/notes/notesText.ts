const TASK_RE = /^(\s*(?:>\s*)*(?:[-*+]|\d+[.)])\s+\[)([ xX])(\])/;
const ALLOWED_PROTOCOLS = new Set(["http:", "https:", "mailto:"]);

export function normalizeNotes(value: string): string | undefined {
  return value.trim() ? value : undefined;
}

export function sameNotes(a: string | undefined, b: string | undefined): boolean {
  return (normalizeNotes(a ?? "") ?? "") === (normalizeNotes(b ?? "") ?? "");
}

export function toggleTaskAtLine(source: string, line: number): string {
  const lines = source.split("\n");
  const index = line - 1;
  const match = lines[index]?.match(TASK_RE);
  if (!match) return source;
  lines[index] = lines[index].replace(TASK_RE, `$1${match[2] === " " ? "x" : " "}$3`);
  return lines.join("\n");
}

export function isAllowedLinkHref(href: string | undefined | null): href is string {
  if (!href) return false;
  try {
    return ALLOWED_PROTOCOLS.has(new URL(href).protocol);
  } catch {
    return false;
  }
}
