import { parseDeepLink } from "@/services/deepLinkUrl";
import { useDeepLinkStore } from "@/stores/deepLinkStore";
import { getCurrent, onOpenUrl } from "@tauri-apps/plugin-deep-link";

// Never log the URL: its query string carries a live session credential and
// the log plugin writes to disk.
export function handleDeepLink(url: string): void {
  const intent = parseDeepLink(url);
  if (!intent) {
    console.warn("Ignoring unrecognised deep link");
    return;
  }
  useDeepLinkStore.getState().enqueue(intent);
}

// The catch arms matter: where the plugin is unavailable, a rejected promise
// here would surface as an unhandled rejection at startup.
export function startDeepLinks(): () => void {
  let unlisten: (() => void) | null = null;
  let stopped = false;

  void getCurrent()
    .then((urls) => urls?.forEach(handleDeepLink))
    .catch(() => {});

  void onOpenUrl((urls) => urls.forEach(handleDeepLink))
    .then((fn) => {
      if (stopped) fn();
      else unlisten = fn;
    })
    .catch(() => {});

  return () => {
    stopped = true;
    unlisten?.();
  };
}
