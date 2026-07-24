import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { FirstRunCard } from "./FirstRunCard";
import * as storeMod from "../state/agentStore";
import * as modelsMod from "../provider/models";
import type { ProviderProfile } from "../types";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("FirstRunCard", () => {
  it("Start creates + activates a profile and calls onDone", async () => {
    const save = vi.fn(async (_profile: ProviderProfile) => {});
    const setKey = vi.fn(async (_id: string, _key: string) => {});
    const setActive = vi.fn(async (_id: string) => {});
    vi.spyOn(storeMod, "_getDeps").mockReturnValue({ profiles: { save, setKey, setActive } } as never);
    const onDone = vi.fn();
    render(<FirstRunCard onDone={onDone} />);
    fireEvent.change(screen.getByLabelText(/API key/i), { target: { value: "sk-1" } });
    fireEvent.change(screen.getByLabelText(/Model/i), { target: { value: "claude-opus-4-8" } });
    fireEvent.click(screen.getByText("Start"));
    await vi.waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(save).toHaveBeenCalled();
    expect(setActive).toHaveBeenCalled();

    const savedProfile = save.mock.calls[0][0];
    expect(savedProfile.providerKind).toBe("anthropic");
    expect(savedProfile.model).toBe("claude-opus-4-8");
    expect(typeof savedProfile.id).toBe("string");
    expect(savedProfile.id.length).toBeGreaterThan(0);
    expect(setKey).toHaveBeenCalledWith(savedProfile.id, "sk-1");
    expect(setActive).toHaveBeenCalledWith(savedProfile.id);
  });

  it("skips setKey when the API key is left empty (ollama, key optional)", async () => {
    const save = vi.fn(async (_profile: ProviderProfile) => {});
    const setKey = vi.fn(async (_id: string, _key: string) => {});
    const setActive = vi.fn(async (_id: string) => {});
    vi.spyOn(storeMod, "_getDeps").mockReturnValue({ profiles: { save, setKey, setActive } } as never);
    const onDone = vi.fn();
    render(<FirstRunCard onDone={onDone} />);
    fireEvent.change(screen.getByLabelText(/Provider/i), { target: { value: "ollama" } });
    fireEvent.change(screen.getByLabelText(/Base URL/i), { target: { value: "http://localhost:11434" } });
    fireEvent.change(screen.getByLabelText(/Model/i), { target: { value: "llama3" } });
    fireEvent.click(screen.getByText("Start"));
    await vi.waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(save).toHaveBeenCalled();
    expect(setKey).not.toHaveBeenCalled();
    const savedProfile = save.mock.calls[0][0];
    expect(savedProfile.baseUrl).toBe("http://localhost:11434");
  });

  it("hides Base URL for anthropic/google, shows it for openai-compatible/ollama", () => {
    vi.spyOn(storeMod, "_getDeps").mockReturnValue({ profiles: {} } as never);
    render(<FirstRunCard onDone={vi.fn()} />);
    expect(screen.queryByLabelText(/Base URL/i)).toBeNull();

    fireEvent.change(screen.getByLabelText(/Provider/i), { target: { value: "openai-compatible" } });
    expect(screen.getByLabelText(/Base URL/i)).toBeTruthy();

    fireEvent.change(screen.getByLabelText(/Provider/i), { target: { value: "google" } });
    expect(screen.queryByLabelText(/Base URL/i)).toBeNull();
  });

  it("Load models calls loadModels with the drafted profile + api key and populates options", async () => {
    vi.spyOn(storeMod, "_getDeps").mockReturnValue({
      api: { http: {} },
      profiles: {},
    } as never);
    const loadModelsSpy = vi
      .spyOn(modelsMod, "loadModels")
      .mockResolvedValue({ models: ["claude-opus-4-8", "claude-sonnet-5"] });

    render(<FirstRunCard onDone={vi.fn()} />);
    fireEvent.change(screen.getByLabelText(/API key/i), { target: { value: "sk-1" } });
    fireEvent.click(screen.getByText(/Load models/i));

    await vi.waitFor(() => expect(loadModelsSpy).toHaveBeenCalled());
    const [, profileArg, keyArg] = loadModelsSpy.mock.calls[0];
    expect(profileArg.providerKind).toBe("anthropic");
    expect(keyArg).toBe("sk-1");
  });
});
