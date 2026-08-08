import { test, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, act } from "@testing-library/react";

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

test("renders the client-registration command with the backend-supplied exe path, quoted", async () => {
  h.getMcpStatus.mockResolvedValue({
    enabled: false,
    socketPath: "/home/user/.voltius/mcp.sock",
    exePath: "/home/user/Voltius Apps/voltius",
  });
  await act(async () => {
    render(<IntegrationsSection />);
  });
  screen.getByDisplayValue("claude mcp add voltius -- '/home/user/Voltius Apps/voltius' mcp");
});

test("shows the raw socket path as a secondary line", async () => {
  h.getMcpStatus.mockResolvedValue({
    enabled: false,
    socketPath: "/home/user/.voltius/mcp.sock",
    exePath: "/usr/bin/voltius",
  });
  await act(async () => {
    render(<IntegrationsSection />);
  });
  screen.getByDisplayValue("/home/user/.voltius/mcp.sock");
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
  screen.getByDisplayValue('claude mcp add voltius -- "C:\\Program Files\\Voltius\\voltius.exe" mcp');
});
