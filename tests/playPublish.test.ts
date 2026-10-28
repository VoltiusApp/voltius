import { describe, expect, it } from "vitest";
import { createVerify, generateKeyPairSync } from "node:crypto";
// @ts-expect-error plain .mjs script without type declarations
import { accessToken, publish } from "../scripts/store/play-publish.mjs";

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const account = {
  client_email: "ci@voltius.iam.gserviceaccount.com",
  private_key: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
  token_uri: "https://oauth2.googleapis.com/token",
};

type Call = { method: string; url: string; body: unknown; headers: Record<string, string> };

function fakePlay(fail?: (c: Call) => boolean) {
  const calls: Call[] = [];
  const fetchImpl = async (url: string, init: { method: string; body?: unknown; headers?: Record<string, string> }) => {
    const call = { method: init.method, url, body: init.body, headers: init.headers ?? {} };
    calls.push(call);
    const json = (status: number, data: unknown) =>
      new Response(data === null ? "" : JSON.stringify(data), { status });
    if (fail?.(call)) return json(403, { error: "nope" });
    if (url.endsWith("/token")) return json(200, { access_token: "tok" });
    if (url.endsWith("/edits") && init.method === "POST") return json(200, { id: "e1" });
    if (url.includes("/bundles?uploadType=media")) return json(200, { versionCode: 63002 });
    return json(200, {});
  };
  return { calls, fetchImpl };
}

describe("accessToken", () => {
  it("exchanges a correctly signed RS256 assertion for the androidpublisher scope", async () => {
    const { calls, fetchImpl } = fakePlay();
    expect(await accessToken(account, fetchImpl)).toBe("tok");
    const assertion = new URLSearchParams(String(calls[0].body)).get("assertion")!;
    const [head, claims, sig] = assertion.split(".");
    expect(createVerify("RSA-SHA256").update(`${head}.${claims}`).verify(publicKey, sig, "base64url")).toBe(true);
    const c = JSON.parse(Buffer.from(claims, "base64url").toString());
    expect(c).toMatchObject({ iss: account.client_email, aud: account.token_uri, scope: "https://www.googleapis.com/auth/androidpublisher" });
    expect(c.exp - c.iat).toBe(3600);
  });
});

describe("publish", () => {
  const args = { account, packageName: "com.voltius.app", aab: Buffer.from("aab"), track: "alpha", name: "0.64.0", notes: "• New" };

  it("uploads, releases on the track with notes, then commits the edit", async () => {
    const { calls, fetchImpl } = fakePlay();
    expect(await publish({ ...args, fetchImpl })).toBe(63002);
    const app = "https://androidpublisher.googleapis.com/androidpublisher/v3/applications/com.voltius.app";
    expect(calls.slice(1).map((c) => `${c.method} ${c.url}`)).toEqual([
      `POST ${app}/edits`,
      "POST https://androidpublisher.googleapis.com/upload/androidpublisher/v3/applications/com.voltius.app/edits/e1/bundles?uploadType=media",
      `PUT ${app}/edits/e1/tracks/alpha`,
      `POST ${app}/edits/e1:commit`,
    ]);
    expect(calls[2].headers["Content-Type"]).toBe("application/octet-stream");
    expect(JSON.parse(String(calls[3].body))).toEqual({
      track: "alpha",
      releases: [{ name: "0.64.0", versionCodes: ["63002"], status: "completed", releaseNotes: [{ language: "en-US", text: "• New" }] }],
    });
  });

  it("deletes the edit and rethrows when a step fails", async () => {
    const { calls, fetchImpl } = fakePlay((c) => c.method === "PUT");
    await expect(publish({ ...args, fetchImpl })).rejects.toThrow(/PUT .*tracks\/alpha: 403/);
    expect(calls.at(-1)).toMatchObject({ method: "DELETE" });
    expect(calls.some((c) => c.url.endsWith(":commit"))).toBe(false);
  });
});
