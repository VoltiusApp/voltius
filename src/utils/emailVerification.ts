export interface JwtEmailVerificationPayload {
  email_verified?: boolean;
}

export function parseJwtPayload<T extends object>(token: string): T | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const raw = atob(parts[1].replace(/-/g, "+").replace(/_/g, "/"));
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
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
