/**
 * Which Voltius instance an account lives on.
 *
 * Only a non-default instance is ever named in the UI: an account on the
 * official cloud reads exactly as it did before, and the host appears only when
 * it is the thing that tells two otherwise identical accounts apart.
 */
export const DEFAULT_SERVER_URL = "https://api.voltius.app";

function parse(url: string | null | undefined): URL | null {
  if (!url) return null;
  try {
    return new URL(url.trim());
  } catch {
    return null;
  }
}

const DEFAULT_HOST = new URL(DEFAULT_SERVER_URL).host;

/** A URL we cannot read counts as the default — better unmarked than mislabelled. */
export function isDefaultServer(url: string | null | undefined): boolean {
  const parsed = parse(url);
  return !parsed || parsed.host.toLowerCase() === DEFAULT_HOST;
}

/** Host to show for a self-hosted instance, or null when there is nothing to say. */
export function instanceLabel(url: string | null | undefined): string | null {
  const parsed = parse(url);
  if (!parsed || isDefaultServer(url)) return null;

  const hostname = parsed.hostname.toLowerCase();
  const stripped = hostname.replace(/^(?:api|www)\./, "");
  const name = stripped.includes(".") ? stripped : hostname;
  return parsed.port ? `${name}:${parsed.port}` : name;
}

/**
 * The instance this machine last signed in to.
 *
 * Device-scoped on purpose: adding a second account clears every account-scoped
 * keychain entry, `server_url` among them, so without this the auth screen
 * silently aims a self-hosted user back at the official cloud.
 */
const LAST_SERVER_KEY = "voltius.last-server-url";

export function rememberServer(url: string): boolean {
  if (!parse(url)) return false;
  globalThis.localStorage?.setItem(LAST_SERVER_KEY, url);
  return true;
}

export function storedServerUrl(): string {
  const stored = globalThis.localStorage?.getItem(LAST_SERVER_KEY);
  return parse(stored) ? stored! : "";
}

function serverKey(url: string | null | undefined): string | null {
  const parsed = parse(url);
  if (!parsed || (parsed.protocol !== "https:" && parsed.protocol !== "http:")) return null;
  return parsed.origin + parsed.pathname.replace(/\/+$/, "");
}

export function sameServer(a: string | null | undefined, b: string | null | undefined): boolean {
  const key = serverKey(a);
  return key !== null && key === serverKey(b);
}

export const normalizeServerUrl = (url: string): string => url.replace(/\/+$/, "");
