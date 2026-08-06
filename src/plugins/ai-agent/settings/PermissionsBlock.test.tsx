import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { PermissionsBlock } from "./PermissionsBlock";
import type { PluginAPI } from "@/plugins/api";
import { installFakeI18n } from "../testing/fakeI18n";

installFakeI18n((k: string) => k);

vi.mock("@iconify/react", () => ({ Icon: () => null }));
const { auditAgentAction } = vi.hoisted(() => ({ auditAgentAction: vi.fn() }));
vi.mock("../state/auditSeam", () => ({ auditAgentAction }));

afterEach(() => {
  cleanup();
  auditAgentAction.mockClear();
});

function makeApi(stored?: string) {
  return {
    storage: {
      get: vi.fn(async () => stored),
      set: vi.fn(async () => {}),
      delete: vi.fn(async () => {}),
    },
  } as unknown as PluginAPI;
}

const LABEL = "aiAgent.settings.permissions.defaultMode.title";

/** The FormSelect trigger renders the selected option's label as its text. */
function comboValue() {
  return screen.getByLabelText(LABEL).textContent ?? "";
}

async function pick(mode: string) {
  fireEvent.click(screen.getByLabelText(LABEL));
  // The trigger renders the selected label too, so re-picking the current mode
  // matches twice — the menu item is always the last match.
  const options = await screen.findAllByText(`aiAgent.settings.permissions.defaultMode.${mode}`);
  fireEvent.click(options[options.length - 1]);
}

describe("PermissionsBlock", () => {
  it("shows the stored default, falling back to ask", async () => {
    render(<PermissionsBlock api={makeApi("auto")} />);
    await waitFor(() => expect(comboValue()).toContain("auto"));
  });

  it("defaults to ask when nothing is stored", async () => {
    render(<PermissionsBlock api={makeApi(undefined)} />);
    await waitFor(() => expect(comboValue()).toContain("ask"));
  });

  it("writes the selection to the agentMode storage key", async () => {
    const api = makeApi("ask");
    render(<PermissionsBlock api={api} />);
    await waitFor(() => expect(comboValue()).toContain("ask"));
    await pick("plan");
    await waitFor(() => expect(api.storage.set).toHaveBeenCalledWith("agentMode", "plan"));
  });

  it("audits a default-mode change with target: default", async () => {
    const api = makeApi("ask");
    render(<PermissionsBlock api={api} />);
    await waitFor(() => expect(comboValue()).toContain("ask"));
    await pick("auto");
    await waitFor(() => expect(auditAgentAction).toHaveBeenCalledTimes(1));
    expect(auditAgentAction).toHaveBeenCalledWith(
      "local", "agent.mode_changed", { from: "ask", to: "auto", target: "default" },
    );
  });

  it("does NOT audit selecting the already-current mode", async () => {
    const api = makeApi("auto");
    render(<PermissionsBlock api={api} />);
    await waitFor(() => expect(comboValue()).toContain("auto"));
    await pick("auto");
    expect(auditAgentAction).not.toHaveBeenCalled();
  });
});
