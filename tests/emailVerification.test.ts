import test from "node:test";
import assert from "node:assert/strict";
import {
  checkoutRequiresEmailVerification,
  readJwtEmailVerified,
} from "../src/utils/emailVerification.ts";

function jwtWithPayload(payload: Record<string, unknown>): string {
  const encoded = btoa(JSON.stringify(payload))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  return `header.${encoded}.signature`;
}

test("JWT email verification is false only when the claim is false", () => {
  assert.equal(readJwtEmailVerified(jwtWithPayload({ email_verified: false })), false);
  assert.equal(readJwtEmailVerified(jwtWithPayload({ email_verified: true })), true);
  assert.equal(readJwtEmailVerified(jwtWithPayload({})), true);
  assert.equal(readJwtEmailVerified("not-a-jwt"), true);
});

test("checkout 403 EMAIL_NOT_VERIFIED requires verification", () => {
  assert.equal(checkoutRequiresEmailVerification(403, { code: "EMAIL_NOT_VERIFIED" }), true);
  assert.equal(checkoutRequiresEmailVerification(403, { error: "EMAIL_NOT_VERIFIED" }), true);
  assert.equal(checkoutRequiresEmailVerification(403, { message: "EMAIL_NOT_VERIFIED" }), true);
  assert.equal(checkoutRequiresEmailVerification(401, { code: "EMAIL_NOT_VERIFIED" }), false);
  assert.equal(checkoutRequiresEmailVerification(403, { code: "OTHER" }), false);
});
