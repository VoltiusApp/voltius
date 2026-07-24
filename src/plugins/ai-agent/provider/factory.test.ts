import { describe, test, expect, vi, beforeEach } from "vitest";

const anthropicModel = { id: "anthropic-model" };
const createAnthropic = vi.fn(() => vi.fn(() => anthropicModel));
vi.mock("@ai-sdk/anthropic", () => ({ createAnthropic }));

const ollamaModel = { id: "ollama-model" };
const createOllama = vi.fn(() => vi.fn(() => ollamaModel));
vi.mock("ollama-ai-provider-v2", () => ({ createOllama }));

import { createProvider } from "./factory";
import type { ProviderProfile } from "../types";

const fetchStub = (async () => new Response()) as typeof globalThis.fetch;
beforeEach(() => vi.clearAllMocks());

describe("createProvider", () => {
  test("anthropic: builds provider with apiKey+fetch and selects the model", async () => {
    const profile: ProviderProfile = { id: "p1", providerKind: "anthropic", label: "A", model: "claude-x" };
    const model = await createProvider(profile, { apiKey: "sk-1", fetch: fetchStub });
    expect(createAnthropic).toHaveBeenCalledWith({ apiKey: "sk-1", fetch: fetchStub });
    expect(model).toBe(anthropicModel);
  });

  test("ollama: baseUrl gets /api appended for the provider", async () => {
    const profile: ProviderProfile = { id: "p2", providerKind: "ollama", label: "O", baseUrl: "http://localhost:11434", model: "llama3" };
    await createProvider(profile, { fetch: fetchStub });
    expect(createOllama).toHaveBeenCalledWith({ baseURL: "http://localhost:11434/api", fetch: fetchStub });
  });

  test("unknown kind throws", async () => {
    const profile = { id: "p3", providerKind: "nope", label: "N", model: "m" } as unknown as ProviderProfile;
    await expect(createProvider(profile, { fetch: fetchStub })).rejects.toThrow(/unknown provider/i);
  });
});
