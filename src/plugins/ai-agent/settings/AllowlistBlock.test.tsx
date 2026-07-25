import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { AllowlistBlock } from "./AllowlistBlock";
import { useAgentStore } from "../state/agentStore";

vi.mock("@iconify/react", () => ({ Icon: () => null }));
// Identity `t` (key in, key out) keeps most assertions robust to copy changes,
// same convention as ProfilesBlock.test.tsx. The one key whose literal
// rendered text an assertion depends on — the "local" group's translated
// heading — is special-cased to a stand-in real value; no dotted key can
// ever equal the raw host string "local" it's being compared against.
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (k: string) => {
      if (k === "aiAgent.settings.allowlist.localHost") return "local";
      return k;
    },
  }),
}));
afterEach(cleanup);

const entries = [
  { host: "ssh-host-1", tool: "run_command", grain: "exact" as const, key: "df -h" },
  { host: "ssh-host-1", tool: "run_command", grain: "exact" as const, key: "uptime" },
  { host: "local", tool: "open_session", grain: "tool" as const, key: "open_session" },
];

describe("AllowlistBlock", () => {
  it("groups grants by host", () => {
    useAgentStore.setState({ allowlist: entries });
    render(<AllowlistBlock />);
    expect(screen.getByText("ssh-host-1")).toBeTruthy();
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

  it("revoke-all clears every host after confirmation", () => {
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
});
