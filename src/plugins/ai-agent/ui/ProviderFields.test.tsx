import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { ProviderFields, providerFieldsComplete, type ProviderFieldsValue } from "./ProviderFields";

vi.mock("@iconify/react", () => ({ Icon: () => null }));
vi.mock("../state/agentStore", () => ({ getAgentDeps: () => null }));
afterEach(cleanup);

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
