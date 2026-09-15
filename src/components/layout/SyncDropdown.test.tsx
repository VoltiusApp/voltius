import { describe, test, expect, vi, afterEach } from "vitest";
import { render, cleanup, fireEvent } from "@testing-library/react";
import { createRef } from "react";
import type { SyncProviderView } from "@/services/syncProviders";
import { NOT_CONFIGURED_SYNC_STATE } from "@/services/syncStatus";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));
vi.mock("@iconify/react", () => ({ Icon: () => null }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => undefined) }));
vi.mock("@/hooks/useVaultContents", () => ({ useVaultContents: () => ({}) }));
vi.mock("@/components/shared/ContentCounts", () => ({ ContentCounts: () => null }));
const runAction = vi.hoisted(() => vi.fn());
vi.mock("@/services/syncProviderAction", () => ({ runSyncProviderAction: runAction }));

import { SyncDropdown } from "./SyncDropdown";

const view = (over: Partial<SyncProviderView>): SyncProviderView => ({
  id: "x", label: "X", icon: "lucide:cloud", availability: "active",
  state: { ...NOT_CONFIGURED_SYNC_STATE, status: "success", configured: true },
  syncNow: vi.fn(async () => {}), action: null, ...over,
});

afterEach(() => { cleanup(); runAction.mockReset(); });

describe("SyncDropdown", () => {
  test("renders one section per provider", () => {
    const { container } = render(
      <SyncDropdown anchorRef={createRef()} open onClose={() => {}} providers={[
        view({ id: "voltius", availability: "locked", syncNow: null, action: { kind: "signIn" } }),
        view({ id: "plugin-gist-sync" }),
        view({ id: "plugin-cloudflare-sync", availability: "not_configured", syncNow: null, action: { kind: "configure", pageId: "plugin-cloudflare-sync:settings" } }),
      ]} />,
    );
    expect([...container.querySelectorAll("[data-sync-provider]")].map((e) => e.getAttribute("data-sync-provider")))
      .toEqual(["voltius", "plugin-gist-sync", "plugin-cloudflare-sync"]);
  });

  test("an inactive provider's action closes the menu and runs the action", () => {
    const onClose = vi.fn();
    const { getByText } = render(
      <SyncDropdown anchorRef={createRef()} open onClose={onClose} providers={[
        view({ id: "plugin-cloudflare-sync", availability: "disabled", syncNow: null, action: { kind: "enable" } }),
      ]} />,
    );
    fireEvent.click(getByText("layout.sync.enableArrow"));
    expect(onClose).toHaveBeenCalled();
    expect(runAction).toHaveBeenCalledWith({ kind: "enable" });
  });

  test("Sync now calls the provider's syncNow", () => {
    const syncNow = vi.fn(async () => {});
    const { getByText } = render(
      <SyncDropdown anchorRef={createRef()} open onClose={() => {}} providers={[view({ id: "plugin-gist-sync", syncNow })]} />,
    );
    fireEvent.click(getByText("layout.sync.syncNow"));
    expect(syncNow).toHaveBeenCalled();
  });
});
