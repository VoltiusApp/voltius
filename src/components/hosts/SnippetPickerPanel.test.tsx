import { test, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup, fireEvent, act } from "@testing-library/react";
import type { Connection, Snippet } from "@/types";

const h = vi.hoisted(() => ({
  inject: vi.fn(async () => {}),
  snippet: null as unknown,
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));
vi.mock("@iconify/react", () => ({ Icon: () => null }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => []) }));
vi.mock("@/services/snippetInject", () => ({ snippetInject: h.inject }));
vi.mock("@/hooks/useAllConnections", () => ({
  useAllConnections: () => [{ id: "c1", host: "c1.example", username: "root", connection_type: "ssh" } as Connection],
}));
vi.mock("@/components/snippets/SnippetChooserList", () => ({
  SnippetChooserList: ({ renderActions }: { renderActions: (s: Snippet) => React.ReactNode }) => <div>{renderActions(h.snippet as Snippet)}</div>,
}));

import { SnippetPickerPanel } from "./SnippetPickerPanel";
import { useSessionStore } from "@/stores/sessionStore";
import { usePreviewStore } from "@/stores/previewStore";
import { startPreview, stopPreview } from "@/test/preview";

beforeEach(() => {
  vi.clearAllMocks();
  h.snippet = { id: "sn1", name: "ls", steps: [{ kind: "script", content: "ls" }], tags: [] };
  useSessionStore.setState({ sessions: [{ id: "s1", connectionId: "c1", connectionName: "c1", status: "connected", type: "ssh" }], activeSessionId: "s1" });
});
afterEach(() => {
  cleanup();
  stopPreview();
});

async function execute() {
  const { getByTitle } = render(<SnippetPickerPanel connectionIds={["c1"]} onClose={vi.fn()} />);
  await act(async () => { fireEvent.click(getByTitle("hosts.snippetPicker.execute")); });
}

test("executing a snippet on a host injects it into the host's open session", async () => {
  await execute();
  expect(h.inject).toHaveBeenCalledWith("s1", "ssh", "ls", true);
});

test("executing a snippet while previewing a member injects nothing and opens why for the snippet", async () => {
  startPreview();
  await execute();
  expect(h.inject).not.toHaveBeenCalled();
  expect(usePreviewStore.getState().side).toEqual({ kind: "why", type: "snippet", objectId: "sn1" });
});
