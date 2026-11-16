import { test, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup, fireEvent } from "@testing-library/react";
import { PreviewContentScope } from "@/hooks/previewScope";
import { useMobileNavStore } from "@/stores/mobileNavStore";
import { useNotificationStore } from "@/stores/notificationStore";
import { startPreview, stopPreview } from "@/test/preview";

const h = vi.hoisted(() => ({
  granted: new Set<string>(),
  context: { kind: "team", teamId: "team-1" } as { kind: "team"; teamId: string } | null,
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));
vi.mock("@iconify/react", () => ({ Icon: ({ icon }: { icon: string }) => <i data-icon={icon} /> }));
vi.mock("@/hooks/useAuditContext", () => ({ useSelectedAuditContext: () => h.context }));
vi.mock("@/hooks/usePermission", () => ({
  usePermissions: () => (permission: string) => h.granted.has(permission),
}));

import MobileViewAsAreas from "./MobileViewAsAreas";

const chip = (area: string) => document.querySelector<HTMLElement>(`[data-view-as-area="${area}"]`)!;
const renderAreas = () => render(<PreviewContentScope><MobileViewAsAreas /></PreviewContentScope>);

beforeEach(() => {
  h.granted = new Set(["VIEW_AUDIT_LOG", "VIEW_TERMINAL_SESSIONS"]);
  useMobileNavStore.setState({ tab: "hosts", stack: [], sheet: null });
  useNotificationStore.setState({ toasts: [] });
  startPreview();
});
afterEach(() => {
  cleanup();
  stopPreview();
});

test("chips_navigate_tabs_and_more_pages", () => {
  renderAreas();
  fireEvent.click(chip("snippets"));
  expect(useMobileNavStore.getState().tab).toBe("snippets");
  fireEvent.click(chip("hosts"));
  expect(useMobileNavStore.getState().tab).toBe("hosts");
  fireEvent.click(chip("sessions"));
  expect(useMobileNavStore.getState().tab).toBe("more");
  expect(useMobileNavStore.getState().stack).toEqual([{ kind: "more-page", page: "sessions" }]);
});

test("active_chip_follows_nav", () => {
  renderAreas();
  expect(chip("hosts").getAttribute("aria-current")).toBe("true");
  expect(chip("keychain").getAttribute("aria-current")).toBeNull();
  fireEvent.click(chip("snippets"));
  expect(chip("snippets").getAttribute("aria-current")).toBe("true");
  fireEvent.click(chip("port-forwarding"));
  expect(chip("port-forwarding").getAttribute("aria-current")).toBe("true");
  expect(chip("snippets").getAttribute("aria-current")).toBeNull();
});

test("locked_logs_chip_is_greyed_and_explains", () => {
  h.granted.delete("VIEW_AUDIT_LOG");
  renderAreas();
  const logs = chip("logs");
  expect(logs.getAttribute("aria-disabled")).toBe("true");
  expect(logs.querySelector("[data-icon='lucide:lock']")).not.toBeNull();
  fireEvent.click(logs);
  expect(useMobileNavStore.getState().stack).toEqual([]);
  expect(useNotificationStore.getState().toasts.map((x) => x.message)).toContain("members.viewAs.locked.auditLog");
});
