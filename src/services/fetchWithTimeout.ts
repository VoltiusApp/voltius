import i18n from "@/i18n";
import { appFetch, isAbortError } from "@/services/http";

export async function fetchWithTimeout(input: string, init?: RequestInit, timeoutMs = 10_000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await appFetch(input, { ...init, signal: controller.signal, connectTimeout: timeoutMs });
  } catch (e) {
    if (isAbortError(e)) {
      throw new Error(i18n.t("common.error.serverUnreachableTimeout"));
    }

    // WebView2 / network errors are often opaque objects; normalise them.
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(i18n.t("common.error.networkError", { message: msg }));
  } finally {
    clearTimeout(timer);
  }
}
