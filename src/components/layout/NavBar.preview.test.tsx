import { test, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { PreviewContentScope } from "@/hooks/previewScope";
import { startPreview, stopPreview } from "@/test/preview";

const h = vi.hoisted(() => ({
  granted: new Set<string>(),
  context: { kind: "team", teamId: "t1" } as { kind: "team"; teamId: string } | { kind: "local"; vaultId: string } | null,
  setActiveNav: vi.fn(),
  asked: [] as [string, string][],
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));
vi.mock("@iconify/react", () => ({ Icon: ({ icon }: { icon: string }) => <i data-icon={icon} /> }));
vi.mock("@/hooks/useRipple", () => ({ useRipple: () => ({ createRipple: () => {}, rippleEls: null }) }));
vi.mock("@/hooks/useAuditContext", () => ({ useSelectedAuditContext: () => h.context }));
vi.mock("@/hooks/usePermission", () => ({
  usePermissions: () => (permission: string, vaultId: string) => {
    h.asked.push([permission, vaultId]);
    return h.granted.has(permission);
  },
}));
vi.mock("@/stores/uiStore", () => {
  const state = { activeNav: "hosts", setActiveNav: (...a: unknown[]) => h.setActiveNav(...a), setSftpPanelOpen: vi.fn() };
  return { useUIStore: Object.assign((sel: (s: typeof state) => unknown) => sel(state), { getState: () => state }) };
});

import NavBar from "./NavBar";

const logs = () => screen.getByText("layout.nav.logs").closest("button")!;

beforeEach(() => {
  h.granted = new Set();
  h.context = { kind: "team", teamId: "t1" };
  h.setActiveNav.mockReset();
  h.asked.length = 0;
});
afterEach(() => { cleanup(); stopPreview(); });

const renderBar = () => render(<PreviewContentScope><NavBar /></PreviewContentScope>);

test("navbar_locks_logs_without_view_audit_log", () => {
  startPreview();
  renderBar();

  expect(logs().title).toBe("members.viewAs.locked.auditLog");
  expect(logs().querySelector('[data-icon="lucide:lock"]')).not.toBeNull();
  expect(h.asked).toContainEqual(["VIEW_AUDIT_LOG", "t1"]);
  fireEvent.click(logs());
  expect(h.setActiveNav).toHaveBeenCalledWith("logs");
});

test("navbar keeps logs plain when the subject holds view_audit_log, outside a preview, or on a local vault", () => {
  h.granted = new Set(["VIEW_AUDIT_LOG"]);
  startPreview();
  const view = renderBar();
  expect(logs().title).toBe("");
  expect(logs().querySelector('[data-icon="lucide:lock"]')).toBeNull();
  view.unmount();

  h.granted = new Set();
  stopPreview();
  const outside = renderBar();
  expect(logs().title).toBe("");
  expect(logs().querySelector('[data-icon="lucide:lock"]')).toBeNull();
  outside.unmount();

  startPreview();
  h.context = { kind: "local", vaultId: "v1" };
  renderBar();
  expect(logs().title).toBe("");
});
