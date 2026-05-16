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

export function checkoutRequiresEmailVerification(status: number, body: unknown): boolean {
  if (status !== 403 || !body || typeof body !== "object") return false;
  const data = body as Record<string, unknown>;
  return data.code === "EMAIL_NOT_VERIFIED"
    || data.error === "EMAIL_NOT_VERIFIED"
    || data.message === "EMAIL_NOT_VERIFIED";
}
