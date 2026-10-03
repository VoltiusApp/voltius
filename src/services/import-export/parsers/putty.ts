import i18n from "@/i18n";
import { invoke } from "@/lib/invoke";
import { decodeLegacyText } from "@/utils/decodeLegacyText";
import { importedBundle } from "../formats";
import type { ConnectionExport, ExportBundle, FolderExport, JumpHostExport, PortForwardingRuleExport } from "../formats";
import type { ProxyMode } from "@/types";

interface Session {
  name: string;
  values: Map<string, string>;
}

const REG_SESSION_KEY = String.raw`\[[^\]]*?\\Software\\(?:SimonTatham\\PuTTY|9bis\.com\\KiTTY)\\Sessions\\([^\\\]]+)\]`;
const REG_SESSION = new RegExp(`^${REG_SESSION_KEY}$`, "i");
const REG_HEADER = /^(Windows Registry Editor Version 5\.00|REGEDIT4)/;
const TAIL_HEADER = /^==> (.*) <==$/;
const DEFAULT_SETTINGS = "Default Settings";
const KITTY_DEFAULT_FOLDER = "Default";

const PROXY_SOCKS4 = 1;
const PROXY_SSH_TCPIP = 6;
const PROXY_MODES: Partial<Record<number, ProxyMode>> = { 2: "socks5", 3: "http" };
// Older PuTTY's "ProxyType" values, re-indexed to "ProxyMethod".
const LEGACY_PROXY_METHODS = [0, 3, 2, 4, 5];

const PARITY = ["none", "odd", "even"];
const FLOW_CONTROL = ["none", "xon-xoff", "rts-cts"];

const num = (v: string | undefined, fallback: number) => (v !== undefined && v !== "" && !isNaN(Number(v)) ? Number(v) : fallback);

function unescapeName(escaped: string): string {
  const bytes: number[] = [];
  for (let i = 0; i < escaped.length; i++) {
    const hex = escaped[i] === "%" ? escaped.slice(i + 1, i + 3) : "";
    if (/^[0-9a-f]{2}$/i.test(hex)) {
      bytes.push(parseInt(hex, 16));
      i += 2;
    } else {
      bytes.push(...new TextEncoder().encode(escaped[i]));
    }
  }
  return decodeLegacyText(new Uint8Array(bytes));
}

const unescapeRegString = (s: string) => s.replace(/\\(.)/g, "$1");

function parseRegValue(raw: string): string | undefined {
  const str = raw.match(/^"((?:[^"\\]|\\.)*)"$/);
  if (str) return unescapeRegString(str[1]);
  const dword = raw.match(/^dword:([0-9a-f]{1,8})$/i);
  return dword ? String(parseInt(dword[1], 16)) : undefined;
}

function sessionsFromReg(lines: string[]): Session[] {
  const sessions: Session[] = [];
  let current: Session | undefined;
  for (const line of lines) {
    if (line.startsWith("[")) {
      const key = line.match(REG_SESSION);
      current = key ? { name: unescapeName(key[1]), values: new Map() } : undefined;
      if (current) sessions.push(current);
      continue;
    }
    const kv = line.match(/^"((?:[^"\\]|\\.)*)"=(.*)$/);
    const value = kv ? parseRegValue(kv[2]) : undefined;
    if (current && kv && value !== undefined) current.values.set(unescapeRegString(kv[1]), value);
  }
  return sessions;
}

// One file per session in ~/.putty/sessions, or several joined by `tail -n +1` / `head` headers.
function sessionsFromFiles(lines: string[]): Session[] {
  const sessions: Session[] = [];
  let current: Session | undefined;
  for (const line of lines.filter(Boolean)) {
    const header = line.match(TAIL_HEADER);
    if (header || !current) {
      current = { name: header ? unescapeName(header[1].split("/").pop()!) : "", values: new Map() };
      sessions.push(current);
      if (header) continue;
    }
    const eq = line.indexOf("=");
    if (eq > 0) current.values.set(line.slice(0, eq), line.slice(eq + 1));
  }
  return sessions;
}

