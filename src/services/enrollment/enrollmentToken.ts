import { normalizeServerUrl } from "@/utils/serverInstance";

const PREFIX = "vte1";
const ID_RE = /^[0-9a-f]{32}$/;
const SECRET_RE = /^[A-Za-z0-9_-]{43}$/;
const B64URL_RE = /^[A-Za-z0-9_-]+$/;

export interface EnrollmentTokenParts {
  serverUrl: string;
  id: string;
  secret: string;
}

function encodeBase64Url(text: string): string {
  const binary = String.fromCharCode(...new TextEncoder().encode(text));
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function decodeBase64Url(text: string): string | null {
  if (!B64URL_RE.test(text)) return null;
  try {
    const b64 = text.replace(/-/g, "+").replace(/_/g, "/");
    const binary = atob(b64.padEnd(Math.ceil(b64.length / 4) * 4, "="));
    return new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(binary, (c) => c.charCodeAt(0)));
  } catch {
    return null;
  }
}

export function buildEnrollmentToken(serverUrl: string, id: string, secret: string): string {
  return [PREFIX, encodeBase64Url(normalizeServerUrl(serverUrl)), id.replace(/-/g, ""), secret].join(".");
}

export function parseEnrollmentToken(text: string): EnrollmentTokenParts | null {
  const parts = text.trim().split(".");
  if (parts.length !== 4 || parts[0] !== PREFIX) return null;
  const [, encodedUrl, id, secret] = parts;
  if (!ID_RE.test(id) || !SECRET_RE.test(secret)) return null;
  const serverUrl = decodeBase64Url(encodedUrl);
  if (!serverUrl) return null;
  try {
    const { protocol } = new URL(serverUrl);
    if (protocol !== "https:" && protocol !== "http:") return null;
  } catch {
    return null;
  }
  return { serverUrl, id, secret };
}
