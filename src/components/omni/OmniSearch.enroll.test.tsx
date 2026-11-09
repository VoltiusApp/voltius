import { test, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";

const h = vi.hoisted(() => ({ resolve: vi.fn() }));

vi.mock("react-i18next", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-i18next")>()),
  useTranslation: () => ({
    t: (k: string, o?: Record<string, unknown>) => (o ? `${k}|${Object.values(o).join("|")}` : k),
  }),
}));
vi.mock("@iconify/react", () => ({ Icon: () => null }));
vi.mock("@/hooks/useAllConnections", () => ({ useAllConnections: () => [] }));
vi.mock("@/hooks/useLocalShells", () => ({ useLocalShells: () => [] }));
vi.mock("@/hooks/useInstallablePlugins", () => ({
  useInstallablePlugins: () => ({ merged: [], taken: new Set(), appVersion: "1.0.0" }),
}));
vi.mock("@/hooks/useToggleSettings", () => ({ useToggleSettings: () => [] }));
vi.mock("@/services/launch", () => ({
  launchHost: vi.fn(),
  launchQuickConnect: vi.fn(),
  launchLocalShell: vi.fn(),
}));

import { useUIStore } from "@/stores/uiStore";
import { useEnrollmentStore } from "@/stores/enrollmentStore";
import { buildEnrollmentToken, parseEnrollmentToken } from "@/services/enrollment/enrollmentToken";
import OmniSearch from "./OmniSearch";

const ID = "a".repeat(32);
const TOKEN = buildEnrollmentToken("https://voltius.acme.com", ID, "s".repeat(43));
const PARTS = parseEnrollmentToken(TOKEN)!;

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
  h.resolve.mockReset();
  const result = { teamId: "t1", teamName: "Acme", allowedDomains: [], requireApproval: true };
  h.resolve.mockImplementation(async () => {
    useEnrollmentStore.setState({ resolved: { [ID]: { at: Date.now(), result } } });
    return result;
  });
  useEnrollmentStore.setState({ resolve: h.resolve, resolved: {} });
  useUIStore.setState({ omniSeed: TOKEN, enrollTarget: null });
});
afterEach(cleanup);

test("pasted token shows enroll row and no quick-connect row", async () => {
  render(<OmniSearch onClose={() => {}} />);
  await screen.findByText(/omni\.enrollToken\.title/);
  expect(screen.getByText("omni.sections.enrollmentToken")).toBeTruthy();
  expect(screen.queryByText("omni.sections.quickConnect")).toBeNull();
  expect(h.resolve).toHaveBeenCalledTimes(1);
  expect(h.resolve).toHaveBeenCalledWith(PARTS);
});

test("enter opens enroll modal", async () => {
  const onClose = vi.fn();
  render(<OmniSearch onClose={onClose} />);
  await screen.findByText(/omni\.enrollToken\.title/);
  fireEvent.keyDown(window, { key: "Enter" });
  expect(useUIStore.getState().enrollTarget).toEqual({ token: PARTS, source: "paste" });
  expect(onClose).toHaveBeenCalled();
});

test("row names the team once resolved and approval in the detail", async () => {
  render(<OmniSearch onClose={() => {}} />);
  expect(await screen.findByText("omni.enrollToken.title|Acme")).toBeTruthy();
  expect(screen.getByText(/omni\.enrollToken\.detailApproval\|voltius\.acme\.com/)).toBeTruthy();
});

test("an unresolved token still offers the generic row", async () => {
  h.resolve.mockRejectedValue(new Error("unreachable"));
  render(<OmniSearch onClose={() => {}} />);
  expect(await screen.findByText("omni.enrollToken.titleUnknown")).toBeTruthy();
});

test("text that is not a token never resolves", async () => {
  useUIStore.setState({ omniSeed: "vte1.nope" });
  render(<OmniSearch onClose={() => {}} />);
  expect(screen.queryByText("omni.sections.enrollmentToken")).toBeNull();
  expect(h.resolve).not.toHaveBeenCalled();
});
