import { parseJwtPayload } from "@/utils/jwtPayload";

export interface JwtEmailVerificationPayload {
  email_verified?: boolean;
}

export function readJwtEmailVerified(token: string): boolean {
  const payload = parseJwtPayload<JwtEmailVerificationPayload>(token);
  return payload?.email_verified !== false;
}

function hasErrorCode(body: unknown, code: string): boolean {
  if (!body || typeof body !== "object") return false;
  const data = body as Record<string, unknown>;
  return data.code === code || data.error === code || data.message === code;
}

export function checkoutRequiresEmailVerification(status: number, body: unknown): boolean {
  return status === 403 && hasErrorCode(body, "EMAIL_NOT_VERIFIED");
}

export function isEmailUndeliverable(status: number, body: unknown): boolean {
  return status === 422 && hasErrorCode(body, "EMAIL_UNDELIVERABLE");
}

export class EmailUndeliverableError extends Error {}