// PuTTY's own list encoding (PortForwardings, Environment): `k=v,k=v`, with `\` escaping `,`, `=` and `\`.
function parseMap(raw: string | undefined): [string, string][] {
  const out: [string, string][] = [];
  if (!raw) return out;
  let key = "";
  let value: string | undefined;
  for (let i = 0; i <= raw.length; i++) {
    const c = raw[i];
    if (i === raw.length || c === ",") {
      if (key || value) out.push([key, value ?? ""]);
      key = "";
      value = undefined;
    } else if (c === "=" && value === undefined) {
      value = "";
    } else {
      const ch = c === "\\" ? (raw[++i] ?? "") : c;
      if (value === undefined) key += ch;
      else value += ch;
    }
  }
  return out;
}

function stripBrackets(host: string): string {
  return host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host;
}

function splitEndpoint(value: string): { host: string; port: number } | undefined {
  const m = value.match(/^(.*):(\d+)$/);
  return m ? { host: stripBrackets(m[1]), port: Number(m[2]) } : undefined;
}

// Mirrors PuTTY's prepare_session(): `user@` overrides UserName and a lone `:suffix` is dropped, not used as the port.
function splitHostName(raw: string): { host: string; user?: string } {
  let host = raw.trim();
  const at = host.lastIndexOf("@");
  const user = at >= 0 ? host.slice(0, at) : undefined;
  if (at >= 0) host = host.slice(at + 1);
  const bracketed = host.match(/^\[([^\]]*)\]/);
  if (bracketed) host = bracketed[1];
  else if (host.split(":").length === 2) host = host.slice(0, host.indexOf(":"));
  return { host: host.replace(/\s/g, ""), user };
}

function proxyMethod(v: Map<string, string>): number {
  const method = v.get("ProxyMethod");
  if (method !== undefined) return Number(method);
  const legacy = LEGACY_PROXY_METHODS[num(v.get("ProxyType"), 0)] ?? 0;
  return legacy === 2 && v.get("ProxySOCKSVersion") === "4" ? PROXY_SOCKS4 : legacy;
}

function serialFields(v: Map<string, string>): Partial<ConnectionExport> {
  return {
    serial_port: v.get("SerialLine") || undefined,
    serial_baud: num(v.get("SerialSpeed"), 9600),
    serial_data_bits: num(v.get("SerialDataBits"), 8),
    serial_parity: PARITY[num(v.get("SerialParity"), 0)] ?? "none",
    serial_stop_bits: num(v.get("SerialStopHalfbits"), 2) >= 4 ? 2 : 1,
    serial_flow_control: FLOW_CONTROL[num(v.get("SerialFlowControl"), 1)] ?? "none",
  };
}

function proxyFields(v: Map<string, string>): Partial<ConnectionExport> {
  const mode = PROXY_MODES[proxyMethod(v)];
  const host = v.get("ProxyHost");
  if (!mode || !host) return {};
  const username = v.get("ProxyUsername") || undefined;
  const password = v.get("ProxyPassword") || undefined;
  return {
    proxy: { mode, host, port: num(v.get("ProxyPort"), 80), ...(username && { username }) },
    ...(password && { proxy_password: password }),
  };
}

function toConnection(s: Session): ConnectionExport | undefined {
  const v = s.values;
  const name = s.name || undefined;
  const protocol = v.get("Protocol") ?? "ssh";
  if (protocol === "serial") return { name, tags: [], connection_type: "serial", ...serialFields(v) };
  if (protocol !== "ssh") return undefined;
  const { host, user } = splitHostName(v.get("HostName") ?? "");
  if (!host) return undefined;
  const envVars = parseMap(v.get("Environment")).map(([key, value]) => ({ id: crypto.randomUUID(), key, value }));
  return {
    name,
    host,
    port: num(v.get("PortNumber"), 22),
    username: user ?? v.get("UserName") ?? "",
    auth_type: v.get("PublicKeyFile") ? "key" : "password",
    tags: [],
    connection_type: "ssh",
    ...(v.get("AgentFwd") === "1" && { agent_forwarding: true }),
    ...(envVars.length && { env_vars: envVars }),
    ...proxyFields(v),
  };
}

