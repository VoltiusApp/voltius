import { test, expect, vi, beforeEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

const h = vi.hoisted(() => ({ overlayProps: null as Record<string, unknown> | null }));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));
vi.mock("@iconify/react", () => ({ Icon: () => null }));
vi.mock("@/utils/icons", () => ({
  getConnectionIcon: () => "lucide:server",
  getConnectionIconColor: () => "#fff",
}));
vi.mock("@/components/shared/AvatarTile", () => ({
  AvatarTile: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/shared/HostPickerPanel", () => ({ HostPickerPanel: () => null }));
vi.mock("@/components/shared/ToolbarViewControls", () => ({ FilterInput: () => null }));
vi.mock("./FilePane", () => ({ FilePane: () => null }));
vi.mock("@/stores/hostPingStore", () => ({ useHostPingStore: () => undefined }));
vi.mock("@/stores/toggleSettingsStore", () => ({ useToggle: () => [false] }));
vi.mock("@/components/terminal/connection-overlay", () => ({
  default: (p: Record<string, unknown>) => {
    h.overlayProps = p;
    return <div data-testid="overlay" />;
  },
  getSftpSteps: () => [],
}));

import { SidePane } from "./SidePane";
import type { HostChoice, SidePhase } from "./SFTPTypes";

const host = {
  kind: "remote",
  connection: { id: "c1", name: "srv", host: "h", port: 22, username: "u" },
} as unknown as HostChoice;

const props = {
  host,
  refreshTick: 0,
  onPick: vi.fn(),
  onNavigate: vi.fn(),
  onSelect: vi.fn(),
  onRefresh: vi.fn(),
  onChangeHost: vi.fn(),
  side: "left" as const,
  onDropFiles: vi.fn(),
};

const renderPhase = (phase: SidePhase) => render(<SidePane {...props} phase={phase} />);

beforeEach(() => {
  cleanup();
  h.overlayProps = null;
});

// The credentials are stored and the panel can offer to unlock; printing the
// translated message instead leaves the user with no action.
test("an SFTP connect blocked by the vault gets the overlay, not the raw message", () => {
  renderPhase({ tag: "error", message: "common.error.vaultUnreadable", errorCode: "vault-unreadable", host });

  expect(screen.getByTestId("overlay")).toBeTruthy();
  expect(h.overlayProps).toMatchObject({ status: "error", errorCode: "vault-unreadable" });
  expect(screen.queryByText("common.error.vaultUnreadable")).toBeNull();
});

test("an ordinary connect failure still shows its message and a retry", () => {
  renderPhase({ tag: "error", message: "Connection refused", host });

  expect(screen.getByText("Connection refused")).toBeTruthy();
  expect(screen.getByText("fileTransfer.side.tryAgain")).toBeTruthy();
  expect(h.overlayProps).toBeNull();
});
