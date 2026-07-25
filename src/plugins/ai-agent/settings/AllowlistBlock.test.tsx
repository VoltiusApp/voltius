import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { AllowlistBlock } from "./AllowlistBlock";
import { useAgentStore } from "../state/agentStore";
import * as storeMod from "../state/agentStore";

const CONNS = [
  { id: "c1", name: "Prod DB", host: "web-01", port: 22, username: "deploy", auth_type: "key", tags: [] },
];

vi.mock("@iconify/react", () => ({ Icon: () => null }));
// Identity `t` (key in, key out) keeps most assertions robust to copy changes,
// same convention as ProfilesBlock.test.tsx. The one key whose literal
// rendered text an assertion depends on — the "local" group's translated
// heading — is special-cased to a stand-in real value; no dotted key can
// ever equal the raw scope string "local" it's being compared against.
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (k: string) => {
      if (k === "aiAgent.settings.allowlist.localScope") return "local";
      return k;
    },
  }),
}));
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const entries = [
  { scope: "c1", tool: "run_command", grain: "exact" as const, key: "df -h" },
  { scope: "c1", tool: "run_command", grain: "exact" as const, key: "uptime" },
  { scope: "local", tool: "open_session", grain: "tool" as const, key: "open_session" },
];

describe("AllowlistBlock", () => {
  it("groups grants by scope", () => {
    useAgentStore.setState({ allowlist: entries });
    render(<AllowlistBlock />);
    expect(screen.getByText("c1")).toBeTruthy();
    expect(screen.getByText("local")).toBeTruthy();
  });

  it("revokes exactly the row that was clicked", () => {
    useAgentStore.setState({ allowlist: entries });
    render(<AllowlistBlock />);
    fireEvent.click(screen.getAllByRole("button", { name: /revoke/i })[0]);
    const left = useAgentStore.getState().allowlist;
    expect(left).toHaveLength(2);
    expect(left.some((e) => e.grain === "exact" && e.key === "df -h")).toBe(false);
  });

  it("revoke-all clears every scope after confirmation", () => {
    useAgentStore.setState({ allowlist: entries });
    render(<AllowlistBlock />);
    fireEvent.click(screen.getByRole("button", { name: /revokeAll/i }));
    expect(useAgentStore.getState().allowlist).toHaveLength(3); // not yet
    fireEvent.click(screen.getByRole("button", { name: /confirm/i }));
    expect(useAgentStore.getState().allowlist).toHaveLength(0);
  });

  it("renders an empty state instead of a bare container", () => {
    useAgentStore.setState({ allowlist: [] });
    render(<AllowlistBlock />);
    expect(screen.getByText(/empty/)).toBeTruthy();
  });

  it("groups by connection name and shows the endpoint as detail", async () => {
    vi.spyOn(storeMod, "getAgentDeps").mockReturnValue({
      api: { connections: { list: async () => CONNS } },
    } as never);
    useAgentStore.setState({ allowlist: [{ scope: "c1", tool: "run_command", grain: "exact", key: "df -h" }] });
    render(<AllowlistBlock />);
    expect(await screen.findByText("Prod DB")).toBeTruthy();
    expect(screen.getByText("deploy@web-01:22")).toBeTruthy();
    expect(screen.getByText("df -h")).toBeTruthy();
  });
});
