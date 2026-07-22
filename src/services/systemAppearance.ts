const QUERY = "(prefers-color-scheme: dark)";

export function getSystemPrefersDark(): boolean {
  if (typeof matchMedia !== "function") return false;
  return matchMedia(QUERY).matches;
}

export function subscribeSystemAppearance(cb: () => void): () => void {
  if (typeof matchMedia !== "function") return () => {};
  const mql = matchMedia(QUERY);
  mql.addEventListener("change", cb);
  return () => mql.removeEventListener("change", cb);
}
