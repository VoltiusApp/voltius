import { test, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, act, fireEvent } from "@testing-library/react";
import { clearContributions, registerContributions } from "@/mcp/contributions";
import { isPluginExposed, useMcpContributionStore } from "@/stores/mcpContributionStore";

const h = vi.hoisted(() => ({
  getMcpStatus: vi.fn(),
  writeClipboard: vi.fn(async () => {}),
  invoke: vi.fn(async () => {}),
  toggle: false,
  setToggle: vi.fn(),
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));
vi.mock("@iconify/react", () => ({ Icon: () => null }));
vi.mock("@/mcp/status", () => ({ getMcpStatus: h.getMcpStatus }));
vi.mock("@/utils/clipboard", () => ({ writeClipboard: h.writeClipboard }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: h.invoke }));
vi.mock("@/plugins/runtime", () => ({ getLoadedPlugins: () => [{ id: "plugin-docker", name: "Docker" }] }));
vi.mock("@/stores/toggleSettingsStore", () => ({
  useToggle: () => [h.toggle, h.setToggle],
  TOGGLE_DEFS: { "mcp-server": { default: false } },
}));

import IntegrationsSection from "./IntegrationsSection";

function renderSection() {
  return render(<IntegrationsSection />);
}

beforeEach(() => {
  h.getMcpStatus.mockReset();
  h.getMcpStatus.mockResolvedValue({ enabled: false, exePath: "", socketPath: "" });
  h.writeClipboard.mockClear();
  h.invoke.mockClear();
  h.toggle = false;
  useMcpContributionStore.setState({ exposed: {} });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  clearContributions("plugin-docker");
});

test("renders the one-liner add-mcp command with the backend-supplied exe path, quoted", async () => {
  h.getMcpStatus.mockResolvedValue({
    enabled: false,
    socketPath: "/home/user/.voltius/mcp.sock",
    exePath: "/home/user/Voltius Apps/voltius",
  });
  await act(async () => {
    render(<IntegrationsSection />);
  });
  screen.getByDisplayValue("npx -y add-mcp@2 '/home/user/Voltius Apps/voltius' --args mcp -n voltius -g");
});

test("shows the setup command even when the server toggle is off", async () => {
  h.toggle = false;
  h.getMcpStatus.mockResolvedValue({
    enabled: false,
    socketPath: "\\\\.\\pipe\\voltius-mcp",
    exePath: "C:\\Program Files\\Voltius\\voltius.exe",
  });
  await act(async () => {
    render(<IntegrationsSection />);
  });
  screen.getByDisplayValue('npx -y add-mcp@2 "C:\\Program Files\\Voltius\\voltius.exe" --args mcp -n voltius -g');
});

test("manual setup is collapsed by default and reveals the socket path and per-client snippet once opened", async () => {
  h.getMcpStatus.mockResolvedValue({
    enabled: false,
    socketPath: "/home/user/.voltius/mcp.sock",
    exePath: "/home/user/Voltius Apps/voltius",
  });
  await act(async () => {
    render(<IntegrationsSection />);
  });
  expect(screen.queryByDisplayValue("/home/user/.voltius/mcp.sock")).toBeNull();
  expect(
    screen.queryByDisplayValue("claude mcp add voltius -- '/home/user/Voltius Apps/voltius' mcp"),
  ).toBeNull();

  fireEvent.click(screen.getByText("settings.integrations.mcp.manualSetup.toggleLabel"));

  screen.getByDisplayValue("/home/user/.voltius/mcp.sock");
  screen.getByDisplayValue("claude mcp add voltius -- '/home/user/Voltius Apps/voltius' mcp");
});

it("lists a contributing plugin's tools and toggles it off", async () => {
  registerContributions("plugin-docker", [
    { name: "container_list", description: "List containers.", inputSchema: { type: "object" }, execute: async () => [] },
  ]);
  renderSection();
  await screen.findByText("Docker");
  screen.getByText(/docker__container_list/);

  const toggle = screen.getByRole("switch", { name: /docker/i });
  fireEvent.click(toggle);
  expect(isPluginExposed("plugin-docker")).toBe(false);
});
