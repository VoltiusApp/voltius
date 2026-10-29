import { test, expect, vi, beforeEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

const h = vi.hoisted(() => ({ overlayProps: null as Record<string, unknown> | null }));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string, o?: Record<string, unknown>) => (o ? `${k}:${Object.values(o).join(",")}` : k) }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));
vi.mock("@iconify/react", () => ({ Icon: () => null }));
vi.mock("@/utils/icons", () => ({
  getConnectionIcon: () => "lucide:server",
  getConnectionIconColor: () => "#fff",
  deviceIcon: () => "lucide:monitor",
  DEVICE_TILE_BASE: "#000",
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
  getSftpSteps: () => [{ id: "tcp_connected", label: "tcp" }],
  getDeviceSteps: (name: string) => [{ id: "device_approval", label: `approval ${name}` }],
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

test("a read-only device shows the marker and disables upload", () => {
  const onUpload = vi.fn();
  const phase: SidePhase = { tag: "connected", sftpId: "s", cwd: "/", selected: [], readOnly: true };
  render(<SidePane {...props} phase={phase} onUpload={onUpload} />);
  expect(document.querySelector("[data-read-only-badge]")?.textContent).toBe("fileTransfer.myDevices.readOnlyBadge");
  expect((screen.getAllByTitle(/readOnlyShare/).find((el) => el.tagName === "BUTTON") as HTMLButtonElement).disabled).toBe(true);
  cleanup();
  render(<SidePane {...props} phase={{ ...phase, readOnly: false }} onUpload={onUpload} />);
  expect(document.querySelector("[data-read-only-badge]")).toBeNull();
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

const device = {
  kind: "device",
  device: { deviceId: "d1", deviceKey: "k1", name: "Desktop-PC", platform: "linux", state: "ready", route: "tailscale", lastSeen: null },
} as HostChoice;

test("a device connect shows the device steps", () => {
  render(<SidePane {...props} host={device} phase={{ tag: "connecting", connectId: "x1", host: device }} />);

  expect(h.overlayProps).toMatchObject({ name: "Desktop-PC", steps: [{ id: "device_approval", label: "approval Desktop-PC" }] });
});

test("a connected device shows its route and latency", () => {
  render(<SidePane {...props} host={device} phase={{ tag: "connected", sftpId: "s1", cwd: "/", selected: [], route: "tailscale", rttMs: 41 }} />);

  expect(screen.getByText("fileTransfer.myDevices.routeChip:layout.sync.local.route.tailscale,41")).toBeTruthy();
});
