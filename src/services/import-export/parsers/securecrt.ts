import i18n from "@/i18n";
import { invoke } from "@/lib/invoke";
import { importedBundle, isSecureCrtXml } from "../formats";
import type { ConnectionExport, ExportBundle, FolderExport, ImportOutcome, JumpHostExport, KeyExport } from "../formats";
import { pruneUnusedFolders, serialConnection } from "./common";
import type { SerialSettings } from "./common";

type Value = string | number | string[];
type Options = Map<string, Value>;

interface Session {
  path: string[];
  opts: Options;
}

interface Config {
  sessions: Session[];
  globalIdentity?: string;
  verifier?: string;
  files: Map<string, string>;
}

interface RawFile {
  path: string;
  text: string;
}

interface RawConfig {
  sessions: RawFile[];
  global: string | null;
  ssh2: string | null;
  files: RawFile[];
}

const IDENTITY = "Identity Filename V2";
const OPTION_LINE = /^([SDZB]):"([^"]+)"=(.*)$/;
const TEMPLATE = /^Default(_\w+)?$/;

const str = (o: Options, k: string) => (typeof o.get(k) === "string" ? (o.get(k) as string) : undefined);
const num = (o: Options, k: string) => (typeof o.get(k) === "number" ? (o.get(k) as number) : undefined);

function optionsFromIni(text: string): Options {
  const opts: Options = new Map();
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const m = OPTION_LINE.exec(lines[i]);
    if (!m) continue;
    const [, type, name, raw] = m;
    if (type === "S") opts.set(name, raw);
    else if (type === "D") opts.set(name, parseInt(raw, 16));
    else if (type === "Z") {
      const count = parseInt(raw, 16) || 0;
      opts.set(name, lines.slice(i + 1, i + 1 + count).map((l) => l.replace(/^ /, "")));
      i += count;
    }
  }
  return opts;
}

function optionsFromXml(key: Element): Options {
  const opts: Options = new Map();
  for (const el of Array.from(key.children)) {
    const name = el.getAttribute("name");
    if (name === null) continue;
    if (el.tagName === "string") opts.set(name, el.textContent ?? "");
    else if (el.tagName === "dword") opts.set(name, Number(el.textContent));
    else if (el.tagName === "array") opts.set(name, Array.from(el.children, (c) => c.textContent ?? ""));
  }
  return opts;
}

const childKey = (parent: Element | null | undefined, name: string) =>
  Array.from(parent?.children ?? []).find((c) => c.tagName === "key" && c.getAttribute("name") === name);

function xmlSessions(key: Element, path: string[], out: Session[]) {
  for (const child of Array.from(key.children)) {
    if (child.tagName !== "key") continue;
    const childPath = [...path, child.getAttribute("name") ?? ""];
    const opts = optionsFromXml(child);
    if (opts.get("Is Session") === 1) out.push({ path: childPath, opts });
    else xmlSessions(child, childPath, out);
  }
}

const hexToText = (hex: string) =>
  new TextDecoder().decode(Uint8Array.from(hex.trim().split(/\s+/).filter(Boolean), (b) => parseInt(b, 16)));

function configFromXml(text: string): Config {
  const root = new DOMParser().parseFromString(text, "application/xml").documentElement;
  if (root.tagName !== "VanDyke") throw new Error(i18n.t("common.error.couldNotDetectFormat"));
  const sessions: Session[] = [];
  const sessionsKey = childKey(root, "Sessions");
  if (sessionsKey) xmlSessions(sessionsKey, [], sessions);
  const files = new Map<string, string>();
  for (const file of Array.from(childKey(root, "Files")?.children ?? [])) {
    const opts = optionsFromXml(file);
    const path = str(opts, "Path");
    const contents = file.querySelector('binary[name="Contents"]')?.textContent;
    if (path && contents) files.set(path, hexToText(contents));
  }
  return {
    sessions,
    files,
    globalIdentity: str(optionsFromXml(childKey(root, "SSH2") ?? root), IDENTITY),
    verifier: str(optionsFromXml(childKey(root, "Security") ?? root), "Passphrase"),
  };
}

