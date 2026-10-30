import { test, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, act } from "@testing-library/react";
import type { Connection, Folder } from "@/types";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));
vi.mock("@iconify/react", () => ({ Icon: () => null }));
vi.mock("@/components/shared/ConnectionAvatar", () => ({ ConnectionAvatar: () => null }));
vi.mock("./BottomSheet", () => ({ default: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));

const devices = vi.hoisted(() => {
  const listeners = new Set<() => void>();
  const state = { rows: [] as unknown[] };
  return {
    get rows() { return state.rows; },
    set rows(v: unknown[]) { state.rows = v; listeners.forEach((l) => l()); },
    subscribe: (l: () => void) => { listeners.add(l); return () => listeners.delete(l); },
  };
});
vi.mock("@/services/myDevices", async (orig) => {
  const { useSyncExternalStore } = await import("react");
  return {
    ...(await orig<typeof import("@/services/myDevices")>()),
    useMyDevices: () => useSyncExternalStore(devices.subscribe, () => devices.rows),
  };
});

import SftpHostPickerSheet from "./SftpHostPickerSheet";
import { useConnectionStore } from "@/stores/connectionStore";
import { useFolderStore } from "@/stores/folderStore";
import { useTeamStore } from "@/stores/teamStore";
import { useVaultStore } from "@/stores/vaultStore";

const initial = [useConnectionStore, useFolderStore, useTeamStore, useVaultStore].map((s) => [s, s.getState()] as const);

afterEach(() => {
  cleanup();
  devices.rows = [];
  for (const [store, state] of initial) (store.setState as (s: unknown, r: true) => void)(state, true);
});

function host(id: string, vault: string, extra: Partial<Connection> = {}): Connection {
  return { id, name: id, host: `${id}.lan`, port: 22, username: "u", vault_id: vault, ...extra } as Connection;
}

function seed() {
  useConnectionStore.setState({
    connections: [host("home-box", "personal", { folder_id: "servers" }), host("modem", "personal", { connection_type: "serial" } as Partial<Connection>)],
    teamConnections: { t1: [host("team-box", "t1")] },
  });
  useFolderStore.setState({ folders: [{ id: "servers", name: "Servers", object_type: "connection", vault_id: "personal" } as Folder] });
  useTeamStore.setState({ teams: [{ id: "t1", name: "Ops", role_ids: [] }] as never });
  useVaultStore.setState({ vaults: [{ id: "personal", name: "Personal" }, { id: "v1", name: "Ops", teamId: "t1" }] });
}

test("groups SSH hosts by vault and folder, and the vault chips narrow the list", () => {
  seed();
  const { container } = render(<SftpHostPickerSheet onPick={() => {}} onClose={() => {}} />);
  expect(screen.getByText("home-box")).toBeTruthy();
  expect(screen.getByText("team-box")).toBeTruthy();
  expect(screen.queryByText("modem")).toBeNull();
  expect(container.querySelector('[data-host-picker-folder="servers"]')?.textContent).toContain("Servers");

  fireEvent.click(container.querySelector('[data-sftp-host-vault="t1"]')!);
  expect(screen.queryByText("home-box")).toBeNull();
  expect(screen.getByText("team-box")).toBeTruthy();
});

test("recents follow the vault chip and leave out serial hosts and the other pane's host", () => {
  seed();
  const used = { last_used_at: "2026-02-01T00:00:00Z" };
  useConnectionStore.setState({
    connections: [
      host("home-box", "personal", used),
      host("other-pane", "personal", used),
      host("modem", "personal", { connection_type: "serial", ...used } as Partial<Connection>),
    ],
    teamConnections: { t1: [host("team-box", "t1", used)] },
  });
  const { container } = render(<SftpHostPickerSheet excludeId="other-pane" onPick={() => {}} onClose={() => {}} />);
  const recent = () => container.querySelector("[data-host-picker-recent]")?.textContent ?? "";
  expect(recent()).toContain("home-box");
  expect(recent()).toContain("team-box");
  expect(recent()).not.toContain("other-pane");
  expect(recent()).not.toContain("modem");

  fireEvent.click(container.querySelector('[data-sftp-host-vault="t1"]')!);
  expect(recent()).toContain("team-box");
  expect(recent()).not.toContain("home-box");
});

test("leaves out the host already open in the other pane", () => {
  seed();
  render(<SftpHostPickerSheet excludeId="team-box" onPick={() => {}} onClose={() => {}} />);
  expect(screen.queryByText("team-box")).toBeNull();
  expect(screen.getByText("home-box")).toBeTruthy();
});

test("my devices sit above the recent hosts and a ready device is reported as a device target", () => {
  seed();
  const used = { last_used_at: "2026-02-01T00:00:00Z" };
  useConnectionStore.setState({ connections: [host("home-box", "personal", used)], teamConnections: {} });
  const desktop = { deviceId: "d1", deviceKey: "k", name: "Work PC", platform: "windows", state: "ready", route: "lan", lastSeen: null };
  devices.rows = [desktop, { ...desktop, deviceId: "d2", name: "Off PC", state: "off" }];
  const onPick = vi.fn();
  const { container } = render(<SftpHostPickerSheet onPick={onPick} onClose={() => {}} />);
  const group = container.querySelector("[data-my-devices]")!;
  const recent = container.querySelector("[data-host-picker-recent]")!;
  expect(group.compareDocumentPosition(recent) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

  fireEvent.click(screen.getByText("Off PC"));
  expect(onPick).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText("Work PC"));
  expect(onPick).toHaveBeenCalledWith({ kind: "device", device: desktop });
});

test("picking a host reports a connection target", () => {
  seed();
  const onPick = vi.fn();
  render(<SftpHostPickerSheet onPick={onPick} onClose={() => {}} />);
  fireEvent.click(screen.getByText("home-box"));
  expect(onPick).toHaveBeenCalledWith({ kind: "connection", id: "home-box" });
});

test("the empty label follows device changes that arrive after the sheet opened", () => {
  useConnectionStore.setState({ connections: [], teamConnections: {} });
  render(<SftpHostPickerSheet onPick={() => {}} onClose={() => {}} />);
  const label = () => screen.queryByText("mobile.sheets.sftpHostPicker.noSshHosts");
  expect(label()).toBeTruthy();

  act(() => { devices.rows = [{ deviceId: "d1", deviceKey: "k", name: "Work PC", platform: "windows", state: "ready", route: "lan", lastSeen: null }]; });
  expect(screen.getByText("Work PC")).toBeTruthy();
  expect(label()).toBeNull();

  act(() => { devices.rows = []; });
  expect(label()).toBeTruthy();
});
