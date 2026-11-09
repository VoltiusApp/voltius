import { GRANT_SECRET_RE } from "@/services/deepLinkUrl";
import { base64UrlToBytes, bytesToBase64Url } from "@/utils/base64";
import { canonicalServerUrl } from "@/utils/serverInstance";

const PREFIX = "vte1";
const ID_RE = /^[0-9a-f]{32}$/;

export interface EnrollmentTokenParts {
  serverUrl: string;
  id: string;
  secret: string;
}

function decodeUtf8(bytes: Uint8Array | null): string | null {
  if (!bytes) return null;
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

export function buildEnrollmentToken(serverUrl: string, id: string, secret: string): string {
  const canonical = canonicalServerUrl(serverUrl);
  if (!canonical) throw new Error("server URL must be http(s)");
  return [PREFIX, bytesToBase64Url(new TextEncoder().encode(canonical)), id.replace(/-/g, ""), secret].join(".");
}

export function parseEnrollmentToken(text: string): EnrollmentTokenParts | null {
  const parts = text.trim().split(".");
  if (parts.length !== 4 || parts[0] !== PREFIX) return null;
  const [, encodedUrl, id, secret] = parts;
  if (!ID_RE.test(id) || !GRANT_SECRET_RE.test(secret)) return null;
  const serverUrl = encodedUrl ? decodeUtf8(base64UrlToBytes(encodedUrl)) : null;
  if (!serverUrl) return null;
  try {
    const { protocol } = new URL(serverUrl);
    if (protocol !== "https:" && protocol !== "http:") return null;
  } catch {
    return null;
  }
  return { serverUrl, id, secret };
}
