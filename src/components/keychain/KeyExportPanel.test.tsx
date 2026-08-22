import { test, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup, act, fireEvent, screen } from "@testing-library/react";
import type { SshKey } from "@/types";

const h = vi.hoisted(() => ({
  ensurePublicKey: vi.fn(async (..._a: unknown[]) => "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5 me@laptop" as string | null),
  addKeyToHost: vi.fn(async (..._a: unknown[]) => {}),
  addToast: vi.fn(),
  connections: [{ id: "c1", name: "prod", host: "example.test", port: 22, username: "root" }],
}));

vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (k: string) => k }) }));
vi.mock("@iconify/react", () => ({ Icon: () => null }));
vi.mock("@/services/publicKeyStore", () => ({ ensurePublicKey: (...a: unknown[]) => h.ensurePublicKey(...a) }));
vi.mock("@/services/keyExport", () => ({
  addKeyToHost: (...a: unknown[]) => h.addKeyToHost(...a),
  DEFAULT_EXPORT_SCRIPT: "script",
}));
vi.mock("@/stores/connectionStore", () => ({
  useConnectionStore: () => ({ connections: h.connections, loadConnections: vi.fn(async () => {}) }),
}));
vi.mock("@/stores/notificationStore", () => ({
  useNotificationStore: { getState: () => ({ addToast: h.addToast }) },
}));
vi.mock("./KeyCards", () => ({ KeyCardContent: () => null }));
vi.mock("@/components/shared/HostPickerPanel", () => ({
  HostPickerPanel: ({ onPick }: { onPick: (h: unknown) => void }) => (
    <button data-pick-host onClick={() => onPick({ kind: "remote", connection: h.connections[0] })} />
  ),
}));

const { KeyExportPanel } = await import("./KeyExportPanel");

const sshKey = { id: "k1", name: "laptop", vault_id: "personal" } as SshKey;

function renderPanel() {
  const onClose = vi.fn();
  render(<KeyExportPanel sshKey={sshKey} onClose={onClose} />);
  return { onClose };
}

const footer = () => document.querySelector("[data-export-footer]") as HTMLElement;
const exportButton = () => footer().querySelector("button") as HTMLButtonElement;

async function pickHost() {
  await act(async () => {
    fireEvent.click(document.querySelector("[data-pick-host]")!);
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  h.ensurePublicKey.mockResolvedValue("ssh-ed25519 AAAAC3NzaC1lZDI1NTE5 me@laptop");
  h.addKeyToHost.mockResolvedValue(undefined);
});
afterEach(() => cleanup());

test("refuses the deploy up front when the key has no public half to send", async () => {
  h.ensurePublicKey.mockResolvedValue(null);
  renderPanel();
  await act(async () => { await Promise.resolve(); });
  await pickHost();
  // The old failure mode was a host picked, a button clicked, and only then an
  // error — with a key whose public half could never have been found.
  expect(screen.getByText("keychain.exportPanel.missingPublicKeyNotice")).toBeTruthy();
  expect(exportButton().disabled).toBe(true);
});

test("deploys once a host is picked and the public half is in hand", async () => {
  renderPanel();
  await act(async () => { await Promise.resolve(); });
  expect(exportButton().disabled).toBe(true);
  await pickHost();
  expect(exportButton().disabled).toBe(false);
  await act(async () => { fireEvent.click(exportButton()); });
  expect(h.addKeyToHost).toHaveBeenCalledWith(expect.objectContaining({ sshKey, connection: h.connections[0] }));
});

test("keeps a failure pinned beside the button instead of below the fold", async () => {
  h.addKeyToHost.mockRejectedValue(new Error("Remote command failed: permission denied"));
  renderPanel();
  await act(async () => { await Promise.resolve(); });
  await pickHost();
  await act(async () => { fireEvent.click(exportButton()); });
  expect(footer().contains(screen.getByText(/permission denied/))).toBe(true);
});

test("reports success as a toast and closes the panel", async () => {
  const { onClose } = renderPanel();
  await act(async () => { await Promise.resolve(); });
  await pickHost();
  await act(async () => { fireEvent.click(exportButton()); });
  expect(h.addToast).toHaveBeenCalledWith(
    expect.objectContaining({ severity: "success", message: "keychain.exportPanel.successMessage" }),
  );
  expect(onClose).toHaveBeenCalled();
});
