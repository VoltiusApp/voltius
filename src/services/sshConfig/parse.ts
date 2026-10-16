import type { ImportNotice } from "@/services/import-export/formats";

export interface SshConfigHost {
  alias: string;
  otherAliases?: string[];
  hostname: string;
  port: number;
  user?: string;
  identityFile?: string;
  proxyJump?: string;
  proxyCommand?: true;
}

export interface IncludedFile {
  path: string;
  text: string | null;
  refused?: boolean;
}

export type IncludeResolver = (pattern: string) => IncludedFile[] | null;

export interface ParsedSshConfig {
  hosts: SshConfigHost[];
  skipped: ImportNotice[];
}

const MAX_INCLUDE_DEPTH = 16;
const KEYS = ["hostname", "user", "port", "identityfile", "proxyjump", "proxycommand"] as const;
type Key = (typeof KEYS)[number];

interface Block {
  patterns: string[];
  match: boolean;
}

interface Directive {
  key: Key;
  value: string;
  block: Block | null;
}

const WILDCARD = /[*?!]/;

const isSet = (v: string | undefined): v is string => !!v && v.toLowerCase() !== "none";

// Tokenises like `args` in src-tauri/src/commands/openssh.rs, which resolves the same Include patterns.
const splitArgs = (v: string) => [...v.matchAll(/"([^"]*)"?|(\S+)/g)].map((m) => m[1] ?? m[2]);

function parseLine(raw: string): { key: string; value: string } | null {
  const line = raw.trim();
  if (!line || line.startsWith("#")) return null;
  const m = line.match(/^([A-Za-z]+)\s*(?:=\s*|\s+)(.*)$/);
  return m ? { key: m[1].toLowerCase(), value: m[2].trim() } : null;
}

function matchesPattern(pattern: string, name: string): boolean {
  const source = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".");
  return new RegExp(`^${source}$`, "i").test(name);
}

function blockApplies(block: Block | null, alias: string): boolean {
  if (!block) return true;
  if (block.match) return false;
  let hit = false;
  for (const p of block.patterns) {
    if (p.startsWith("!")) {
      if (matchesPattern(p.slice(1), alias)) return false;
    } else if (matchesPattern(p, alias)) {
      hit = true;
    }
  }
  return hit;
}

export function normalizeIdentityPath(value: string): string | null {
  if (value.toLowerCase() === "none") return null;
  const path = value.replace(/^%d(?=[/\\]|$)/, "~");
  if (path.includes("%")) return null;
  if (path.startsWith("~") || path.startsWith("/") || /^[A-Za-z]:[\\/]/.test(path)) return path;
  return `~/.ssh/${path}`;
}

function validPort(value: string | undefined): number {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 && n < 65536 ? n : 22;
}

export function parseSshConfig(text: string, include?: IncludeResolver): ParsedSshConfig {
  const directives: Directive[] = [];
  const groups: string[][] = [];
  const declared = new Set<string>();
  const skipped: ImportNotice[] = [];
  const skip = (notice: ImportNotice) => {
    if (!skipped.some((s) => s.kind === notice.kind && s.text === notice.text)) skipped.push(notice);
  };

  const walk = (source: string, outer: Block | null, depth: number, seen: ReadonlySet<string>) => {
    let block = outer;
    for (const raw of source.replace(/^\uFEFF/, "").split(/\r?\n/)) {
      const line = parseLine(raw);
      if (!line) continue;
      if (line.key === "host") {
        const patterns = splitArgs(line.value);
        block = { patterns, match: false };
        const names = patterns.filter((p) => !WILDCARD.test(p));
        const fresh = [...new Set(names)].filter((n) => !declared.has(n));
        fresh.forEach((n) => declared.add(n));
        if (fresh.length > 0) groups.push(fresh);
        if (names.length === 0 && line.value !== "*") skip({ kind: "pattern", text: `Host ${line.value}` });
      } else if (line.key === "match") {
        block = { patterns: [], match: true };
        skip({ kind: "match", text: `Match ${line.value}` });
      } else if (line.key === "include") {
        for (const pattern of splitArgs(line.value)) {
          const files = depth < MAX_INCLUDE_DEPTH ? include?.(pattern) ?? null : null;
          if (!files) {
            skip({ kind: "include", text: `Include ${pattern}` });
            continue;
          }
          for (const file of files) {
            if (file.refused) skip({ kind: "includeOutside", text: `Include ${file.path}` });
            else if (file.text === null || seen.has(file.path)) skip({ kind: "include", text: `Include ${file.path}` });
            else walk(file.text, block, depth + 1, new Set([...seen, file.path]));
          }
        }
      } else if ((KEYS as readonly string[]).includes(line.key)) {
        directives.push({ key: line.key as Key, value: line.key === "proxycommand" ? line.value : splitArgs(line.value)[0] ?? "", block });
      }
    }
  };
  walk(text, null, 0, new Set());

  const hosts = groups.map(([alias, ...otherAliases]): SshConfigHost => {
    const opts = new Map<Key, string>();
    for (const d of directives) if (!opts.has(d.key) && blockApplies(d.block, alias)) opts.set(d.key, d.value);
    const rawIdentity = opts.get("identityfile");
    const identityFile = rawIdentity ? normalizeIdentityPath(rawIdentity) : null;
    if (rawIdentity && identityFile === null && rawIdentity.toLowerCase() !== "none") skip({ kind: "key", text: rawIdentity });
    const user = opts.get("user");
    const jump = opts.get("proxyjump");
    const command = opts.get("proxycommand");
    return {
      alias,
      ...(otherAliases.length > 0 && { otherAliases }),
      hostname: (opts.get("hostname") ?? alias).replace(/%h/g, alias),
      port: validPort(opts.get("port")),
      ...(user && { user }),
      ...(identityFile && { identityFile }),
      ...(isSet(jump) && { proxyJump: jump }),
      ...(isSet(command) && { proxyCommand: true as const }),
    };
  });
  return { hosts, skipped };
}
