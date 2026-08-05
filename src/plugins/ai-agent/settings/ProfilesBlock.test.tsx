import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { ProfilesBlock } from "./ProfilesBlock";
import * as storeMod from "../state/agentStore";
import { useAgentStore } from "../state/agentStore";

vi.mock("@iconify/react", () => ({ Icon: () => null }));
// A blanket identity `t` (key in, key out) keeps most assertions robust to
// copy changes — dotted keys like "...profiles.edit"/"...deleteConfirm.confirm"
// still contain the words the tests look for. The one string that can't
// survive that trick is the masked-key indicator, which must render the
// literal "•••• set"/"Replace" text ProviderFields owns (see Task 5/8 wiring
// notes) — no dotted key can satisfy a `/•••• set/` match, so those two keys
// are special-cased to their real English copy instead of the raw key.
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (k: string) => {
      if (k === "aiAgent.settings.profiles.keySet") return "•••• set";
      if (k === "aiAgent.settings.profiles.replaceKey") return "Replace";
      return k;
    },
  }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const profiles = [
  { id: "1", providerKind: "anthropic" as const, label: "Work", model: "claude-sonnet-5" },
  { id: "2", providerKind: "ollama" as const, label: "Local", model: "llama3.2", baseUrl: "http://x" },
  {
    id: "3",
    providerKind: "openai-compatible" as const,
    label: "Custom",
    model: "gpt-4",
    baseUrl: "https://api.example.com/v1",
  },
];

function mockStore(over: Record<string, unknown> = {}) {
  const store = {
    list: vi.fn(async () => profiles),
    getActiveId: vi.fn(async () => "1"),
    setActive: vi.fn(async () => {}),
    save: vi.fn(async () => {}),
    remove: vi.fn(async () => {}),
    getKey: vi.fn(async () => "sk-stored"),
    setKey: vi.fn(async () => {}),
    deleteKey: vi.fn(async () => {}),
    hasKey: vi.fn(async () => true),
    ...over,
  };
  return store;
}

function mockDeps(over: { profiles: ReturnType<typeof mockStore> }) {
  vi.spyOn(storeMod, "getAgentDeps").mockReturnValue({
    api: {} as never,
    profiles: over.profiles,
    controller: {} as never,
  } as never);
}

