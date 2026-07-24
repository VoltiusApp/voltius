import type { PluginAPI } from "@/plugins/api";
import type { ProviderKind, ProviderProfile } from "../types";

export interface ModelListResult {
  models: string[];
  error?: string;
}

/** Shipped fallbacks for providers without a public model-list endpoint. */
export const CURATED_MODELS: Record<"anthropic" | "google", string[]> = {
  anthropic: [
    "claude-opus-4-8",
    "claude-sonnet-5",
    "claude-haiku-4-5-20251001",
  ],
  google: [
    "gemini-2.5-pro",
    "gemini-2.5-flash",
  ],
};

export function fieldVisibility(kind: ProviderKind): { baseUrl: boolean; apiKeyRequired: boolean } {
  switch (kind) {
    case "openai-compatible": return { baseUrl: true, apiKeyRequired: true };
    case "ollama": return { baseUrl: true, apiKeyRequired: false };
    default: return { baseUrl: false, apiKeyRequired: true };
  }
}

/**
 * Fetch (or return curated) model ids for a profile. Doubles as a connection
 * test: network/auth errors resolve as `{ models: [], error }` (never throw).
 */
export async function loadModels(
  api: Pick<PluginAPI, "http">,
  profile: ProviderProfile,
  apiKey?: string,
): Promise<ModelListResult> {
  try {
    if (profile.providerKind === "anthropic") return { models: CURATED_MODELS.anthropic };
    if (profile.providerKind === "google") return { models: CURATED_MODELS.google };

    const base = (profile.baseUrl ?? "").replace(/\/$/, "");
    if (!base) return { models: [], error: "base URL required" };

    if (profile.providerKind === "ollama") {
      const res = await api.http.get<{ models?: Array<{ name: string }> }>(`${base}/api/tags`, {});
      return { models: (res.models ?? []).map((m) => m.name) };
    }
    // openai-compatible
    const headers: Record<string, string> = {};
    if (apiKey) headers["authorization"] = `Bearer ${apiKey}`;
    const res = await api.http.get<{ data?: Array<{ id: string }> }>(`${base}/v1/models`, { headers });
    return { models: (res.data ?? []).map((m) => m.id) };
  } catch (err) {
    return { models: [], error: err instanceof Error ? err.message : String(err) };
  }
}
