import { afterEach, expect, test, vi } from "vitest";
import { useEffect, useRef, useState } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { Folder } from "@/types";
import { FolderEditPanel } from "./FolderEditPanel";
import { FolderCard } from "./FolderCard";
import { RuleSetMoveCancelled } from "@/services/teamObjectPersistence";

const pins = vi.hoisted(() => ({ folder: vi.fn(async () => {}), snippetFolder: vi.fn(async () => {}) }));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));
vi.mock("@iconify/react", () => ({ Icon: () => null }));
vi.mock("@/components/permissions/PermissionsSection", () => ({
  PermissionsSection: () => <div data-testid="perms" />,
}));
vi.mock("@/components/shared/VaultPicker", () => ({
  VaultPicker: ({ onChange }: { onChange: (id: string) => void }) => <button onClick={() => onChange("team-1")}>pick-team</button>,
}));
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
  useFolderStore: selectorStore({ pinFolder: pins.folder, pinFolderForTeam: vi.fn(async () => {}) }),
}));
vi.mock("@/stores/snippetFolderStore", () => ({
  useSnippetFolderStore: selectorStore({ pinSnippetFolder: pins.snippetFolder, pinSnippetFolderForTeam: vi.fn(async () => {}) }),
}));
vi.mock("@/stores/teamStore", () => ({ useTeamStore: selectorStore({ teams: [] }) }));
vi.mock("@/stores/syncPrefsStore", () => ({
  useSyncPrefsStore: selectorStore({ isObjectSynced: () => true, toggleExcluded: vi.fn() }),
}));

afterEach(() => { cleanup(); vi.clearAllMocks(); });

const makeFolder = (id: string, name: string, over: Partial<Folder> = {}): Folder => ({
  id, name, object_type: "connection", vault_id: "personal", created_at: "", updated_at: "", clocks: {}, ...over,
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

test("a cancelled parent change puts the old parent back", async () => {
  const onUpdate = vi.fn(async () => { throw new RuleSetMoveCancelled(); });
  render(<FolderEditPanel folder={folder} parentOptions={[other]} onUpdate={onUpdate} onDelete={vi.fn()} onClose={vi.fn()} onOpen={vi.fn()} onSelectSelf={vi.fn()} canEdit />);
  fireEvent.click(screen.getByRole("button", { name: /shared.folderSelector.noFolder/ }));
  fireEvent.click(screen.getByText(other.name));
  expect(screen.getByRole("button", { name: new RegExp(other.name) })).toBeTruthy();
  await waitFor(() => expect(screen.getByRole("button", { name: /shared.folderSelector.noFolder/ })).toBeTruthy());
});

test("the parent list only offers folders in the panel's vault, and follows a vault change", () => {
  const foreign = makeFolder("f3", "Team folder", { vault_id: "team-1" });
  render(<FolderEditPanel folder={folder} parentOptions={[other, foreign]} onUpdate={vi.fn()} onDelete={vi.fn()} onClose={vi.fn()} onOpen={vi.fn()} onSelectSelf={vi.fn()} canEdit />);
  fireEvent.click(screen.getByRole("button", { name: /shared.folderSelector.noFolder/ }));
  expect(screen.queryByText(other.name)).toBeTruthy();
  expect(screen.queryByText(foreign.name)).toBeNull();
  fireEvent.click(screen.getByText("pick-team"));
  expect(screen.queryByText(foreign.name)).toBeTruthy();
  expect(screen.queryByText(other.name)).toBeNull();
});

test("Cut selects the folder before the clipboard event reads the selection", () => {
  const seen: string[][] = [];
  function Page() {
    const [selection, setSelection] = useState<string[]>([]);
    const selectionRef = useRef(selection);
    selectionRef.current = selection;
    useEffect(() => {
      const onCut = () => seen.push(selectionRef.current);
      window.addEventListener("voltius:clipboard-cut", onCut);
      return () => window.removeEventListener("voltius:clipboard-cut", onCut);
    }, []);
    return <FolderEditPanel folder={folder} onUpdate={vi.fn()} onDelete={vi.fn()} onClose={vi.fn()} onOpen={vi.fn()} onSelectSelf={() => setSelection([folder.id])} canEdit />;
  }
  render(<Page />);
  fireEvent.click(screen.getByTitle("common.action.moreOptions"));
  fireEvent.click(screen.getByText("common.action.cut"));
  expect(seen).toEqual([[folder.id]]);
});

test("pinning a snippet folder goes through the snippet folder store", () => {
  const snippetFolder = makeFolder("s1", "Snips", { object_type: "snippet" });
  render(<FolderEditPanel folder={snippetFolder} onUpdate={vi.fn()} onDelete={vi.fn()} onClose={vi.fn()} onOpen={vi.fn()} onSelectSelf={vi.fn()} syncObjectType="snippet" />);
  fireEvent.click(screen.getByTitle("common.action.pin"));
  expect(pins.snippetFolder).toHaveBeenCalledWith("s1", true);
  expect(pins.folder).not.toHaveBeenCalled();
});

test("the panel's … menu is the card's right-click menu minus Rename/Edit", () => {
  const shared = {
    folder, canEdit: true, onDelete: vi.fn(), onExport: vi.fn(), onShare: vi.fn(),
    vaults: [{ id: "v2", name: "Other vault" }], onMoveToVault: vi.fn(), onCopyToVault: vi.fn(),
  };
  const menuLabels = () => Array.from(document.querySelectorAll(".surface-float span.flex-1")).map((el) => el.textContent);

  const { container } = render(<FolderCard {...shared} itemCount={0} layout="list" onClick={vi.fn()} onRename={vi.fn()} onEdit={vi.fn()} />);
  fireEvent.contextMenu(container.querySelector("[data-folder-card]")!);
  const card = menuLabels();
  cleanup();

  render(<FolderEditPanel {...shared} onUpdate={vi.fn()} onClose={vi.fn()} onOpen={vi.fn()} onSelectSelf={vi.fn()} />);
  fireEvent.click(screen.getByTitle("common.action.moreOptions"));
  const panel = menuLabels();

  expect(card).toContain("snippets.community.shareTitle");
  expect(card).toContain("common.action.moveTo");
  expect(panel).toEqual(card.filter((l) => l !== "common.action.rename" && l !== "common.action.edit"));
});
