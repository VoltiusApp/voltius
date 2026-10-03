import { invoke } from "@/lib/invoke";
import { decodeLegacyText } from "@/utils/decodeLegacyText";
import { importedBundle } from "../formats";
import type { ConnectionExport, ExportBundle, FolderExport } from "../formats";
import { pruneUnusedFolders, serialConnection } from "./common";
import type { SerialSettings } from "./common";

const DEVICE_SERIAL = 1;
const DEVICE_SSH = 9;

type Entry = Map<string, string>;

const sectionOf = (e: Entry) => Number(e.get("section") ?? 0);

function unquote(raw: string): string {
  const v = raw.startsWith("utf8:") ? raw.slice(5) : raw;
  return v.length >= 2 && v.startsWith('"') && v.endsWith('"') ? v.slice(1, -1) : v;
}

function keyValue(line: string): [string, string] | undefined {
  const eq = line.indexOf("=");
  return eq > 0 ? [line.slice(0, eq), unquote(line.slice(eq + 1))] : undefined;
}

function splitHostPort(connectTo: string): { host: string; port?: number } {
  const v6 = connectTo.match(/^\[([^\]]+)\](?::(\d+))?$/);
  if (v6) return { host: v6[1], port: v6[2] ? Number(v6[2]) : undefined };
  const m = connectTo.match(/^([^:]+):(\d+)$/);
  return m ? { host: m[1], port: Number(m[2]) } : { host: connectTo };
}

const PARITY: Record<string, SerialSettings["parity"]> = { N: "none", E: "even", O: "odd" };

// deviceopts "[1]COM3:57600-8N1|<flag bits>|<break ms>"; bit 1 = RTS/CTS, bit 2 = XON/XOFF.
// A leading "-" means the session profile overrides these, but they are the best values the file holds.
function serialSettings(deviceOpts: string): SerialSettings | undefined {
  const m = deviceOpts.match(/^-?\[\d+\]([^:|]+):(\d+)-(\d)([NEOMS])(\d)(?:\|(\d+))?/);
  if (!m) return undefined;
  const flow = Number(m[6] ?? 0);
  return {
    port: m[1],
    baud: Number(m[2]),
    dataBits: Number(m[3]),
    parity: PARITY[m[4]] ?? "none",
    stopBits: Number(m[5]),
    rtsCts: (flow & 1) !== 0,
    xonXoff: (flow & 2) !== 0,
  };
}

interface Structure {
  sections: Map<number, string>;
  folders: Map<number, { section: number; parent: number; name: string }>;
}

function parseStructure(lines: string[]): Structure {
  const sections = new Map<number, string>();
  const folders: Structure["folders"] = new Map();
  for (const line of lines) {
    const section = line.match(/^Section#(\d+)=(.*)$/);
    if (section) sections.set(Number(section[1]), unquote(section[2]));
    const folder = line.match(/^Folder#(\d+)=(\d+)\.(\d+)(?:\.utf8)?\|(.*)$/);
    if (folder) folders.set(Number(folder[1]), { section: Number(folder[2]), parent: Number(folder[3]), name: folder[4] });
  }
  return { sections, folders };
}

function parseEntries(lines: string[]): Entry[] {
  const entries: Entry[] = [];
  let current: Entry | undefined;
  for (const line of lines) {
    if (line === "[HOST]") current = new Map();
    else if (line === "[/HOST]") { if (current) entries.push(current); current = undefined; }
    else if (current) {
      const kv = keyValue(line);
      if (kv) current.set(kv[0], kv[1]);
    }
  }
  return entries;
}

// Sections become top-level folders only when hosts actually span more than one.
function buildFolders(structure: Structure, entries: Entry[]) {
  const usedSections = new Set(entries.map(sectionOf));
  const withSectionFolders = usedSections.size > 1;
  const folders: FolderExport[] = [];
  const sectionEid = (s: number) => (withSectionFolders ? `zs${s}` : undefined);
  if (withSectionFolders) {
    for (const s of usedSections) {
      folders.push({ _eid: `zs${s}`, name: structure.sections.get(s) ?? `Section ${s}`, object_type: "connection" });
    }
  }
  for (const [handle, f] of structure.folders) {
    folders.push({
      _eid: `zf${handle}`,
      name: f.name,
      object_type: "connection",
      parent_folder_eid: f.parent && structure.folders.has(f.parent) ? `zf${f.parent}` : sectionEid(f.section),
    });
  }
  const folderEidOf = (e: Entry) => {
    const handle = Number(e.get("folder") ?? 0);
    return handle && structure.folders.has(handle) ? `zf${handle}` : sectionEid(sectionOf(e));
  };
  return { folders, folderEidOf };
}

function toConnection(e: Entry): ConnectionExport | undefined {
  const device = Number(e.get("deviceid") ?? 0);
  const name = e.get("name") || undefined;
  const notes = e.get("memo") || undefined;
  if (device === DEVICE_SERIAL) return serialConnection(name, notes, serialSettings(e.get("deviceopts") ?? ""));
  // 0 and -1 both mean "connection type from the session profile", which defaults to SSH.
  if (device !== DEVICE_SSH && device > 0) return undefined;
  const { host, port } = splitHostPort(e.get("connectto") ?? "");
  if (!host) return undefined;
  return {
    name,
    host,
    port: port ?? 22,
    username: e.get("username") ?? "",
    auth_type: e.get("authfile") ? "key" : "password",
    tags: [],
    connection_type: "ssh",
    ...(notes && { notes }),
  };
}

export function bundleFromZoc(text: string): ExportBundle {
  const lines = text.split(/\r?\n/).map((l) => l.trim());
  const structEnd = lines.indexOf("[/STRUCTURE]");
  const structure = parseStructure(structEnd >= 0 ? lines.slice(0, structEnd) : []);
  const imported = parseEntries(lines.slice(structEnd + 1)).flatMap((e) => {
    const c = toConnection(e);
    return c ? [{ e, c }] : [];
  });
  const { folders, folderEidOf } = buildFolders(structure, imported.map(({ e }) => e));
  const connections = imported.map(({ e, c }) => ({ ...c, _folder_eid: folderEidOf(e) }));
  return importedBundle({ folders: pruneUnusedFolders(folders, connections), connections });
}

export async function extractZocBundle(): Promise<ExportBundle> {
  return bundleFromZoc(decodeLegacyText(new Uint8Array(await invoke<number[]>("zoc_host_directory"))));
}
