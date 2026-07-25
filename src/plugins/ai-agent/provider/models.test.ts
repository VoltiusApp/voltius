import { describe, test, expect, vi } from "vitest";
import { loadModels, fieldVisibility, CURATED_MODELS } from "./models";
import type { ProviderProfile } from "../types";

const P = (over: Partial<ProviderProfile>): ProviderProfile =>
  ({ id: "p", providerKind: "ollama", label: "l", model: "m", ...over });

describe("fieldVisibility", () => {
  test("baseUrl only for openai-compatible + ollama; key optional for ollama", () => {
    expect(fieldVisibility("anthropic")).toEqual({ baseUrl: false, apiKeyRequired: true });
    expect(fieldVisibility("google")).toEqual({ baseUrl: false, apiKeyRequired: true });
    expect(fieldVisibility("openai-compatible")).toEqual({ baseUrl: true, apiKeyRequired: true });
    expect(fieldVisibility("ollama")).toEqual({ baseUrl: true, apiKeyRequired: false });
  });
});

describe("loadModels", () => {
  test("ollama: GET {baseUrl}/api/tags → model names", async () => {
    const get = vi.fn().mockResolvedValue({ models: [{ name: "llama3" }, { name: "qwen" }] });
    const api = { http: { get } } as any;
    const res = await loadModels(api, P({ providerKind: "ollama", baseUrl: "http://h:11434" }));
    expect(get).toHaveBeenCalledWith("http://h:11434/api/tags", expect.anything());
    expect(res).toEqual({ models: ["llama3", "qwen"] });
  });

  test("openai-compatible: GET {baseUrl}/v1/models → ids, with Authorization", async () => {
    const get = vi.fn().mockResolvedValue({ data: [{ id: "gpt-x" }, { id: "gpt-y" }] });
    const api = { http: { get } } as any;
    const res = await loadModels(api, P({ providerKind: "openai-compatible", baseUrl: "http://h" }), "sk-9");
    const [url, opts] = get.mock.calls[0];
    expect(url).toBe("http://h/v1/models");
    expect(new Headers(opts.headers).get("authorization")).toBe("Bearer sk-9");
    expect(res).toEqual({ models: ["gpt-x", "gpt-y"] });
  });

  test("anthropic: curated list, no network", async () => {
    const get = vi.fn();
    const api = { http: { get } } as any;
    const res = await loadModels(api, P({ providerKind: "anthropic" }));
    expect(get).not.toHaveBeenCalled();
    expect(res.models).toEqual(CURATED_MODELS.anthropic);
  });

  test("fetch error is surfaced as a connection-test failure", async () => {
    const get = vi.fn().mockRejectedValue(new Error("HTTP 401: unauthorized"));
    const api = { http: { get } } as any;
    const res = await loadModels(api, P({ providerKind: "ollama", baseUrl: "http://h" }));
    expect(res.models).toEqual([]);
    expect(res.error).toMatch(/401/);
  });

  // A protocol-relative base URL bypasses ProfileEditor's origin-change check
  // (new URL("//evil.com") throws there too, so it never forces re-entry) but
  // must still never reach api.http.get carrying a stored Authorization header.
  test("protocol-relative base URL is rejected without issuing a request", async () => {
    const get = vi.fn();
    const api = { http: { get } } as any;
    const res = await loadModels(api, P({ providerKind: "openai-compatible", baseUrl: "//evil.com/v1" }), "sk-secret");
    expect(get).not.toHaveBeenCalled();
    expect(res.models).toEqual([]);
    expect(res.error).toMatch(/http:\/\/ or https:\/\//);
  });

  test("non-http(s) scheme base URL is rejected without issuing a request", async () => {
    const get = vi.fn();
    const api = { http: { get } } as any;
    const res = await loadModels(api, P({ providerKind: "openai-compatible", baseUrl: "ftp://x" }), "sk-secret");
    expect(get).not.toHaveBeenCalled();
    expect(res.models).toEqual([]);
    expect(res.error).toMatch(/http:\/\/ or https:\/\//);
  });

  test("ollama with a protocol-relative base URL is also rejected", async () => {
    const get = vi.fn();
    const api = { http: { get } } as any;
    const res = await loadModels(api, P({ providerKind: "ollama", baseUrl: "//evil.com" }));
    expect(get).not.toHaveBeenCalled();
    expect(res.models).toEqual([]);
  });
});
