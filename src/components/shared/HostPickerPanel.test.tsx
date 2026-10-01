import { test, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import type { Connection, Folder } from "@/types";

const h = vi.hoisted(() => ({ personal: [] as Connection[], folders: [] as Folder[] }));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));
vi.mock("@iconify/react", () => ({ Icon: () => null }));
vi.mock("@/services/sftp", () => ({ wslListDistros: async () => [] }));
vi.mock("@/services/connections", () => ({ listConnections: async () => h.personal }));
vi.mock("@/services/folders", () => ({ listFolders: async () => h.folders }));
vi.mock("@/utils/platform", () => ({ useIsAndroid: () => false }));
vi.mock("./ConnectionAvatar", () => ({ ConnectionAvatar: () => null }));

import { HostPickerPanel } from "./HostPickerPanel";
import { useConnectionStore } from "@/stores/connectionStore";
import { useTeamStore } from "@/stores/teamStore";
import { useVaultStore } from "@/stores/vaultStore";

const initialTeam = useTeamStore.getState();
const initialVault = useVaultStore.getState();
const initialConn = useConnectionStore.getState();

afterEach(() => {
  cleanup();
  useTeamStore.setState(initialTeam, true);
  useVaultStore.setState(initialVault, true);
  useConnectionStore.setState(initialConn, true);
});

function host(id: string, vault: string, folder?: string): Connection {
  return { id, name: id, host: `${id}.lan`, port: 22, username: "u", vault_id: vault, folder_id: folder, created_at: "" } as Connection;
}

function seed() {
  h.personal = [host("home-box", "personal", "servers")];
  h.folders = [{ id: "servers", name: "Servers", object_type: "connection", vault_id: "personal" } as Folder];
  useTeamStore.setState({ teams: [{ id: "t1", name: "Ops", role_ids: [] }] as never });
  useVaultStore.setState({ vaults: [{ id: "personal", name: "Personal" }, { id: "v1", name: "Ops", teamId: "t1" }] });
  useConnectionStore.setState({ teamConnections: { t1: [host("team-box", "t1")] } });
}

test("lists team-vault hosts under their vault, beside personal hosts in their folders", async () => {
  seed();
  const { container } = render(<HostPickerPanel onPick={() => {}} />);
  await waitFor(() => expect(screen.getByText("home-box")).toBeTruthy());
  expect(screen.getByText("team-box")).toBeTruthy();
  expect([...container.querySelectorAll("[data-host-picker-vault]")].map((e) => e.textContent)).toEqual(["Personal", "Ops"]);
  expect(container.querySelector('[data-host-picker-folder="servers"]')?.textContent).toContain("Servers");
});

test("collapsing a folder hides its hosts", async () => {
  seed();
  const { container } = render(<HostPickerPanel onPick={() => {}} />);
  await waitFor(() => expect(screen.getByText("home-box")).toBeTruthy());
  fireEvent.click(container.querySelector('[data-host-picker-folder="servers"]')!);
  expect(screen.queryByText("home-box")).toBeNull();
  expect(screen.getByText("team-box")).toBeTruthy();
});

test("the vault filter narrows the list to one vault", async () => {
  seed();
  render(<HostPickerPanel onPick={() => {}} />);
  await waitFor(() => expect(screen.getByText("home-box")).toBeTruthy());
  fireEvent.click(screen.getByText("shared.hostPicker.allVaults"));
  fireEvent.click(screen.getAllByText("Ops").find((e) => e.closest("button"))!);
  expect(screen.queryByText("home-box")).toBeNull();
  expect(screen.getByText("team-box")).toBeTruthy();
});

test("a caller-locked vault hides the filter", async () => {
  seed();
  render(<HostPickerPanel onPick={() => {}} vaultId="t1" />);
  await waitFor(() => expect(screen.getByText("team-box")).toBeTruthy());
  expect(screen.queryByText("home-box")).toBeNull();
  expect(screen.queryByText("shared.hostPicker.allVaults")).toBeNull();
});
