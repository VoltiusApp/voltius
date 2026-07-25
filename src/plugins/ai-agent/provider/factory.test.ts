import { describe, test, expect, vi, beforeEach } from "vitest";

const anthropicModel = { id: "anthropic-model" };
const createAnthropic = vi.fn(() => vi.fn(() => anthropicModel));
vi.mock("@ai-sdk/anthropic", () => ({ createAnthropic }));

const ollamaModel = { id: "ollama-model" };
const createOllama = vi.fn(() => vi.fn(() => ollamaModel));
vi.mock("ollama-ai-provider-v2", () => ({ createOllama }));

const compatModel = { id: "compat-model" };
const createOpenAICompatible = vi.fn(() => vi.fn(() => compatModel));
vi.mock("@ai-sdk/openai-compatible", () => ({ createOpenAICompatible }));

import { createProvider } from "./factory";
import type { ProviderProfile } from "../types";

const fetchStub = (async () => new Response()) as typeof globalThis.fetch;
beforeEach(() => vi.clearAllMocks());

describe("createProvider", () => {
  test("anthropic: builds provider with apiKey+fetch and selects the model", async () => {
    const selectModel = vi.fn(() => anthropicModel);
    createAnthropic.mockReturnValueOnce(selectModel);
    const profile: ProviderProfile = { id: "p1", providerKind: "anthropic", label: "A", model: "claude-x" };
    const model = await createProvider(profile, { apiKey: "sk-1", fetch: fetchStub });
    expect(createAnthropic).toHaveBeenCalledWith({ apiKey: "sk-1", fetch: fetchStub });
    expect(selectModel).toHaveBeenCalledWith("claude-x");
    expect(model).toBe(anthropicModel);
  });

  test("ollama: baseUrl gets /api appended for the provider", async () => {
    const selectModel = vi.fn(() => ollamaModel);
    createOllama.mockReturnValueOnce(selectModel);
    const profile: ProviderProfile = { id: "p2", providerKind: "ollama", label: "O", baseUrl: "http://localhost:11434", model: "llama3" };
    await createProvider(profile, { fetch: fetchStub });
    expect(createOllama).toHaveBeenCalledWith({ baseURL: "http://localhost:11434/api", fetch: fetchStub });
    expect(selectModel).toHaveBeenCalledWith("llama3");
  });

  test("openai-compatible: builds baseURL+/v1 and passes apiKey+fetch", async () => {
    const selectModel = vi.fn(() => compatModel);
    createOpenAICompatible.mockReturnValueOnce(selectModel);
    const profile: ProviderProfile = {
      id: "p4",
      providerKind: "openai-compatible",
      label: "C",
      baseUrl: "https://api.example.com",
      model: "gpt-x",
    };
    await createProvider(profile, { apiKey: "sk-1", fetch: fetchStub });
    expect(createOpenAICompatible).toHaveBeenCalledWith({
      name: "C",
      baseURL: "https://api.example.com/v1",
      apiKey: "sk-1",
      fetch: fetchStub,
    });
    expect(selectModel).toHaveBeenCalledWith("gpt-x");
  });

  // A protocol-relative or non-http(s) base URL must never reach the SDK's
  // fetch: it would carry the stored Authorization header to whatever origin
  // the webview resolves it against (see models.ts's matching guard).
  test("openai-compatible: rejects a protocol-relative base URL without touching the SDK", async () => {
    const profile: ProviderProfile = {
      id: "p5",
      providerKind: "openai-compatible",
      label: "C",
      baseUrl: "//evil.com",
      model: "gpt-x",
    };
    await expect(createProvider(profile, { apiKey: "sk-1", fetch: fetchStub })).rejects.toThrow(
      /http:\/\/ or https:\/\//,
    );
    expect(createOpenAICompatible).not.toHaveBeenCalled();
  });

  test("openai-compatible: rejects a non-http(s) scheme base URL without touching the SDK", async () => {
    const profile: ProviderProfile = {
      id: "p6",
      providerKind: "openai-compatible",
      label: "C",
      baseUrl: "ftp://x",
      model: "gpt-x",
    };
    await expect(createProvider(profile, { apiKey: "sk-1", fetch: fetchStub })).rejects.toThrow(
      /http:\/\/ or https:\/\//,
    );
    expect(createOpenAICompatible).not.toHaveBeenCalled();
  });

  test("unknown kind throws", async () => {
    const profile = { id: "p3", providerKind: "nope", label: "N", model: "m" } as unknown as ProviderProfile;
    await expect(createProvider(profile, { fetch: fetchStub })).rejects.toThrow(/unknown provider/i);
  });
});
