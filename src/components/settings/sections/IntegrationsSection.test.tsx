import { test, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, act, fireEvent } from "@testing-library/react";

const h = vi.hoisted(() => ({
  getMcpStatus: vi.fn(),
  writeClipboard: vi.fn(async () => {}),
  toggle: false,
  setToggle: vi.fn(),
}));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (k: string) => k }) }));
vi.mock("@iconify/react", () => ({ Icon: () => null }));
vi.mock("@/mcp/status", () => ({ getMcpStatus: h.getMcpStatus }));
vi.mock("@/utils/clipboard", () => ({ writeClipboard: h.writeClipboard }));
vi.mock("@/stores/toggleSettingsStore", () => ({
  useToggle: () => [h.toggle, h.setToggle],
  TOGGLE_DEFS: { "mcp-server": { default: false } },
}));

import IntegrationsSection from "./IntegrationsSection";

beforeEach(() => {
  h.getMcpStatus.mockReset();
  h.writeClipboard.mockClear();
  h.toggle = false;
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
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
  screen.getByDisplayValue("npx add-mcp@2 '/home/user/Voltius Apps/voltius' --args mcp -n voltius -g");
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
  screen.getByDisplayValue('npx add-mcp@2 "C:\\Program Files\\Voltius\\voltius.exe" --args mcp -n voltius -g');
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
