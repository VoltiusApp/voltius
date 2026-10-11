import { listen } from "@tauri-apps/api/event";

const hasWindow = typeof window !== "undefined";

/** `online`, plus the OS reporting a new routable address, which webviews do not reliably turn into `online`. */
export function onNetworkBack(fn: () => void): () => void {
  if (hasWindow) window.addEventListener("online", fn);
  const unlisten = listen("network-changed", fn);
  return () => {
    if (hasWindow) window.removeEventListener("online", fn);
    void unlisten.then((off) => off());
  };
}

export function onForeground(fn: () => void): () => void {
  if (!hasWindow) return () => {};
  const onVisibility = () => {
    if (document.visibilityState === "visible") fn();
  };
  window.addEventListener("focus", fn);
  document.addEventListener("visibilitychange", onVisibility);
  return () => {
    window.removeEventListener("focus", fn);
    document.removeEventListener("visibilitychange", onVisibility);
  };
}
