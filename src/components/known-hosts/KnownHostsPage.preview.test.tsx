import { test, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import type { KnownHost } from "@/types";

const h = vi.hoisted(() => ({
  cardProps: [] as Record<string, unknown>[],
  move: vi.fn(async () => {}),
  copy: vi.fn(async () => {}),
  remove: vi.fn(async () => {}),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));
vi.mock("@/i18n", () => ({ default: { t: (k: string) => k } }));
vi.mock("./KnownHostCard", () => ({
  KnownHostCard: (props: Record<string, unknown>) => { h.cardProps.push(props); return null; },
}));
vi.mock("./KnownHostsToolbar", () => ({ KnownHostsToolbar: () => null }));
vi.mock("@/hooks/usePermission", () => ({ usePermissions: () => () => true }));
vi.mock("@/hooks/useAccessibleVaultIds", () => ({ useAccessibleVaultIds: () => [] }));
vi.mock("@/hooks/useVaultOptions", () => ({ useVaultOptions: () => [{ id: "v2", name: "Other" }] }));

import KnownHostsPage from "./KnownHostsPage";
import { useKnownHostStore } from "@/stores/knownHostStore";
import { useVaultStore } from "@/stores/vaultStore";
import { callProp, expectEachRefused, startPreview, stopPreview } from "@/test/preview";

const host = { id: "kh1", host: "web", port: 22, fingerprint: "SHA256:abc", vault_id: "personal", created_at: "" } as KnownHost;

beforeEach(() => {
  h.cardProps.length = 0;
  vi.clearAllMocks();
  useVaultStore.setState({ selectedVaultIds: ["personal"] });
  useKnownHostStore.setState({
    knownHosts: [host], loadKnownHosts: async () => {},
    removeKnownHost: h.remove, moveKnownHostVault: h.move, copyKnownHostVault: h.copy,
  });
  startPreview();
});
afterEach(() => { cleanup(); stopPreview(); });

test("delete_move_and_copy_are_refused_while_previewing", async () => {
  render(<KnownHostsPage />);
  const props = h.cardProps[h.cardProps.length - 1];

  await expectEachRefused([
    ["delete", callProp(props, "onDelete"), undefined],
    ["move", callProp(props, "onMoveVault", "v2"), undefined],
    ["copy", callProp(props, "onCopyVault", "v2"), undefined],
  ]);

  expect(screen.queryByText("knownHosts.page.confirmDelete.title")).toBeNull();
  expect(h.move).not.toHaveBeenCalled();
  expect(h.copy).not.toHaveBeenCalled();
});
