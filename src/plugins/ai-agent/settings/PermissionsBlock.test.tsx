import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { PermissionsBlock } from "./PermissionsBlock";
import type { PluginAPI } from "@/plugins/api";

vi.mock("@iconify/react", () => ({ Icon: () => null }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (k: string) => k }) }));

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

function comboValue() {
  return (screen.getByRole("combobox") as HTMLSelectElement).value;
}

describe("PermissionsBlock", () => {
  it("shows the stored default, falling back to ask", async () => {
    render(<PermissionsBlock api={makeApi("auto")} />);
    await waitFor(() => expect(comboValue()).toBe("auto"));
  });

  it("defaults to ask when nothing is stored", async () => {
    render(<PermissionsBlock api={makeApi(undefined)} />);
    await waitFor(() => expect(comboValue()).toBe("ask"));
  });

  it("writes the selection to the agentMode storage key", async () => {
    const api = makeApi("ask");
    render(<PermissionsBlock api={api} />);
    await waitFor(() => expect(comboValue()).toBe("ask"));
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "plan" } });
    await waitFor(() => expect(api.storage.set).toHaveBeenCalledWith("agentMode", "plan"));
  });

  it("audits a default-mode change with target: default", async () => {
    const api = makeApi("ask");
    render(<PermissionsBlock api={api} />);
    await waitFor(() => expect(comboValue()).toBe("ask"));
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "auto" } });
    await waitFor(() => expect(auditAgentAction).toHaveBeenCalledTimes(1));
    expect(auditAgentAction).toHaveBeenCalledWith(
      "local", "agent.mode_changed", { from: "ask", to: "auto", target: "default" },
    );
  });

  it("does NOT audit selecting the already-current mode", async () => {
    const api = makeApi("auto");
    render(<PermissionsBlock api={api} />);
    await waitFor(() => expect(comboValue()).toBe("auto"));
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "auto" } });
    expect(auditAgentAction).not.toHaveBeenCalled();
  });
});
