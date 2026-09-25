// btoa/atob work on "binary strings", one char per byte. Spreading a whole
// buffer into String.fromCharCode overflows the argument stack (RangeError)
// somewhere past ~100 KB, so the string is built in chunks.
const CHUNK = 8192;

export function bytesToBase64(bytes: Uint8Array | number[]): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.slice(i, i + CHUNK));
  }
  return btoa(binary);
}

export function base64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
