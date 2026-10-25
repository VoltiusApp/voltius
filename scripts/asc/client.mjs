// Minimal App Store Connect API client, for the asc workflow.
// Reads the API key from APPLE_API_KEY (key id), APPLE_API_ISSUER and
// APPLE_API_KEY_P8 (the .p8 contents), the secrets release.yml already uses.
import { createPrivateKey, sign } from "node:crypto";

const keyId = process.env.APPLE_API_KEY;
const issuer = process.env.APPLE_API_ISSUER;
const p8 = process.env.APPLE_API_KEY_P8;
if (!keyId || !issuer || !p8) throw new Error("APPLE_API_KEY, APPLE_API_ISSUER and APPLE_API_KEY_P8 are required");
const key = createPrivateKey(p8.includes("\n") ? p8 : p8.replace(/\\n/g, "\n"));

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
function token() {
  const now = Math.floor(Date.now() / 1000);
  const head = b64({ alg: "ES256", kid: keyId, typ: "JWT" });
  const body = b64({ iss: issuer, iat: now, exp: now + 1100, aud: "appstoreconnect-v1" });
  const sig = sign("sha256", Buffer.from(`${head}.${body}`), { key, dsaEncoding: "ieee-p1363" });
  return `${head}.${body}.${sig.toString("base64url")}`;
}

export async function asc(method, path, body) {
  const res = await fetch(`https://api.appstoreconnect.apple.com${path}`, {
    method,
    headers: { Authorization: `Bearer ${token()}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }
  if (!res.ok) {
    const err = new Error(`${method} ${path} -> ${res.status}: ${JSON.stringify(json?.errors ?? json)}`);
    err.status = res.status;
    throw err;
  }
  return json;
}

export const get = (path) => asc("GET", path);

/** The Voltius SSH app record. */
export async function app(bundleId = "app.voltius") {
  const r = await get(`/v1/apps?filter[bundleId]=${bundleId}`);
  if (!r.data.length) throw new Error(`no app with bundle id ${bundleId}`);
  return r.data[0];
}
