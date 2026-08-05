import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import "@/i18n";
import { ProviderFields, providerFieldsComplete, type ProviderFieldsValue } from "./ProviderFields";
import * as storeMod from "../state/agentStore";
import * as modelsMod from "../provider/models";

vi.mock("@iconify/react", () => ({ Icon: () => null }));
vi.mock("../state/agentStore", () => ({ getAgentDeps: vi.fn(() => null) }));
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.mocked(storeMod.getAgentDeps).mockReturnValue(null);
});

const base: ProviderFieldsValue = {
  providerKind: "anthropic", label: "Anthropic", apiKey: "", baseUrl: "", model: "",
};

describe("ProviderFields", () => {
  it("prefixes every field id so two instances can coexist", () => {
    render(<ProviderFields idPrefix="a" value={base} onChange={() => {}} />);
    render(<ProviderFields idPrefix="b" value={base} onChange={() => {}} />);
    expect(document.getElementById("a-provider")).toBeTruthy();
    expect(document.getElementById("b-provider")).toBeTruthy();
  });

  it("hides base URL for anthropic and shows it for openai-compatible", () => {
    const { rerender } = render(<ProviderFields idPrefix="a" value={base} onChange={() => {}} />);
    expect(document.getElementById("a-baseurl")).toBeNull();
    rerender(<ProviderFields idPrefix="a" value={{ ...base, providerKind: "openai-compatible" }} onChange={() => {}} />);
    expect(document.getElementById("a-baseurl")).toBeTruthy();
  });

  it("clears baseUrl when switching to a provider that hides it", () => {
    const onChange = vi.fn();
    render(<ProviderFields idPrefix="a" value={{ ...base, providerKind: "openai-compatible", baseUrl: "http://x" }} onChange={onChange} />);
    fireEvent.change(document.getElementById("a-provider")!, { target: { value: "anthropic" } });
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ providerKind: "anthropic", baseUrl: "" }));
  });

  it("masks a stored key until Replace is clicked", () => {
    const onReplaceKey = vi.fn();
    render(<ProviderFields idPrefix="a" value={base} onChange={() => {}} hasStoredKey onReplaceKey={onReplaceKey} />);
    expect(screen.getByText(/•••• set/)).toBeTruthy();
    expect(document.getElementById("a-apikey")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /replace/i }));
    expect(onReplaceKey).toHaveBeenCalled();
  });

  it("Load models falls back to getApiKey for the connection test when the typed key field is empty", async () => {
    vi.mocked(storeMod.getAgentDeps).mockReturnValue({ api: { http: {} } } as never);
    const loadModelsSpy = vi.spyOn(modelsMod, "loadModels").mockResolvedValue({ models: [] });
    const getApiKey = vi.fn(async () => "stored-key");

    render(<ProviderFields idPrefix="a" value={{ ...base, model: "m" }} onChange={() => {}} getApiKey={getApiKey} />);
    fireEvent.click(screen.getByText(/Load models/i));

    await vi.waitFor(() => expect(loadModelsSpy).toHaveBeenCalled());
    expect(getApiKey).toHaveBeenCalled();
    const [, , keyArg] = loadModelsSpy.mock.calls[0];
    expect(keyArg).toBe("stored-key");
    // Never surfaced anywhere in the DOM (no display, no input value).
    expect(screen.queryByDisplayValue("stored-key")).toBeNull();
    expect(screen.queryByText("stored-key")).toBeNull();
  });

  it("Load models prefers a typed key over getApiKey", async () => {
    vi.mocked(storeMod.getAgentDeps).mockReturnValue({ api: { http: {} } } as never);
    const loadModelsSpy = vi.spyOn(modelsMod, "loadModels").mockResolvedValue({ models: [] });
    const getApiKey = vi.fn(async () => "stored-key");

    render(
      <ProviderFields
        idPrefix="a"
        value={{ ...base, model: "m", apiKey: "typed-key" }}
        onChange={() => {}}
        getApiKey={getApiKey}
      />,
    );
    fireEvent.click(screen.getByText(/Load models/i));

    await vi.waitFor(() => expect(loadModelsSpy).toHaveBeenCalled());
    expect(getApiKey).not.toHaveBeenCalled();
    const [, , keyArg] = loadModelsSpy.mock.calls[0];
    expect(keyArg).toBe("typed-key");
  });
});

describe("providerFieldsComplete", () => {
  it("requires a key for anthropic but not for ollama", () => {
    expect(providerFieldsComplete({ ...base, model: "m" })).toBe(false);
    expect(providerFieldsComplete({ ...base, model: "m", apiKey: "k" })).toBe(true);
    expect(providerFieldsComplete({ ...base, providerKind: "ollama", model: "m", baseUrl: "http://x" })).toBe(true);
  });

  it("accepts a stored key in place of a typed one", () => {
    expect(providerFieldsComplete({ ...base, model: "m" }, true)).toBe(true);
  });

  it("requires a base URL where one is shown", () => {
    expect(providerFieldsComplete({ ...base, providerKind: "ollama", model: "m" })).toBe(false);
  });
});
