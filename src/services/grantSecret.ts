/** As the server mints it: 32 random bytes, unpadded base64url, 43 chars. */
export const GRANT_SECRET_RE = /^[A-Za-z0-9_-]{43}$/;
