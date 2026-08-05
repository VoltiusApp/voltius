import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { installCatalogI18n } from "../testing/fakeI18n";
import { ProfileSwitcher } from "./ProfileSwitcher";
import * as storeMod from "../state/agentStore";
import { useAgentStore } from "../state/agentStore";
import type { ProviderProfile } from "../types";

installCatalogI18n();

// @iconify/react schedules an async icon-data-load timer that can fire after
// this file's jsdom environment is torn down, touching `window` and surfacing
// as an unhandled error unrelated to any assertion here. Stub it out.
vi.mock("@iconify/react", () => ({
  Icon: ({ icon }: { icon: string }) => <span data-icon={icon} />,
}));

const gpt: ProviderProfile = {
  id: "p-openai",
  providerKind: "openai-compatible",
  label: "OpenAI-compatible",
  baseUrl: "https://api.example.com",
  model: "gpt-4o-mini",
};

const claude: ProviderProfile = {
  id: "p-anthropic",
  providerKind: "anthropic",
  label: "Anthropic",
  model: "claude-opus-4-8",
};

function mockDeps(opts: {
  activeId: string | null;
  profiles: ProviderProfile[];
  setActive?: ReturnType<typeof vi.fn>;
  list?: ReturnType<typeof vi.fn>;
}) {
  // Tracks the id a real ProfilesStore would persist, so getActiveId reflects
  // a prior setActive call instead of a fixed snapshot from render time.
  let currentActiveId = opts.activeId;
  const setActive = opts.setActive ?? vi.fn(async (id: string) => { currentActiveId = id; });
  const list = opts.list ?? vi.fn().mockResolvedValue(opts.profiles);
  vi.spyOn(storeMod, "getAgentDeps").mockReturnValue({
    profiles: {
      getActiveId: vi.fn(async () => currentActiveId),
      list,
      setActive,
    },
  } as never);
  return { setActive };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("ProfileSwitcher", () => {
  it("renders the active profile's label and model", async () => {
    mockDeps({ activeId: gpt.id, profiles: [gpt, claude] });
    render(<ProfileSwitcher />);

    await waitFor(() => expect(screen.getByTitle("Switch AI provider").textContent).toContain("OpenAI-compatible"));
    expect(screen.getByTitle("Switch AI provider").textContent).toContain("gpt-4o-mini");
  });

  it("opening the switcher lists all saved profiles", async () => {
    mockDeps({ activeId: gpt.id, profiles: [gpt, claude] });
    render(<ProfileSwitcher />);
    await waitFor(() => expect(screen.getByTitle("Switch AI provider").textContent).toContain("gpt-4o-mini"));

    await userEvent.click(screen.getByTitle("Switch AI provider"));

    const menu = screen.getByRole("menu");
    expect(menu.textContent).toContain("OpenAI-compatible");
    expect(menu.textContent).toContain("gpt-4o-mini");
    expect(menu.textContent).toContain("Anthropic");
    expect(menu.textContent).toContain("claude-opus-4-8");
    expect(screen.getByText("Add provider…")).toBeTruthy();
  });

  it("selecting a different profile calls setActive with its id and updates the displayed active profile", async () => {
    const { setActive } = mockDeps({ activeId: gpt.id, profiles: [gpt, claude] });
    render(<ProfileSwitcher />);
    await waitFor(() => expect(screen.getByTitle("Switch AI provider").textContent).toContain("gpt-4o-mini"));

    await userEvent.click(screen.getByTitle("Switch AI provider"));
    await userEvent.click(screen.getByText("claude-opus-4-8"));

    expect(setActive).toHaveBeenCalledWith(claude.id);
    await waitFor(() => expect(screen.getByTitle("Switch AI provider").textContent).toContain("claude-opus-4-8"));
    expect(screen.getByTitle("Switch AI provider").textContent).toContain("Anthropic");
    // Selecting closes the popover.
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("selecting a different profile bumps profilesVersion, so a settings page open behind the drawer re-reads", async () => {
    mockDeps({ activeId: gpt.id, profiles: [gpt, claude] });
    render(<ProfileSwitcher />);
    await waitFor(() => expect(screen.getByTitle("Switch AI provider").textContent).toContain("gpt-4o-mini"));

    const before = useAgentStore.getState().profilesVersion;
    await userEvent.click(screen.getByTitle("Switch AI provider"));
    await userEvent.click(screen.getByText("claude-opus-4-8"));

    await waitFor(() => expect(useAgentStore.getState().profilesVersion).toBeGreaterThan(before));
  });

  it("'Add provider…' renders the FirstRunCard inline instead of the profile list", async () => {
    mockDeps({ activeId: gpt.id, profiles: [gpt] });
    render(<ProfileSwitcher />);
    await waitFor(() => expect(screen.getByTitle("Switch AI provider").textContent).toContain("gpt-4o-mini"));

    await userEvent.click(screen.getByTitle("Switch AI provider"));
    await userEvent.click(screen.getByText("Add provider…"));

    expect(screen.getByText("Set up your AI provider")).toBeTruthy();
    expect(screen.getByLabelText(/Provider/i)).toBeTruthy();
    // The profile list is replaced, not stacked alongside the form.
    expect(screen.queryByText("Add provider…")).toBeNull();
  });

  it("shows a placeholder when no profile is active", async () => {
    mockDeps({ activeId: null, profiles: [] });
    render(<ProfileSwitcher />);
    await waitFor(() => expect(screen.getByTitle("Switch AI provider").textContent).toContain("No provider"));
  });

  it("re-reads profiles when profilesVersion changes", async () => {
    const list = vi
      .fn()
      .mockResolvedValueOnce([{ id: "1", providerKind: "anthropic", label: "First", model: "m1" }])
      .mockResolvedValueOnce([{ id: "1", providerKind: "anthropic", label: "Renamed", model: "m1" }]);
    mockDeps({ activeId: "1", profiles: [], list });

    render(<ProfileSwitcher />);
    expect(await screen.findByText(/First/)).toBeTruthy();

    act(() => useAgentStore.getState().bumpProfilesVersion());
    expect(await screen.findByText(/Renamed/)).toBeTruthy();
  });
});
