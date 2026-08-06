/**
 * One-line summary of a tool call/result for the transcript row.
 *
 * The raw payload stays available in the row's expander — this only decides
 * what is worth reading at a glance. Ids are passed through verbatim rather
 * than resolved here, because `RichText` swaps any known id for a connection
 * chip and doing it twice would double-resolve.
 *
 * Never throws: anything unparseable falls back to the raw detail, so a tool
 * whose shape isn't anticipated degrades to what the transcript showed before.
 */

/** Keys carrying a target/session/connection id, in display priority. */
const ID_KEYS = ["connectionId", "target", "fromTarget", "sessionId"];

/** `String(v)` on a nested object yields "[object Object]" — say how many
 * instead, and leave the shape itself to the expander. */
function scalar(v: unknown): string {
  if (Array.isArray(v)) return `${v.length}`;
  if (v && typeof v === "object") return "…";
  return String(v);
}

function firstLine(s: string): string {
  const line = s.split("\n").find((l) => l.trim().length > 0) ?? "";
  return line.trim();
}

function summarizeCall(args: Record<string, unknown>): string | null {
  const str = (k: string) => (typeof args[k] === "string" ? (args[k] as string) : null);

  const command = str("command");
  if (command) {
    const id = ID_KEYS.map(str).find(Boolean);
    return id ? `${id} · ${command}` : command;
  }

  const fromTarget = str("fromTarget");
  const fromPath = str("fromPath");
  const toTarget = str("toTarget");
  const toPath = str("toPath");
  if (fromTarget && fromPath && toTarget && toPath) {
    return `${fromTarget}:${fromPath} → ${toTarget}:${toPath}`;
  }

  const from = str("from");
  const to = str("to");
  if (from && to) return `${from} → ${to}`;

  const path = str("path");
  const target = ID_KEYS.map(str).find(Boolean);
  if (path) return target ? `${target}:${path}` : path;
  if (target) return target;

  const keys = Object.keys(args);
  if (keys.length === 0) return "";
  return keys.map((k) => `${k}: ${scalar(args[k])}`).join(" · ");
}

function summarizeResult(value: unknown, itemsLabel: (n: number) => string): string | null {
  if (Array.isArray(value)) return itemsLabel(value.length);
  if (typeof value === "string") return firstLine(value);
  if (!value || typeof value !== "object") return null;

  const o = value as Record<string, unknown>;
  if (typeof o.exitCode === "number") {
    const out = typeof o.output === "string" ? firstLine(o.output) : "";
    const exit = `exit ${o.exitCode}`;
    return out ? `${exit} · ${out}` : exit;
  }
  for (const k of ["sessionId", "path", "message"]) {
    if (typeof o[k] === "string") return o[k] as string;
  }
  const entries = Object.entries(o);
  if (entries.length === 0) return "";
  return entries.map(([k, v]) => `${k}: ${scalar(v)}`).join(" · ");
}

export function summarizeTool(
  state: "call" | "result" | "error",
  detail: string,
  itemsLabel: (n: number) => string,
): string {
  if (state === "error") return detail;
  let parsed: unknown;
  try {
    parsed = JSON.parse(detail);
  } catch {
    return detail;
  }
  const summary =
    state === "call"
      ? parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? summarizeCall(parsed as Record<string, unknown>)
        : null
      : summarizeResult(parsed, itemsLabel);
  return summary ?? detail;
}