// A lone session file does not carry its own name; the host stands in for it.
function configFromIni(text: string): Config {
  const opts = optionsFromIni(text);
  const name = str(opts, "Hostname") || platformOption(opts, "Com Port") || "SecureCRT";
  return { sessions: [{ path: [String(name)], opts }], files: new Map() };
}

function configFromRaw(raw: RawConfig): Config {
  return {
    sessions: raw.sessions.map((s) => ({ path: s.path.split("/"), opts: optionsFromIni(s.text) })),
    files: new Map(raw.files.map((f) => [f.path, f.text])),
    globalIdentity: raw.ssh2 ? str(optionsFromIni(raw.ssh2), IDENTITY) : undefined,
    verifier: raw.global ? str(optionsFromIni(raw.global), "Config Passphrase") : undefined,
  };
}

// Serial keys carry the OS that wrote them ("Linux Com Port"); printer settings reuse the same names.
function platformOption(o: Options, name: string): Value | undefined {
  if (o.has(name)) return o.get(name);
  for (const [k, v] of o) {
    if (k.endsWith(` ${name}`) && k.indexOf(" ") === k.length - name.length - 1) return v;
  }
  return undefined;
}

const PARITY: SerialSettings["parity"][] = ["none", "odd", "even"];

function serialSettings(o: Options): SerialSettings | undefined {
  const port = platformOption(o, "Com Port");
  if (typeof port !== "string" || !port) return undefined;
  const n = (name: string) => Number(platformOption(o, name) ?? 0);
  return {
    port,
    baud: n("Baud Rate") || 9600,
    dataBits: n("Data Bits") || 8,
    parity: PARITY[n("Parity")] ?? "none",
    stopBits: n("Stop Bits") === 2 ? 2 : 1,
    rtsCts: n("CTS Flow") !== 0,
    xonXoff: n("XON Flow") !== 0,
  };
}

interface Built {
  connection: ConnectionExport;
  session: Session;
  password?: string;
}

function identityOf(o: Options, globalIdentity: string | undefined): string | undefined {
  return (num(o, "Use Global Public Key") === 0 ? str(o, IDENTITY) : globalIdentity) || undefined;
}

function toConnection(s: Session, cfg: Config, keyEid: (path: string) => string | undefined): Built | undefined {
  const o = s.opts;
  const name = s.path[s.path.length - 1];
  const description = o.get("Description");
  const notes = Array.isArray(description) ? description.join("\n").trim() || undefined : undefined;
  const protocol = str(o, "Protocol Name");
  if (protocol === "Serial") return { connection: serialConnection(name, notes, serialSettings(o)), session: s };
  if (protocol !== "SSH2" && protocol !== "SSH1") return undefined;
  const host = str(o, "Hostname");
  if (!host) return undefined;
  const identity = identityOf(o, cfg.globalIdentity);
  const keyRef = identity && keyEid(identity);
  const encrypted = num(o, "Session Password Saved") === 1 ? str(o, "Password V2") : undefined;
  return {
    session: s,
    password: encrypted || undefined,
    connection: {
      name,
      host,
      port: num(o, `[${protocol}] Port`) || 22,
      username: str(o, "Username") ?? "",
      auth_type: identity ? "key" : "password",
      tags: [],
      connection_type: "ssh",
      ...(keyRef && { _key_eid: keyRef }),
      ...(notes && { notes }),
    },
  };
}

function buildKeys(cfg: Config) {
  const keys: KeyExport[] = [];
  const eidByPath = new Map<string, string>();
  for (const [path, text] of cfg.files) {
    if (!text.includes("PRIVATE KEY") && !text.startsWith("PuTTY-User-Key-File")) continue;
    const eid = `sk${keys.length}`;
    eidByPath.set(path, eid);
    keys.push({ _eid: eid, name: path.split(/[\\/]/).pop() || path, private_key: text, tags: [] });
  }
  return { keys, keyEid: (path: string) => eidByPath.get(path) };
}

function buildFolders(sessions: Session[]) {
  const folders: FolderExport[] = [];
  const eidByPath = new Map<string, string>();
  const folderEid = (path: string[]): string | undefined => {
    if (!path.length) return undefined;
    const key = path.join("/");
    let eid = eidByPath.get(key);
    if (!eid) {
      const parent = folderEid(path.slice(0, -1));
      eid = `sf${folders.length}`;
      eidByPath.set(key, eid);
      folders.push({ _eid: eid, name: path[path.length - 1], object_type: "connection", ...(parent && { parent_folder_eid: parent }) });
    }
    return eid;
  };
  for (const s of sessions) folderEid(s.path.slice(0, -1));
  return { folders, folderEidOf: (s: Session) => folderEid(s.path.slice(0, -1)) };
}

