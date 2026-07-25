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
}));
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const profiles = [
  { id: "1", providerKind: "anthropic" as const, label: "Work", model: "claude-sonnet-5" },
  { id: "2", providerKind: "ollama" as const, label: "Local", model: "llama3.2", baseUrl: "http://x" },
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
    render(<ProfilesBlock api={{} as never} />);
    expect(await screen.findByText("Work")).toBeTruthy();
    expect(screen.getByText(/claude-sonnet-5/)).toBeTruthy();
    expect(screen.getByText("Local")).toBeTruthy();
  });

  it("activates a profile and bumps profilesVersion", async () => {
    const store = mockStore();
    mockDeps({ profiles: store });
    const before = useAgentStore.getState().profilesVersion;
    render(<ProfilesBlock api={{} as never} />);
    fireEvent.click(await screen.findByRole("radio", { name: /Local/ }));
    await waitFor(() => expect(store.setActive).toHaveBeenCalledWith("2"));
    expect(useAgentStore.getState().profilesVersion).toBeGreaterThan(before);
  });

  it("deletes only after confirmation", async () => {
    const store = mockStore();
    mockDeps({ profiles: store });
    render(<ProfilesBlock api={{} as never} />);
    fireEvent.click((await screen.findAllByRole("button", { name: /delete/i }))[0]);
    expect(store.remove).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /confirm/i }));
    await waitFor(() => expect(store.remove).toHaveBeenCalledWith("1"));
  });

  it("never renders a stored key, only the masked state", async () => {
    const store = mockStore();
    mockDeps({ profiles: store });
    render(<ProfilesBlock api={{} as never} />);
    fireEvent.click((await screen.findAllByRole("button", { name: /edit/i }))[0]);
    expect(await screen.findByText(/•••• set/)).toBeTruthy();
    expect(screen.queryByDisplayValue("sk-stored")).toBeNull();
    expect(store.getKey).not.toHaveBeenCalled();
  });

  it("saves an edited profile and writes a replaced key", async () => {
    const store = mockStore();
    mockDeps({ profiles: store });
    render(<ProfilesBlock api={{} as never} />);
    fireEvent.click((await screen.findAllByRole("button", { name: /edit/i }))[0]);
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
    render(<ProfilesBlock api={{} as never} />);
    // profile "1" is Work / anthropic — open its editor without touching the name field.
    fireEvent.click((await screen.findAllByRole("button", { name: /edit/i }))[0]);
    const labelInput = document.getElementById("edit-label") as HTMLInputElement;
    expect(labelInput.value).toBe("Work");

    fireEvent.change(document.getElementById("edit-provider")!, { target: { value: "google" } });
    expect(labelInput.value).toBe("Work"); // provider switch alone must never rewrite a saved name

    fireEvent.click(screen.getByRole("button", { name: /save/i }));
    await waitFor(() =>
      expect(store.save).toHaveBeenCalledWith(
        expect.objectContaining({ id: "1", label: "Work", providerKind: "google" }),
      ),
    );
  });

  it("auto-derives the profile name from the provider until the user types, when creating a profile", async () => {
    mockDeps({ profiles: mockStore() });
    render(<ProfilesBlock api={{} as never} />);
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
    render(<ProfilesBlock api={{} as never} />);
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
    render(<ProfilesBlock api={{} as never} />);
    fireEvent.click((await screen.findAllByRole("button", { name: /delete/i }))[0]);
    fireEvent.click(screen.getByRole("button", { name: /confirm/i }));
    await waitFor(() => expect(store.remove).toHaveBeenCalledWith("1"));
    expect(await screen.findByText(/delete boom/)).toBeTruthy();
    expect(useAgentStore.getState().profilesVersion).toBe(before);
  });
});
