// Spreading a whole buffer into String.fromCharCode overflows the argument stack past ~100 KB.
const CHUNK = 8192;

export function bytesToBase64(bytes: Uint8Array | number[]): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...(bytes instanceof Uint8Array ? bytes.subarray(i, i + CHUNK) : bytes.slice(i, i + CHUNK)));
  }
  return btoa(binary);
}

export function base64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

const BASE64URL_RE = /^[A-Za-z0-9_-]*$/;

export function bytesToBase64Url(bytes: Uint8Array | number[]): string {
  return bytesToBase64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function base64UrlToBytes(text: string): Uint8Array<ArrayBuffer> | null {
  if (!BASE64URL_RE.test(text)) return null;
  try {
    const b64 = text.replace(/-/g, "+").replace(/_/g, "/");
    return base64ToBytes(b64.padEnd(Math.ceil(b64.length / 4) * 4, "="));
  } catch {
    return null;
  }
}

// Tauri commands take `Vec<u8>` as a JSON number array, which a Uint8Array does not serialize to.
export function base64ToByteArray(b64: string): number[] {
  return Array.from(base64ToBytes(b64));
}

export function hexToBytes(hex: string): number[] {
  const bytes: number[] = [];
  for (let i = 0; i < hex.length; i += 2) bytes.push(parseInt(hex.slice(i, i + 2), 16));
  return bytes;
}

export function bytesToHex(bytes: number[]): string {
  return bytes.map((b) => b.toString(16).padStart(2, "0")).join("");
}