// PuTTY treats ProxyHost as a saved session's name first, and only then as a host name.
function jumpHost(v: Map<string, string>, imported: Map<string, ConnectionExport>): JumpHostExport | undefined {
  if (proxyMethod(v) !== PROXY_SSH_TCPIP) return undefined;
  const proxyHost = v.get("ProxyHost") ?? "";
  const session = imported.get(proxyHost);
  const { host, user } = session ? { host: session.host ?? "", user: session.username } : splitHostName(proxyHost);
  if (!host) return undefined;
  return {
    id: crypto.randomUUID(),
    host,
    port: session?.port ?? num(v.get("ProxyPort"), 22),
    username: v.get("ProxyUsername") || user || "",
    ...(session && { _connection_eid: session._eid }),
  };
}

function portForwards(s: Session, connectionEid: string): PortForwardingRuleExport[] {
  const remoteBind = s.values.get("RemotePortAcceptAll") === "1" ? "0.0.0.0" : "127.0.0.1";
  return parseMap(s.values.get("PortForwardings")).flatMap(([key, value]) => {
    const m = key.match(/^[46]?([LRD])(?:(.+):)?(\d+)$/);
    if (!m) return [];
    const [, kind, bind, source] = m;
    const port = Number(source);
    const dest = splitEndpoint(value);
    const base = { name: `${s.name} ${kind}${source}`.trim(), bind_host: "127.0.0.1", _connection_eids: [connectionEid] };
    if (kind === "D") return [{ ...base, tunnel_type: "dynamic", local_port: port, remote_port: 0, remote_host: "", target_host: "" }];
    if (!dest) return [];
    return kind === "L"
      ? [{ ...base, tunnel_type: "local", local_port: port, remote_port: dest.port, remote_host: dest.host, target_host: dest.host }]
      : [{ ...base, tunnel_type: "remote", bind_host: bind ? stripBrackets(bind) : remoteBind, remote_port: port, local_port: dest.port, remote_host: dest.host, target_host: dest.host }];
  });
}

// KiTTY's flat "Folder" value; "Default" means none.
function kittyFolders(sessions: Session[]) {
  const names = [...new Set(sessions.map((s) => s.values.get("Folder") ?? ""))].filter((n) => n && n !== KITTY_DEFAULT_FOLDER);
  const folders: FolderExport[] = names.map((name, i) => ({ _eid: `pf${i}`, name, object_type: "connection" }));
  const eidByName = new Map(folders.map((f) => [f.name, f._eid]));
  return { folders, folderEidOf: (s: Session) => eidByName.get(s.values.get("Folder") ?? "") };
}

export function isPuttyExport(text: string): boolean {
  const head = text.trimStart().slice(0, 300);
  if (REG_HEADER.test(head)) return new RegExp(`^${REG_SESSION_KEY}\\r?$`, "im").test(text);
  return /^(==> .* <==\r?\n)?Present=1\r?\n/.test(head);
}

export function bundleFromPutty(text: string): ExportBundle {
  const lines = text.split(/\r?\n/).map((l) => l.trim());
  const sessions = (REG_HEADER.test(lines[0] ?? "") ? sessionsFromReg(lines) : sessionsFromFiles(lines)).filter((s) => s.name !== DEFAULT_SETTINGS);
  const imported = sessions.flatMap((s, i) => {
    const c = toConnection(s);
    return c ? [{ s, c: { ...c, _eid: `pc${i}` } }] : [];
  });
  const byName = new Map(imported.filter(({ c }) => c.connection_type === "ssh").map(({ s, c }) => [s.name, c]));
  const { folders, folderEidOf } = kittyFolders(imported.map(({ s }) => s));
  const connections = imported.map(({ s, c }) => {
    const jump = c.connection_type === "ssh" ? jumpHost(s.values, byName) : undefined;
    const folderEid = folderEidOf(s);
    return {
      ...c,
      ...(jump && jump._connection_eid !== c._eid && { jump_hosts: [jump] }),
      ...(folderEid && { _folder_eid: folderEid }),
    };
  });
  const portForwardingRules = imported.flatMap(({ s, c }) => (c.connection_type === "ssh" ? portForwards(s, c._eid) : []));
  return importedBundle({ folders, connections, portForwardingRules });
}

export async function extractPuttyBundle(): Promise<ExportBundle> {
  const bundle = bundleFromPutty(await invoke<string>("putty_sessions"));
  if (!bundle.connections.length) throw new Error(i18n.t("common.error.noPuttySessions"));
  return bundle;
}
