import { test, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import type { Connection, Folder } from "@/types";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));
vi.mock("@iconify/react", () => ({ Icon: () => null }));
vi.mock("@/components/shared/ConnectionAvatar", () => ({ ConnectionAvatar: () => null }));
vi.mock("./BottomSheet", () => ({ default: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));

import SftpHostPickerSheet from "./SftpHostPickerSheet";
import { useConnectionStore } from "@/stores/connectionStore";
import { useFolderStore } from "@/stores/folderStore";
import { useTeamStore } from "@/stores/teamStore";
import { useVaultStore } from "@/stores/vaultStore";

const initial = [useConnectionStore, useFolderStore, useTeamStore, useVaultStore].map((s) => [s, s.getState()] as const);

afterEach(() => {
  cleanup();
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
  expect(container.querySelector('[data-sftp-host-folder="servers"]')?.textContent).toContain("Servers");

  fireEvent.click(container.querySelector('[data-sftp-host-vault="t1"]')!);
  expect(screen.queryByText("home-box")).toBeNull();
  expect(screen.getByText("team-box")).toBeTruthy();
});

test("leaves out the host already open in the other pane", () => {
  seed();
  render(<SftpHostPickerSheet excludeId="team-box" onPick={() => {}} onClose={() => {}} />);
  expect(screen.queryByText("team-box")).toBeNull();
  expect(screen.getByText("home-box")).toBeTruthy();
});
