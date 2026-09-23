import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { SnippetsPanel } from "./SnippetsPanel";
import { useSnippetStore } from "@/stores/snippetStore";
import { useSnippetFolderStore } from "@/stores/snippetFolderStore";
import type { Folder, Snippet } from "@/types";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => undefined) }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}) }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));
vi.mock("@iconify/react", () => ({ Icon: () => null }));

const folder = (id: string, name: string) =>
  ({ id, name, object_type: "snippet", vault_id: "personal", created_at: "", updated_at: "", clocks: {} }) as Folder;
const snippet = (id: string, name: string, folder_id: string) =>
  ({ id, name, folder_id, steps: [], tags: [], vault_id: "personal" }) as unknown as Snippet;

beforeEach(() => {
  useSnippetStore.setState({
    snippets: [snippet("s1", "deploy", "f-ops"), snippet("s2", "backup", "f-db")],
    loading: false,
    recentSnippetIds: [],
    loadSnippets: async () => {},
  });
  useSnippetFolderStore.setState({ folders: [folder("f-ops", "Ops"), folder("f-db", "Database")], loadFolders: async () => {} });
});
afterEach(cleanup);

test("a search hides folders with no matching snippet", () => {
  render(<SnippetsPanel />);
  fireEvent.change(screen.getByPlaceholderText("terminal.snippets.searchPlaceholder"), { target: { value: "deploy" } });

  expect(screen.queryByText("Ops")).not.toBeNull();
  expect(screen.queryByText("Database")).toBeNull();
});
