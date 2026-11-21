import { invoke } from "@/lib/invoke";
import type { Connection } from "@/types";
import { connectionDisplayName } from "@/utils/connectionDisplayName";
import { webUrl } from "@/utils/connectionType";

/** Where a pane sits in the main window, in CSS pixels from its top-left corner. */
export interface PaneBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Open a web host (HTTP/HTTPS) in its own window; an already-open one is brought to the front. */
export async function openWebHost(c: Connection): Promise<void> {
  return invoke("web_host_open", { connectionId: c.id, title: connectionDisplayName(c), url: webUrl(c) });
}

/** The page's icon as a `data:` URL, or null when it has none or cannot be reached. */
export function fetchWebFavicon(url: string): Promise<string | null> {
  return invoke<string | null>("web_favicon", { url });
}

/** Per session, so a move never overtakes the create, nor a close the call before it. */
const queues = new Map<string, Promise<unknown>>();

function enqueue(sessionId: string, run: () => Promise<void>): Promise<void> {
  const next = (queues.get(sessionId) ?? Promise.resolve()).catch(() => {}).then(run);
  queues.set(sessionId, next);
  return next;
}

/** Show a session's page at `bounds`, creating it on first use; `null` hides it, keeping it loaded. */
export function syncWebPane(
  sessionId: string,
  url: string,
  bounds: PaneBounds | null,
  refocusApp = false,
): Promise<void> {
  return enqueue(sessionId, () => invoke("web_pane_sync", { sessionId, url, bounds, refocusApp }));
}

/** Destroy a closed session's web page. */
export function closeWebPane(sessionId: string): Promise<void> {
  const done = enqueue(sessionId, () => invoke("web_pane_close", { sessionId }));
  return done.finally(() => {
    if (queues.get(sessionId) === done) queues.delete(sessionId);
  });
}
