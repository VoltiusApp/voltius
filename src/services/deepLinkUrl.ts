import { isSessionId } from "@/services/sessionId";

export type DeepLinkIntent = { route: "join"; sessionId: string; token: string };

export function parseDeepLink(url: string): DeepLinkIntent | null {
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    return null;
  }
  if (parsed.protocol !== "voltius:") return null;
  // Custom schemes are not special-scheme URLs, so the route lands in `hostname`
  // on some platforms and `pathname` on others.
  const route = parsed.hostname || parsed.pathname.replace(/^\/+/, "");
  if (route !== "join") return null;

  const sessionId = parsed.searchParams.get("s") ?? "";
  const token = parsed.searchParams.get("t") ?? "";
  if (!isSessionId(sessionId) || !token) return null;

  return { route: "join", sessionId, token };
}
