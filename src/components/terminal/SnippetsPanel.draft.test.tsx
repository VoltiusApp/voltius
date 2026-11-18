import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { SnippetsPanel } from "./SnippetsPanel";
import { useSnippetStore } from "@/stores/snippetStore";
import { useSnippetFolderStore } from "@/stores/snippetFolderStore";
import type { Snippet } from "@/types";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => undefined) }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}) }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
  Trans: ({ i18nKey }: { i18nKey: string }) => i18nKey,
  initReactI18next: { type: "3rdParty", init: () => {} },
}));
vi.mock("@iconify/react", () => ({ Icon: () => null }));

const createSnippet = vi.fn(async () => ({ id: "new1" }) as Snippet);

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  createSnippet.mockClear();
  useSnippetStore.setState({
    snippets: [],
    loading: false,
    recentSnippetIds: [],
    loadSnippets: async () => {},
    createSnippet,
    snippetDraft: { name: "df -h", steps: [{ kind: "script", content: "df -h" }] },
  });
  useSnippetFolderStore.setState({ folders: [], loadFolders: async () => {} });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

test("a draft opens the new-snippet editor filled in, and closing it untouched saves nothing", async () => {
  render(<SnippetsPanel />);
  expect((screen.getByDisplayValue("df -h") as HTMLInputElement).value).toBe("df -h");
  expect(useSnippetStore.getState().snippetDraft).toBeNull();

  await act(async () => { vi.advanceTimersByTime(2000); });
  expect(createSnippet).not.toHaveBeenCalled();
});

test("Save creates the drafted snippet", async () => {
  render(<SnippetsPanel />);
  await act(async () => { fireEvent.click(screen.getByText("common.action.save")); });
  expect(createSnippet).toHaveBeenCalledWith(expect.objectContaining({ name: "df -h", steps: [{ kind: "script", content: "df -h" }] }));
  expect(screen.queryByText("common.action.save")).toBeNull();
});
