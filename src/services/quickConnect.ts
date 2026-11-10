import type { Connection } from "@/types";

export type QuickConnectIntent =
  | { kind: "ssh"; user: string; host: string; port: number }
  | { kind: "web"; host: string; port: number; secure: boolean }
  | { kind: "serial"; port?: string }
  | { kind: "local"; shell?: string }
  | null;

const DEVICE_PATH_RE = /^(\/dev\/tty\S+|\/dev\/cu\.\S+|COM\d+)$/i;
const BARE_WORD_RE = /^[\w.-]+$/;

const WEB_RE = /^(https?)(?:\s*:\/\/|\s+)(\S+)$/i;

/** `host`, `host:port` or `[v6]:port`, with any path or query dropped; null when it is none of these. */
function parseWebTarget(target: string): { host: string; port?: number } | null {
  const authority = target.split(/[/?#]/, 1)[0];
  const m = /^\[([^\]]+)\](?::(\d+))?$/.exec(authority) ?? /^([^:\s]+)(?::(\d+))?$/.exec(authority);
  if (!m) return null;
  const port = m[2] === undefined ? undefined : parseInt(m[2], 10);
  if (port !== undefined && (port < 1 || port > 65535)) return null;
  return { host: m[1], port };
}

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

  // web: "https host:port" or "https://host:port" (checked before ssh, which reads any ":port")
  const webMatch = WEB_RE.exec(trimmed);
  if (webMatch) {
    const target = parseWebTarget(webMatch[2]);
    if (target) {
      const secure = webMatch[1].toLowerCase() === "https";
      return { kind: "web", host: target.host, port: target.port ?? (secure ? 443 : 80), secure };
    }
  }

  // ssh
  const hasSshPrefix = /^ssh\s+/i.test(trimmed);
  const body = hasSshPrefix ? trimmed.replace(/^ssh\s+/i, "") : trimmed;
  const looksLikeSsh =
    hasSshPrefix || body.includes("@") || /:\d+/.test(body) || /(^|\s)-p\s+\d+/.test(body);
  if (!looksLikeSsh) return null;

  const tokens = body.split(/\s+/).filter(Boolean);
  let flagPort: number | undefined;
  let target: string | undefined;
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t === "-p" && i + 1 < tokens.length) {
      const p = parseInt(tokens[i + 1], 10);
      if (!Number.isNaN(p)) flagPort = p;
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
  const rest = atIdx >= 0 ? target.slice(atIdx + 1) : target;
  const colonIdx = rest.indexOf(":");
  const host = colonIdx >= 0 ? rest.slice(0, colonIdx) : rest;
  const inlinePort = colonIdx >= 0 ? parseInt(rest.slice(colonIdx + 1), 10) : NaN;
  if (!host) return null;

  const port = flagPort ?? (Number.isNaN(inlinePort) ? 22 : inlinePort);
  return { kind: "ssh", user: user || "root", host, port };
}

/** Ephemeral, unsaved Connection for an SSH quick-connect target. */
export function buildQuickConnectConnection(
  intent: Extract<QuickConnectIntent, { kind: "ssh" }>,
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

/** Ephemeral, unsaved Connection for a web quick-connect target. */
export function buildWebQuickConnectConnection(
  intent: Extract<QuickConnectIntent, { kind: "web" }>,
): Connection {
  const now = new Date().toISOString();
  const defaultPort = intent.secure ? 443 : 80;
  return {
    id: crypto.randomUUID(),
    name: intent.port === defaultPort ? intent.host : `${intent.host}:${intent.port}`,
    host: intent.host,
    port: intent.port,
    username: "",
    auth_type: "password",
    tags: [],
    vault_id: "personal",
    created_at: now,
    updated_at: now,
    last_used_at: null,
    clocks: {},
    connection_type: "web",
    web_secure: intent.secure,
  };
}
