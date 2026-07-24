import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ProfileSwitcher } from "./ProfileSwitcher";
import * as storeMod from "../state/agentStore";
import type { ProviderProfile } from "../types";

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

function mockDeps(opts: { activeId: string | null; profiles: ProviderProfile[]; setActive?: ReturnType<typeof vi.fn> }) {
  const setActive = opts.setActive ?? vi.fn(async () => {});
  vi.spyOn(storeMod, "getAgentDeps").mockReturnValue({
    profiles: {
      getActiveId: vi.fn().mockResolvedValue(opts.activeId),
      list: vi.fn().mockResolvedValue(opts.profiles),
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
});
