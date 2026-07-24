import type { LanguageModel } from "ai";
import type { ProviderProfile } from "../types";

export interface CreateProviderOpts {
  apiKey?: string;
  fetch: typeof globalThis.fetch;
}

/**
 * Build an AI-SDK LanguageModel for a profile. Provider packages are lazy-loaded
 * per kind so only the activated provider's code enters the bundle at runtime.
 */
export async function createProvider(
  profile: ProviderProfile,
  opts: CreateProviderOpts,
): Promise<LanguageModel> {
  switch (profile.providerKind) {
    case "anthropic": {
      const { createAnthropic } = await import("@ai-sdk/anthropic");
      return createAnthropic({ apiKey: opts.apiKey, fetch: opts.fetch })(profile.model);
    }
    case "openai-compatible": {
      const { createOpenAICompatible } = await import("@ai-sdk/openai-compatible");
      if (!profile.baseUrl) throw new Error("openai-compatible provider requires a base URL");
      return createOpenAICompatible({
        name: profile.label || "openai-compatible",
        baseURL: `${profile.baseUrl.replace(/\/$/, "")}/v1`,
        apiKey: opts.apiKey,
        fetch: opts.fetch,
      })(profile.model);
    }
    case "google": {
      const { createGoogleGenerativeAI } = await import("@ai-sdk/google");
      return createGoogleGenerativeAI({ apiKey: opts.apiKey, fetch: opts.fetch })(profile.model);
    }
    case "ollama": {
      const { createOllama } = await import("ollama-ai-provider-v2");
      if (!profile.baseUrl) throw new Error("ollama provider requires a base URL");
      return createOllama({ baseURL: `${profile.baseUrl.replace(/\/$/, "")}/api`, fetch: opts.fetch })(profile.model);
    }
    default:
      throw new Error(`unknown provider kind: ${(profile as ProviderProfile).providerKind}`);
  }
}
