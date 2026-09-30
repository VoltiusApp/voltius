import { test, expect, vi, afterEach } from "vitest";
import { render, cleanup, fireEvent } from "@testing-library/react";
import type { Connection } from "@/types";

const h = vi.hoisted(() => ({
  updateConnection: vi.fn(async () => {}),
  moveConnectionToVault: vi.fn(async () => {}),
  canEdit: true,
  conn: {
    id: "c1", name: "web", host: "10.0.0.1", port: 22, username: "root", tags: [],
    vault_id: "personal", folder_id: null,
  } as unknown as Connection,
}));

vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (k: string) => k }) }));
vi.mock("@iconify/react", () => ({ Icon: () => null }));
vi.mock("@/stores/connectionStore", () => ({
  useConnectionStore: Object.assign(
    (sel: (s: Record<string, unknown>) => unknown) => sel({
      saveConnection: vi.fn(), updateConnection: h.updateConnection, deleteConnection: vi.fn(), pinConnection: vi.fn(),
    }),
    { getState: () => ({ loadConnections: vi.fn() }) },
  ),
  connectionToFormData: (c: Connection) => ({ ...c }),
}));
vi.mock("@/hooks/useAllConnections", () => ({ useAllConnections: () => [h.conn] }));
vi.mock("@/hooks/useAllFolders", () => ({ useAllFolders: () => [] }));
vi.mock("@/stores/folderStore", () => ({
  useFolderStore: (sel: (s: Record<string, unknown>) => unknown) => sel({ moveObjectsToFolder: vi.fn() }),
}));
vi.mock("@/stores/sessionStore", () => ({
  useSessionStore: (sel: (s: Record<string, unknown>) => unknown) => sel({ connect: vi.fn() }),
}));
vi.mock("@/hooks/useVaultOptions", () => ({ useOtherVaultOptions: () => [{ id: "team-1", name: "Team One" }] }));
vi.mock("@/hooks/usePermission", () => ({ usePermissions: () => () => h.canEdit }));
vi.mock("@/hooks/useCanConnect", () => ({ useCanConnect: () => true }));
vi.mock("@/stores/teamVaultMap", () => ({ isTeamVaultId: (id: string) => id === "team-1" }));
vi.mock("@/stores/syncPrefsStore", () => ({
  useSyncPrefsStore: (sel: (s: Record<string, unknown>) => unknown) => sel({ isObjectSynced: () => true }),
}));
vi.mock("@/hooks/useEffectivePinned", () => ({ useEffectivePinned: () => false }));
vi.mock("@/stores/notificationStore", () => ({ useNotificationStore: { getState: () => ({ addToast: vi.fn() }) } }));
vi.mock("@/utils/connectionDisplayName", () => ({ connectionDisplayName: (c: Connection) => c.name ?? c.host }));
vi.mock("@/utils/clipboard", () => ({ writeClipboard: vi.fn() }));
vi.mock("@/utils/localeFormat", () => ({ compareStrings: (a: string, b: string) => a.localeCompare(b) }));
vi.mock("@/components/mobile/folders/mobileFolderCore", () => ({ buildMoveTargets: () => [] }));
vi.mock("@/services/connectionDuplicate", () => ({ moveConnectionToVault: h.moveConnectionToVault }));
vi.mock("./MoveToFolderSheet", () => ({ default: () => null }));

import HostActionsSheet from "./HostActionsSheet";

afterEach(() => {
  cleanup();
  h.canEdit = true;
  h.conn.vault_id = "personal";
});

test("moving a host to a vault goes through moveConnectionToVault, not a bare updateConnection", () => {
  render(<HostActionsSheet hostId="c1" />);
  fireEvent.click(document.querySelector("[data-host-action='move-to-vault']")!);
  fireEvent.click(document.querySelector("[data-host-action='team-one']")!);
  expect(h.moveConnectionToVault).toHaveBeenCalledWith(h.conn, "team-1", h.updateConnection);
});

test("a member without edit rights gets no editing actions", () => {
  h.canEdit = false;
  render(<HostActionsSheet hostId="c1" />);
  for (const slug of ["edit", "duplicate", "move-to-folder", "move-to-vault", "delete", "disable-reachability-check"]) {
    expect(document.querySelector(`[data-host-action='${slug}']`)).toBeNull();
  }
  expect(document.querySelector("[data-host-action='connect']")).not.toBeNull();
});

test("a team host offers no per-device cloud sync toggle", () => {
  h.conn.vault_id = "team-1";
  render(<HostActionsSheet hostId="c1" />);
  expect(document.querySelector("[data-host-action='disable-cloud-sync']")).toBeNull();
});
