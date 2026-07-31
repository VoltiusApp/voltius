import { useEffect, useState } from "react";
import type { PluginAPI } from "@/plugins/api";

/** Re-renders the caller whenever the host's active locale changes, so `t()`
 *  calls made during that render resolve against the new locale. */
export function useT(api: PluginAPI): PluginAPI["i18n"]["t"] {
  const [, setLocale] = useState(() => api.i18n.getLocale());
  useEffect(() => api.i18n.onLocaleChange(setLocale), [api]);
  return api.i18n.t;
}
