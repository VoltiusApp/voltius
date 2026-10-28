// Publishes a signed .aab to a Google Play track through the Play Developer API.
//   PLAY_SERVICE_ACCOUNT_JSON=... node scripts/store/play-publish.mjs \
//     --package com.voltius.app --aab app.aab --track alpha --name 0.64.0 --notes notes.txt [--language en-US]
import { createSign } from "node:crypto";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

const API = "https://androidpublisher.googleapis.com";
const SCOPE = "https://www.googleapis.com/auth/androidpublisher";

const b64url = (data) => Buffer.from(data).toString("base64url");

export async function accessToken(account, fetchImpl = fetch) {
  const aud = account.token_uri ?? "https://oauth2.googleapis.com/token";
  const now = Math.floor(Date.now() / 1000);
  const unsigned = `${b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }))}.${b64url(
    JSON.stringify({ iss: account.client_email, scope: SCOPE, aud, iat: now, exp: now + 3600 }),
  )}`;
  const signature = createSign("RSA-SHA256").update(unsigned).sign(account.private_key, "base64url");
  const res = await fetchImpl(aud, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${unsigned}.${signature}` }),
  });
  if (!res.ok) throw new Error(`token: ${res.status} ${await res.text()}`);
  return (await res.json()).access_token;
}

/** Uploads the bundle and releases it on `track` in one edit; returns the version code Play assigned. */
export async function publish({ account, packageName, aab, track, name, notes, language = "en-US", fetchImpl = fetch }) {
  const token = await accessToken(account, fetchImpl);
  const call = async (method, path, body, contentType = "application/json") => {
    const res = await fetchImpl(`${API}${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": contentType } : {}) },
      body: body && contentType === "application/json" ? JSON.stringify(body) : body,
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`${method} ${path}: ${res.status} ${text}`);
    return text ? JSON.parse(text) : null;
  };

  const app = `/androidpublisher/v3/applications/${packageName}`;
  const edit = (await call("POST", `${app}/edits`, {})).id;
  try {
    const { versionCode } = await call(
      "POST",
      `/upload${app}/edits/${edit}/bundles?uploadType=media`,
      aab,
      "application/octet-stream",
    );
    await call("PUT", `${app}/edits/${edit}/tracks/${track}`, {
      track,
      releases: [
        {
          name,
          versionCodes: [String(versionCode)],
          status: "completed",
          ...(notes ? { releaseNotes: [{ language, text: notes }] } : {}),
        },
      ],
    });
    await call("POST", `${app}/edits/${edit}:commit`);
    return versionCode;
  } catch (err) {
    await call("DELETE", `${app}/edits/${edit}`).catch(() => {});
    throw err;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const { values: o } = parseArgs({
    options: {
      package: { type: "string" },
      aab: { type: "string" },
      track: { type: "string" },
      name: { type: "string" },
      notes: { type: "string" },
      language: { type: "string", default: "en-US" },
    },
  });
  const versionCode = await publish({
    account: JSON.parse(process.env.PLAY_SERVICE_ACCOUNT_JSON),
    packageName: o.package,
    aab: readFileSync(o.aab),
    track: o.track,
    name: o.name,
    notes: o.notes ? readFileSync(o.notes, "utf8").trim() : "",
    language: o.language,
  });
  console.log(`Released ${o.name} (version code ${versionCode}) on the ${o.track} track of ${o.package}.`);
}
