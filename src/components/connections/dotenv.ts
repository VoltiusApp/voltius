import type { EnvVar } from "@/types";

type KeyValue = Pick<EnvVar, "key" | "value">;

const KEY_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
const ASSIGNMENT_RE = /^(?:export\s+)?([^=\s]+)\s*=\s*(.*)$/;
const DOUBLE_ESCAPES: Record<string, string> = { n: "\n", r: "\r", t: "\t", '"': '"', "\\": "\\" };
const PLAIN_VALUE_RE = /^[^\s"'`#\\]*$/;

function closingQuote(body: string, quote: string): number {
  for (let i = 0; i < body.length; i++) {
    if (quote === '"' && body[i] === "\\") i++;
    else if (body[i] === quote) return i;
  }
  return -1;
}

export function parseDotenv(text: string): { vars: KeyValue[]; skipped: string[] } {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const values = new Map<string, string>();
  const skipped: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith("#")) continue;
    const match = ASSIGNMENT_RE.exec(line);
    if (!match || !KEY_RE.test(match[1])) {
      skipped.push(line);
      continue;
    }
    const [, key, rest] = match;
    const quote = rest[0];
    if (quote !== '"' && quote !== "'" && quote !== "`") {
      values.set(key, rest.replace(/\s+#.*$/, "").trim());
      continue;
    }
    // An unclosed quote skips only its own line, so one typo can't swallow the rest of the file.
    let body = rest.slice(1);
    let end = closingQuote(body, quote);
    let last = i;
    while (end < 0 && last + 1 < lines.length) {
      body += "\n" + lines[++last];
      end = closingQuote(body, quote);
    }
    if (end < 0) {
      skipped.push(line);
      continue;
    }
    i = last;
    const raw = body.slice(0, end);
    values.set(key, quote === '"' ? raw.replace(/\\(.)/g, (m, c: string) => DOUBLE_ESCAPES[c] ?? m) : raw);
  }
  return { vars: [...values].map(([key, value]) => ({ key, value })), skipped };
}

function quoteValue(value: string): string {
  if (PLAIN_VALUE_RE.test(value)) return value;
  const escaped = value.replace(/[\\"]/g, "\\$&").replace(/\n/g, "\\n").replace(/\r/g, "\\r").replace(/\t/g, "\\t");
  return `"${escaped}"`;
}

export function serializeDotenv(vars: KeyValue[]): string {
  return vars.filter((v) => v.key).map((v) => `${v.key}=${quoteValue(v.value)}`).join("\n");
}

export function withStableIds(vars: KeyValue[], previous: EnvVar[]): EnvVar[] {
  const ids = new Map(previous.map((e) => [e.key, e.id]));
  return vars.map((v) => ({ id: ids.get(v.key) ?? crypto.randomUUID(), ...v }));
}

export function mergeEnvVars(list: EnvVar[], incoming: KeyValue[], replaceId: string): EnvVar[] {
  const values = new Map(incoming.map((v) => [v.key, v.value]));
  const kept = new Set(list.filter((e) => e.id !== replaceId).map((e) => e.key));
  const added = incoming.filter((v) => !kept.has(v.key)).map((v) => ({ id: crypto.randomUUID(), ...v }));
  return list.flatMap((e) => {
    if (e.id === replaceId) return added;
    return values.has(e.key) ? [{ ...e, value: values.get(e.key)! }] : [e];
  });
}
