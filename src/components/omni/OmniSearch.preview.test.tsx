// @vitest-environment jsdom
import { test, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent, act } from "@testing-library/react";

const h = vi.hoisted(() => ({ inject: vi.fn(async () => {}) }));

vi.mock("@iconify/react", () => ({ Icon: () => null }));
vi.mock("@/hooks/useAllConnections", () => ({ useAllConnections: () => [] }));
vi.mock("@/hooks/useLocalShells", () => ({ useLocalShells: () => [] }));
vi.mock("@/hooks/useInstallablePlugins", () => ({
  useInstallablePlugins: () => ({ merged: [], taken: new Set(), appVersion: "1.0.0" }),
}));
vi.mock("@/services/launch", () => ({ launchHost: vi.fn(), launchQuickConnect: vi.fn(), launchLocalShell: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => undefined), isTauri: () => false }));
vi.mock("@/services/snippetInject", async (orig) => ({
  ...(await orig<typeof import("@/services/snippetInject")>()),
  broadcastSnippetInject: h.inject,
}));

import { useUIStore } from "@/stores/uiStore";
import { useSessionStore } from "@/stores/sessionStore";
import { useSnippetStore } from "@/stores/snippetStore";
import { usePreviewStore } from "@/stores/previewStore";
import { startPreview, stopPreview } from "@/test/preview";
import type { Snippet } from "@/types";
import OmniSearch from "./OmniSearch";

beforeEach(() => {
  vi.clearAllMocks();
  Element.prototype.scrollIntoView = vi.fn();
  useUIStore.setState({ omniSeed: "zzdeploy" });
  useSessionStore.setState({ sessions: [{ id: "s1", connectionId: "c1", connectionName: "c1", status: "connected", type: "ssh" }], activeSessionId: "s1" });
  useSnippetStore.setState({ snippets: [{ id: "sn1", name: "zzdeploy", steps: [{ kind: "script", content: "ls" }], tags: [] } as unknown as Snippet] });
});
afterEach(() => {
  cleanup();
  stopPreview();
});

async function pickSnippet() {
  render(<OmniSearch onClose={() => {}} />);
  await act(async () => { fireEvent.click(screen.getByText("zzdeploy")); });
}

test("picking a snippet runs it in the active session", async () => {
  await pickSnippet();
  expect(h.inject).toHaveBeenCalled();
});

test("picking a snippet while previewing a member runs nothing and opens why for the snippet", async () => {
  startPreview();
  await pickSnippet();
  expect(h.inject).not.toHaveBeenCalled();
  expect(usePreviewStore.getState().side).toEqual({ kind: "why", type: "snippet", objectId: "sn1" });
});
