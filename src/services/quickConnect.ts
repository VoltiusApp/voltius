import type { Connection } from "@/types";

export type QuickConnectTarget =
  | { kind: "ssh"; user: string; host: string; port: number }
  | { kind: "serial"; port?: string }
  | { kind: "local"; shell?: string };

export type QuickConnectInvalidPort = { kind: "invalid-port"; port: string };

export type QuickConnectIntent = QuickConnectTarget | QuickConnectInvalidPort | null;

const DEVICE_PATH_RE = /^(\/dev\/tty\S+|\/dev\/cu\.\S+|COM\d+)$/i;
const BARE_WORD_RE = /^[\w.-]+$/;

export function parseQuickConnect(raw: string): QuickConnectIntent {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  // local
  if (trimmed === "local") return { kind: "local" };
  const localMatch = /^local\s+(\S+)$/.exec(trimmed);
  if (localMatch && BARE_WORD_RE.test(localMatch[1])) {
    return { kind: "local", shell: localMatch[1] };
  }

  // serial
  if (trimmed === "serial") return { kind: "serial" };
  const serialMatch = /^serial\s+(\S+)$/.exec(trimmed);
  if (serialMatch) return { kind: "serial", port: serialMatch[1] };
  if (DEVICE_PATH_RE.test(trimmed)) return { kind: "serial", port: trimmed };

  // ssh
  const hasSshPrefix = /^ssh\s+/i.test(trimmed);
  const body = hasSshPrefix ? trimmed.replace(/^ssh\s+/i, "") : trimmed;
  const looksLikeSsh =
    hasSshPrefix || body.includes("@") || /:\d+/.test(body) || /(^|\s)-p\s+\d+/.test(body);
  if (!looksLikeSsh) return null;

  const tokens = body.split(/\s+/).filter(Boolean);
  let flagPort: string | undefined;
  let target: string | undefined;
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t === "-p") {
      flagPort = tokens[i + 1] ?? "";
      i++;
      continue;
    }
    if (t.startsWith("-")) {
      // Drop other flags. Skip a flag's value too (e.g. -i key), unless the next token
      // looks like the target (contains "@" or is another flag). Note: a flag value that
      // itself contains "@" (rare for a quick-connect box) would be misread as the target.
      if (i + 1 < tokens.length && !tokens[i + 1].includes("@") && !tokens[i + 1].startsWith("-")) i++;
      continue;
    }
    if (!target) target = t;
  }
  if (!target) return null;

  const atIdx = target.indexOf("@");
  const user = atIdx >= 0 ? target.slice(0, atIdx) : "";
  const address = splitHostPort(atIdx >= 0 ? target.slice(atIdx + 1) : target);
  if (!address) return null;

  const given = [address.port, flagPort].filter((p): p is string => p !== undefined);
  const parsed = given.map(parsePort);
  const bad = parsed.indexOf(null);
  if (bad >= 0) return { kind: "invalid-port", port: given[bad] };
  const port = parsed[parsed.length - 1] ?? 22;
  return { kind: "ssh", user: user || "root", host: address.host, port };
}

// A bare literal with several colons is IPv6; only the bracketed form can carry a port.
function splitHostPort(rest: string): { host: string; port?: string } | null {
  if (rest.startsWith("[")) {
    const m = /^\[([^\]]+)\](?::(.*))?$/.exec(rest);
    return m ? { host: m[1], port: m[2] } : null;
  }
  const colons = rest.split(":").length - 1;
  if (colons > 1) return { host: rest };
  const [host, port] = colons === 1 ? rest.split(":") : [rest, undefined];
  return host ? { host, port } : null;
}

function parsePort(text: string): number | null {
  if (!/^\d{1,5}$/.test(text)) return null;
  const port = Number(text);
  return port >= 1 && port <= 65535 ? port : null;
}

/** Ephemeral, unsaved Connection for an SSH quick-connect target. */
export function buildQuickConnectConnection(
  intent: Extract<QuickConnectTarget, { kind: "ssh" }>,
): Connection {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    name: `${intent.user}@${intent.host}`,
    host: intent.host,
    port: intent.port,
    username: intent.user,
    auth_type: "password",
    tags: [],
    vault_id: "personal",
    created_at: now,
    updated_at: now,
    last_used_at: null,
    clocks: {},
  };
}
