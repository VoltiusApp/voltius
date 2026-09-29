import { afterEach, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { Folder } from "@/types";
import { FolderEditPanel } from "./FolderEditPanel";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));
vi.mock("@iconify/react", () => ({ Icon: () => null }));
vi.mock("@/components/permissions/PermissionsSection", () => ({
  PermissionsSection: () => <div data-testid="perms" />,
}));
vi.mock("@/components/shared/VaultPicker", () => ({ VaultPicker: () => null }));
vi.mock("@/hooks/useEffectivePinned", () => ({
  useEffectivePinned: () => false,
  useEffectivePinSource: () => "none",
  nextPersonalPinValue: () => true,
}));

function selectorStore<T extends object>(state: T) {
  return Object.assign(<R,>(sel?: (s: T) => R) => (sel ? sel(state) : state), {
    getState: () => state,
    setState: () => {},
  });
}

vi.mock("@/stores/folderStore", () => ({
  useFolderStore: selectorStore({ pinFolder: vi.fn(async () => {}), pinFolderForTeam: vi.fn(async () => {}) }),
}));
vi.mock("@/stores/snippetFolderStore", () => ({
  useSnippetFolderStore: selectorStore({ pinSnippetFolder: vi.fn(async () => {}), pinSnippetFolderForTeam: vi.fn(async () => {}) }),
}));
vi.mock("@/stores/teamStore", () => ({ useTeamStore: selectorStore({ teams: [] }) }));
vi.mock("@/stores/syncPrefsStore", () => ({
  useSyncPrefsStore: selectorStore({ isObjectSynced: () => true, toggleExcluded: vi.fn() }),
}));

afterEach(cleanup);

const makeFolder = (id: string, name: string): Folder => ({
  id, name, object_type: "connection", vault_id: "personal", created_at: "", updated_at: "", clocks: {},
});
const folder = makeFolder("f1", "Prod");
const other = makeFolder("f2", "Staging");

test("editor shell: title, General card, Permissions, no footer, no Created date", () => {
  render(<FolderEditPanel folder={folder} onUpdate={vi.fn()} onDelete={vi.fn()} onClose={vi.fn()} onOpen={vi.fn()} onSelectSelf={vi.fn()} />);
  expect(screen.getByText("folders.editPanel.title")).toBeTruthy();
  expect(screen.getByText("folders.editPanel.general")).toBeTruthy();
  expect(screen.getByTestId("perms")).toBeTruthy();
  expect(screen.queryByText("folders.editPanel.createdLabel")).toBeNull();
  expect(screen.queryByRole("button", { name: /folders.card.deleteFolder/ })).toBeNull();
});

test("the … menu holds Delete and cloud sync", () => {
  render(<FolderEditPanel folder={folder} onUpdate={vi.fn()} onDelete={vi.fn()} onClose={vi.fn()} onOpen={vi.fn()} onSelectSelf={vi.fn()} canEdit />);
  fireEvent.click(screen.getByTitle("common.action.moreOptions"));
  expect(screen.getByText("folders.card.deleteFolder")).toBeTruthy();
  expect(screen.getByText("folders.card.disableCloudSync")).toBeTruthy();
});

test("changing the parent saves it", () => {
  const onUpdate = vi.fn();
  render(<FolderEditPanel folder={folder} parentOptions={[other]} onUpdate={onUpdate} onDelete={vi.fn()} onClose={vi.fn()} onOpen={vi.fn()} onSelectSelf={vi.fn()} canEdit />);
  fireEvent.click(screen.getByRole("button", { name: /shared.folderSelector.noFolder/ }));
  fireEvent.click(screen.getByText(other.name));
  expect(onUpdate).toHaveBeenCalledWith(folder.id, expect.objectContaining({ parent_folder_id: other.id }));
});