// "Session:<path>" names another session as the jump host; any other firewall is a proxy we do not import.
function jumpHost(s: Session, built: Built[], eidOf: Map<Built, string>): JumpHostExport[] | undefined {
  const target = str(s.opts, "Firewall Name")?.match(/^session:(.+)$/i)?.[1].replace(/\\/g, "/");
  if (!target) return undefined;
  const hop = built.find((b) => b.session.path.join("/") === target)
    ?? built.find((b) => b.session.path[b.session.path.length - 1] === target);
  if (!hop || hop.connection.connection_type !== "ssh") return undefined;
  return [{
    id: crypto.randomUUID(),
    host: hop.connection.host ?? "",
    port: hop.connection.port ?? 22,
    username: hop.connection.username ?? "",
    _connection_eid: eidOf.get(hop),
  }];
}

interface Parsed {
  bundle: ExportBundle;
  passwords: { index: number; value: string }[];
  verifier?: string;
}

function parseConfig(cfg: Config): Parsed {
  const sessions = cfg.sessions.filter((s) => !(s.path.length === 1 && TEMPLATE.test(s.path[0])));
  const { keys, keyEid } = buildKeys(cfg);
  const built = sessions.flatMap((s) => toConnection(s, cfg, keyEid) ?? []);
  const eidOf = new Map(built.map((b, i) => [b, `sc${i}`]));
  const { folders, folderEidOf } = buildFolders(built.map((b) => b.session));
  const connections = built.map((b) => {
    const jump = jumpHost(b.session, built, eidOf);
    return { ...b.connection, _eid: eidOf.get(b), _folder_eid: folderEidOf(b.session), ...(jump && { jump_hosts: jump }) };
  });
  const usedKeys = new Set(connections.map((c) => c._key_eid));
  return {
    bundle: importedBundle({
      folders: pruneUnusedFolders(folders, connections),
      connections,
      keys: keys.filter((k) => usedKeys.has(k._eid)),
    }),
    passwords: built.flatMap((b, index) => (b.password ? [{ index, value: b.password }] : [])),
    verifier: cfg.verifier,
  };
}

interface Decrypted {
  passphrase_ok: boolean;
  values: (string | null)[];
}

async function withPasswords(p: Parsed, passphrase: string): Promise<ExportBundle | undefined> {
  const res = await invoke<Decrypted>("securecrt_decrypt", {
    values: p.passwords.map((s) => s.value),
    verifier: p.verifier ?? null,
    passphrase,
  });
  if (!res.passphrase_ok) return undefined;
  const connections = [...p.bundle.connections];
  p.passwords.forEach(({ index }, i) => {
    const password = res.values[i];
    if (password) connections[index] = { ...connections[index], password };
  });
  return { ...p.bundle, connections };
}

async function unlockOrAsk(p: Parsed): Promise<ImportOutcome> {
  if (!p.passwords.length) return p.bundle;
  const open = await withPasswords(p, "");
  if (open) return open;
  return {
    kind: "securecrt",
    unlock: async (passphrase) => {
      const bundle = await withPasswords(p, passphrase);
      if (!bundle) throw new Error(i18n.t("common.error.wrongConfigPassphrase"));
      return bundle;
    },
    withoutSecrets: () => p.bundle,
  };
}

export function parseSecureCrt(text: string): Parsed {
  const t = text.trim();
  return parseConfig(isSecureCrtXml(t) ? configFromXml(t) : configFromIni(t));
}

export function bundleFromSecureCrt(text: string): Promise<ImportOutcome> {
  return unlockOrAsk(parseSecureCrt(text));
}

export async function extractSecureCrtBundle(dir?: string): Promise<ImportOutcome> {
  const raw = await invoke<RawConfig>("securecrt_read_config", { dir: dir ?? null });
  return unlockOrAsk(parseConfig(configFromRaw(raw)));
}