describe("ProfilesBlock", () => {
  it("lists every profile with its model", async () => {
    mockDeps({ profiles: mockStore() });
    render(<ProfilesBlock />);
    expect(await screen.findByText("Work")).toBeTruthy();
    expect(screen.getByText(/claude-sonnet-5/)).toBeTruthy();
    expect(screen.getByText("Local")).toBeTruthy();
  });

  it("activates a profile and bumps profilesVersion", async () => {
    const store = mockStore();
    mockDeps({ profiles: store });
    const before = useAgentStore.getState().profilesVersion;
    render(<ProfilesBlock />);
    fireEvent.click(await screen.findByRole("radio", { name: /Local/ }));
    await waitFor(() => expect(store.setActive).toHaveBeenCalledWith("2"));
    expect(useAgentStore.getState().profilesVersion).toBeGreaterThan(before);
  });

  it("deletes only after confirmation", async () => {
    const store = mockStore();
    mockDeps({ profiles: store });
    render(<ProfilesBlock />);
    fireEvent.click((await screen.findAllByRole("button", { name: /delete/i }))[0]);
    expect(store.remove).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /confirm/i }));
    await waitFor(() => expect(store.remove).toHaveBeenCalledWith("1"));
  });

  it("never renders a stored key, only the masked state", async () => {
    const store = mockStore();
    mockDeps({ profiles: store });
    render(<ProfilesBlock />);
    fireEvent.click((await screen.findAllByRole("button", { name: /edit/i }))[0]);
    expect(await screen.findByText(/•••• set/)).toBeTruthy();
    expect(screen.queryByDisplayValue("sk-stored")).toBeNull();
    expect(store.getKey).not.toHaveBeenCalled();
  });

  it("saves an edited profile and writes a replaced key", async () => {
    const store = mockStore();
    mockDeps({ profiles: store });
    render(<ProfilesBlock />);
    fireEvent.click((await screen.findAllByRole("button", { name: /edit/i }))[0]);
    await screen.findByText(/•••• set/); // wait for the async hasKey fact to resolve
    fireEvent.change(document.getElementById("edit-label")!, { target: { value: "Renamed" } });
    fireEvent.click(screen.getByRole("button", { name: /save/i }));
    await waitFor(() =>
      expect(store.save).toHaveBeenCalledWith(expect.objectContaining({ id: "1", label: "Renamed" })),
    );
    expect(store.setKey).not.toHaveBeenCalled(); // key untouched -> not rewritten
  });

  it("does not rename an existing profile when only the provider is switched", async () => {
    const store = mockStore();
    mockDeps({ profiles: store });
    render(<ProfilesBlock />);
    // profile "1" is Work / anthropic — open its editor without touching the name field.
    fireEvent.click((await screen.findAllByRole("button", { name: /edit/i }))[0]);
    const labelInput = document.getElementById("edit-label") as HTMLInputElement;
    expect(labelInput.value).toBe("Work");

    fireEvent.change(document.getElementById("edit-provider")!, { target: { value: "google" } });
    expect(labelInput.value).toBe("Work"); // provider switch alone must never rewrite a saved name

    // A provider switch forces Replace mode (see the dedicated I2 tests
    // below), so a key for the new provider must be typed before saving.
    fireEvent.change(document.getElementById("edit-apikey")!, { target: { value: "goog-key" } });
    fireEvent.click(screen.getByRole("button", { name: /save/i }));
    await waitFor(() =>
      expect(store.save).toHaveBeenCalledWith(
        expect.objectContaining({ id: "1", label: "Work", providerKind: "google" }),
      ),
    );
  });

  it("switching provider kind on an existing profile clears the masked-key state and requires a new key before save", async () => {
    const store = mockStore();
    mockDeps({ profiles: store });
    render(<ProfilesBlock />);
    fireEvent.click((await screen.findAllByRole("button", { name: /edit/i }))[0]);
    await screen.findByText(/•••• set/); // profile "1" (anthropic) starts with a stored key

    const saveButton = screen.getByRole("button", { name: /save/i }) as HTMLButtonElement;
    expect(saveButton.disabled).toBe(false); // stored key + model already satisfy anthropic

    // Switch to a different provider that also requires a key (google).
    fireEvent.change(document.getElementById("edit-provider")!, { target: { value: "google" } });

    // The masked "•••• set" state must be gone — the old key belongs to
    // anthropic, not google — and a real key input must render instead.
    expect(screen.queryByText(/•••• set/)).toBeNull();
    expect(document.getElementById("edit-apikey")).toBeTruthy();
    expect(saveButton.disabled).toBe(true); // no key typed yet for the new provider

    fireEvent.change(document.getElementById("edit-apikey")!, { target: { value: "goog-key" } });
    expect(saveButton.disabled).toBe(false);
  });

  it("saving after a provider-kind switch does not leave the old provider's key associated with the profile", async () => {
    const store = mockStore();
    mockDeps({ profiles: store });
    render(<ProfilesBlock />);
    fireEvent.click((await screen.findAllByRole("button", { name: /edit/i }))[0]);
    await screen.findByText(/•••• set/);

    // Switch to ollama, whose key is optional — leave it blank and save.
    fireEvent.change(document.getElementById("edit-provider")!, { target: { value: "ollama" } });
    fireEvent.change(document.getElementById("edit-baseurl")!, { target: { value: "http://localhost:11434" } });
    fireEvent.click(screen.getByRole("button", { name: /save/i }));

    await waitFor(() =>
      expect(store.save).toHaveBeenCalledWith(expect.objectContaining({ id: "1", providerKind: "ollama" })),
    );
    // The stale anthropic key must be purged, not left sitting under this id.
    expect(store.deleteKey).toHaveBeenCalledWith("1");
    expect(store.setKey).not.toHaveBeenCalled();
  });

  it("auto-derives the profile name from the provider until the user types, when creating a profile", async () => {
    mockDeps({ profiles: mockStore() });
    render(<ProfilesBlock />);
    fireEvent.click(await screen.findByRole("button", { name: /add/i }));
    const labelInput = document.getElementById("edit-label") as HTMLInputElement;
    expect(labelInput.value).toBe("Anthropic");

    fireEvent.change(document.getElementById("edit-provider")!, { target: { value: "ollama" } });
    expect(labelInput.value).toBe("Ollama"); // still untouched -> keeps following the provider

    fireEvent.change(labelInput, { target: { value: "My Custom Name" } });
    fireEvent.change(document.getElementById("edit-provider")!, { target: { value: "google" } });
    expect(labelInput.value).toBe("My Custom Name"); // user typed -> provider switch no longer overrides it
  });

  it("surfaces an error and does not bump profilesVersion when activation fails", async () => {
    const store = mockStore({
      setActive: vi.fn(async () => {
        throw new Error("activation boom");
      }),
    });
    mockDeps({ profiles: store });
    const before = useAgentStore.getState().profilesVersion;
    render(<ProfilesBlock />);
    fireEvent.click(await screen.findByRole("radio", { name: /Local/ }));
    await waitFor(() => expect(store.setActive).toHaveBeenCalledWith("2"));
    expect(await screen.findByText(/activation boom/)).toBeTruthy();
    expect(useAgentStore.getState().profilesVersion).toBe(before);
  });

  it("surfaces an error and does not bump profilesVersion when delete fails", async () => {
    const store = mockStore({
      remove: vi.fn(async () => {
        throw new Error("delete boom");
      }),
    });
    mockDeps({ profiles: store });
    const before = useAgentStore.getState().profilesVersion;
    render(<ProfilesBlock />);
    fireEvent.click((await screen.findAllByRole("button", { name: /delete/i }))[0]);
    fireEvent.click(screen.getByRole("button", { name: /confirm/i }));
    await waitFor(() => expect(store.remove).toHaveBeenCalledWith("1"));
    expect(await screen.findByText(/delete boom/)).toBeTruthy();
    expect(useAgentStore.getState().profilesVersion).toBe(before);
  });

  // --- I1: a typed key must never be silently dropped -----------------------

  it("writes a newly typed key for an existing profile that has no key on disk", async () => {
    const store = mockStore({ hasKey: vi.fn(async () => false) });
    mockDeps({ profiles: store });
    render(<ProfilesBlock />);
    // profile "2" (ollama, Local) — key is optional there and absent on disk.
    fireEvent.click((await screen.findAllByRole("button", { name: /edit/i }))[1]);
    // No stored key exists, so the real input renders immediately (never masked).
    await waitFor(() => expect(screen.queryByText(/•••• set/)).toBeNull());
    const apiKeyInput = document.getElementById("edit-apikey") as HTMLInputElement;
    expect(apiKeyInput).toBeTruthy();

    fireEvent.change(apiKeyInput, { target: { value: "sk-newly-typed" } });
    fireEvent.click(screen.getByRole("button", { name: /save/i }));

    await waitFor(() => expect(store.save).toHaveBeenCalledWith(expect.objectContaining({ id: "2" })));
    expect(store.setKey).toHaveBeenCalledWith("2", "sk-newly-typed");
  });

  // --- I2: the request destination (baseUrl), not just providerKind, gates a stored key ---

  it("changing baseUrl to a different origin forces Replace and clears any typed key", async () => {
    const store = mockStore();
    mockDeps({ profiles: store });
    render(<ProfilesBlock />);
    // profile "3" (openai-compatible, Custom) starts with a stored key.
    fireEvent.click((await screen.findAllByRole("button", { name: /edit/i }))[2]);
    await screen.findByText(/•••• set/);

    fireEvent.click(screen.getByRole("button", { name: /replace/i }));
    fireEvent.change(document.getElementById("edit-apikey")!, {
      target: { value: "sk-typed-for-old-host" },
    });

    fireEvent.change(document.getElementById("edit-baseurl")!, {
      target: { value: "https://evil.example/v1/models" },
    });

    expect(screen.queryByText(/•••• set/)).toBeNull();
    const apiKeyInput = document.getElementById("edit-apikey") as HTMLInputElement;
    expect(apiKeyInput).toBeTruthy();
    expect(apiKeyInput.value).toBe("");
  });

  it("does not let Load models use the stored key once the baseUrl origin has changed", async () => {
    const store = mockStore();
    mockDeps({ profiles: store });
    render(<ProfilesBlock />);
    fireEvent.click((await screen.findAllByRole("button", { name: /edit/i }))[2]);
    await screen.findByText(/•••• set/);

    fireEvent.change(document.getElementById("edit-baseurl")!, {
      target: { value: "https://evil.example/v1/models" },
    });

    const loadBtn = screen.getByRole("button", { name: /loadModels/i }) as HTMLButtonElement;
    fireEvent.click(loadBtn);
    await waitFor(() => expect(loadBtn.disabled).toBe(false));
    expect(store.getKey).not.toHaveBeenCalled();
  });

  it("does not force Replace when only the path changes on the same origin", async () => {
    const store = mockStore();
    mockDeps({ profiles: store });
    render(<ProfilesBlock />);
    fireEvent.click((await screen.findAllByRole("button", { name: /edit/i }))[2]);
    await screen.findByText(/•••• set/);

    fireEvent.change(document.getElementById("edit-baseurl")!, {
      target: { value: "https://api.example.com/v2" },
    });

    expect(screen.getByText(/•••• set/)).toBeTruthy();
    expect(document.getElementById("edit-apikey")).toBeNull();
  });

  it("saving a destination change (same providerKind, different baseUrl origin) drops the stale key", async () => {
    const store = mockStore();
    mockDeps({ profiles: store });
    render(<ProfilesBlock />);
    fireEvent.click((await screen.findAllByRole("button", { name: /edit/i }))[2]);
    await screen.findByText(/•••• set/);

    fireEvent.change(document.getElementById("edit-baseurl")!, {
      target: { value: "https://evil.example/v1" },
    });
    // Key is required for openai-compatible and now cleared -> retype it.
    fireEvent.change(document.getElementById("edit-apikey")!, { target: { value: "sk-for-new-host" } });
    fireEvent.click(screen.getByRole("button", { name: /save/i }));

    await waitFor(() => expect(store.save).toHaveBeenCalledWith(expect.objectContaining({ id: "3" })));
    expect(store.deleteKey).toHaveBeenCalledWith("3");
    expect(store.setKey).toHaveBeenCalledWith("3", "sk-for-new-host");
  });

  // --- MINOR 1: the hasKey probe must not surface an unhandled rejection ---

  it("treats a failing hasKey probe as no stored key, without throwing", async () => {
    const store = mockStore({
      hasKey: vi.fn(async () => {
        throw new Error("probe boom");
      }),
    });
    mockDeps({ profiles: store });
    render(<ProfilesBlock />);
    fireEvent.click((await screen.findAllByRole("button", { name: /edit/i }))[0]);
    await waitFor(() => expect(screen.queryByText(/•••• set/)).toBeNull());
    expect(document.getElementById("edit-apikey")).toBeTruthy();
  });

  // --- MINOR 2: a key typed during the hasKey probe window must not be dropped silently ---

  it("clears a key typed while the hasKey probe is still in flight once it resolves true, instead of dropping it on Save", async () => {
    let resolveHasKey!: (v: boolean) => void;
    const hasKeyPromise = new Promise<boolean>((res) => {
      resolveHasKey = res;
    });
    const store = mockStore({ hasKey: vi.fn(() => hasKeyPromise) });
    mockDeps({ profiles: store });
    render(<ProfilesBlock />);
    // profile "1" (anthropic, Work) — hasKey probe is unresolved on mount.
    fireEvent.click((await screen.findAllByRole("button", { name: /edit/i }))[0]);

    // Probe still pending: hasKeyFact defaults false, so the real input renders.
    expect(screen.queryByText(/•••• set/)).toBeNull();
    const apiKeyInput = document.getElementById("edit-apikey") as HTMLInputElement;
    expect(apiKeyInput).toBeTruthy();
    fireEvent.change(apiKeyInput, { target: { value: "sk-typed-during-probe" } });
    expect(apiKeyInput.value).toBe("sk-typed-during-probe");

    // Probe resolves true: the masked badge takes over the field. Masking
    // alone isn't proof of a fix — hasStoredKey is driven by hasKeyFact,
    // independent of whatever is still sitting in fields.apiKey.
    resolveHasKey(true);
    await screen.findByText(/•••• set/);

    // Clicking Replace re-shows the key input. Pre-fix, fields.apiKey still
    // holds the pre-probe-resolution text, so the old value silently
    // resurfaces here — looking like a saved draft the user never confirmed
    // as a replacement. Post-fix the transition cleared it, so Replace
    // always starts from a blank input.
    fireEvent.click(screen.getByRole("button", { name: /replace/i }));
    const replacedInput = document.getElementById("edit-apikey") as HTMLInputElement;
    expect(replacedInput).toBeTruthy();
    expect(replacedInput.value).toBe("");
  });
});
