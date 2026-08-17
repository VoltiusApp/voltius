/**
 * Server-resolved short invite codes. This mirrors the server's normalizer
 * (`src/session_grants.rs`) exactly — a code the server accepts must normalize
 * to the same 10 symbols here, or a guest who typed it correctly is refused.
 */

const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const CODE_LENGTH = 10;

export function normalizeShortCode(input: string): string | null {
  let normalized = "";
  for (const raw of input) {
    if (/\s/.test(raw) || raw === "-") continue;
    const upper = raw.toUpperCase();
    normalized += upper === "I" || upper === "L" ? "1" : upper === "O" ? "0" : upper;
  }
  if (normalized.length !== CODE_LENGTH) return null;
  for (const symbol of normalized) {
    if (!ALPHABET.includes(symbol)) return null;
  }
  return normalized;
}

export function isShortCode(value: string): boolean {
  return normalizeShortCode(value) !== null;
}

export function formatShortCode(code: string): string {
  const normalized = normalizeShortCode(code);
  if (!normalized) return code;
  return `${normalized.slice(0, 4)}-${normalized.slice(4, 8)}-${normalized.slice(8)}`;
}
