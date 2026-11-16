import { test, expect, vi, afterEach } from "vitest";
import { act, cleanup, fireEvent, render } from "@testing-library/react";

vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (k: string) => k }) }));
vi.mock("@iconify/react", () => ({ Icon: () => null }));
vi.mock("@/i18n", () => ({ default: { t: (k: string) => k } }));
vi.mock("./StepPreview", () => ({ StepPreview: () => null }));
const h = vi.hoisted(() => ({ install: vi.fn(async () => ({ imported: 1, errors: 0 })), toast: vi.fn() }));
vi.mock("./useCommunityInstall", () => ({
  useCommunityInstall: () => ({ install: h.install, installing: false, vault: { id: "personal", name: "Personal" } }),
}));
vi.mock("@/services/appToast", () => ({ appToast: h.toast }));

import { EntryDetail } from "./EntryDetail";
import { startPreview, stopPreview } from "@/test/preview";
import type { CatalogEntry } from "@/services/snippetCatalog";

const entry = { id: "e", kind: "snippet", name: "ls", tags: [], snippets: [{ _eid: "s1", name: "ls", steps: [] }] } as unknown as CatalogEntry;

afterEach(() => {
  cleanup();
  stopPreview();
  vi.clearAllMocks();
});

const clickInstall = async (onInstalled: () => void) => {
  const view = render(<EntryDetail entry={entry} onBack={() => {}} onInstalled={onInstalled} />);
  await act(async () => { fireEvent.click(view.getByText("snippets.community.install")); });
};

test("community_install_refuses_while_previewing", async () => {
  const onInstalled = vi.fn();
  startPreview();
  await clickInstall(onInstalled);
  await vi.waitFor(() => expect(h.toast).toHaveBeenCalledWith("info", "members.viewAs.readOnly"));
  expect(h.install).not.toHaveBeenCalled();
  expect(onInstalled).not.toHaveBeenCalled();
});

test("community_install_runs_outside_a_preview", async () => {
  const onInstalled = vi.fn();
  await clickInstall(onInstalled);
  expect(h.install).toHaveBeenCalledWith([{ entry, snippetEids: ["s1"] }]);
  expect(onInstalled).toHaveBeenCalledWith(1);
});
