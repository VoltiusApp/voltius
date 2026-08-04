export type SecretKind = "privateKey" | "credential" | "token" | "host";

export interface SecretFinding {
  kind: SecretKind;
  match: string;
}

/** A `{{var}}` placeholder is the whole point of snippet variables — never a leak. */
const PLACEHOLDER = /^\{\{.*\}\}$/;

/** Loopback, RFC1918 and link-local addresses say nothing about the author. */
function isPrivateAddress(ip: string): boolean {
  const [a, b] = ip.split(".").map(Number);
  return a === 127 || a === 10 || a === 0
    || (a === 192 && b === 168)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 169 && b === 254);
}

const RULES: { kind: SecretKind; re: RegExp; value?: (m: RegExpExecArray) => string; skip?: (v: string) => boolean }[] = [
  { kind: "privateKey", re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/g },
  {
    kind: "credential",
    re: /\b(?:password|passwd|pwd|secret|api[_-]?key|access[_-]?key)\b\s*[=:]\s*("[^"]+"|'[^']+'|\S+)/gi,
    value: m => m[1],
    skip: v => PLACEHOLDER.test(v.replace(/^["']|["']$/g, "")),
  },
  {
    kind: "token",
    re: /\b(?:Bearer\s+[A-Za-z0-9._-]{12,}|gh[pousr]_[A-Za-z0-9]{16,}|xox[baprs]-[A-Za-z0-9-]{10,}|eyJ[A-Za-z0-9._-]{20,})/g,
  },
  {
    kind: "host",
    re: /\b(?:\d{1,3}\.){3}\d{1,3}\b/g,
    skip: isPrivateAddress,
  },
  {
    // Multi-label hostnames only: a bare "backup.sh" or "file.tar.gz" is not infrastructure.
    kind: "host",
    re: /\b(?:[a-z0-9-]+\.){2,}[a-z]{2,}\b/gi,
    skip: v => /\.(sh|gz|tar|zip|log|conf|json|ya?ml|txt|py|js|ts|sql|bak|pem|crt|key|service|socket)$/i.test(v),
  },
];

/** Advisory only — it warns, it never blocks. Sharing a snippet with your own
 *  infrastructure baked into it is the likeliest real harm in publishing. */
export function scanForSecrets(text: string): SecretFinding[] {
  const found: SecretFinding[] = [];
  const seen = new Set<string>();

  for (const rule of RULES) {
    rule.re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = rule.re.exec(text)) !== null) {
      const value = rule.value ? rule.value(m) : m[0];
      if (rule.skip?.(value)) continue;
      const key = `${rule.kind}:${value}`;
      if (seen.has(key)) continue;
      seen.add(key);
      found.push({ kind: rule.kind, match: m[0] });
    }
  }
  return found;
}

/** Every finding across a snippet's steps, keyed by nothing — callers show the list. */
export function scanSteps(steps: { kind: string; content?: string; from_path?: string; to_path?: string }[]): SecretFinding[] {
  const text = steps
    .map(s => s.kind === "script" ? (s.content ?? "") : `${s.from_path ?? ""} ${s.to_path ?? ""}`)
    .join("\n");
  return scanForSecrets(text);
}
