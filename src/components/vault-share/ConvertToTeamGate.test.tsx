import { test, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import membersEn from "@/i18n/locales/en/members.json";

const h = vi.hoisted(() => ({ convert: vi.fn(), t: vi.fn((k: string) => k) }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: h.t }) }));
vi.mock("@iconify/react", () => ({ Icon: () => null }));
vi.mock("@/services/vaultConvert", () => ({ convertVaultToTeam: h.convert }));

import { ConvertToTeamGate } from "./ConvertToTeamGate";

// Looks up the real English copy so the interpolating t below reproduces what
// i18next actually does: substitute {{vars}} into the resource string, or
// leave them literal if the call site forgot to pass them.
function lookup(key: string): string {
  const value = key
    .split(".")
    .reduce<unknown>((node, part) => (node as Record<string, unknown> | undefined)?.[part], membersEn);
  return typeof value === "string" ? value : key;
}

function interpolatingT(k: string, vars?: Record<string, unknown>): string {
  const template = lookup(k);
  return vars
    ? Object.entries(vars).reduce((s, [key, v]) => s.replace(new RegExp(`{{${key}}}`, "g"), String(v)), template)
    : template;
}

afterEach(() => {
  cleanup();
  h.t.mockImplementation((k: string) => k);
});

test("cancel converts nothing", () => {
  const onCancel = vi.fn();
  render(<ConvertToTeamGate vaultName="Personal" vaultId="v1" onCancel={onCancel} onConverted={vi.fn()} />);
  fireEvent.click(screen.getByText("members.convert.cancel"));
  expect(h.convert).not.toHaveBeenCalled();
  expect(onCancel).toHaveBeenCalled();
});

test("escape converts nothing (Modal's own dismiss, not bypassed)", () => {
  const onCancel = vi.fn();
  render(<ConvertToTeamGate vaultName="Personal" vaultId="v1" onCancel={onCancel} onConverted={vi.fn()} />);
  fireEvent.keyDown(document, { key: "Escape" });
  expect(h.convert).not.toHaveBeenCalled();
  expect(onCancel).toHaveBeenCalled();
});

test("renders as a dialog, not inline content", () => {
  render(<ConvertToTeamGate vaultName="Personal" vaultId="v1" onCancel={vi.fn()} onConverted={vi.fn()} />);
  expect(screen.getByRole("dialog")).toBeTruthy();
});

test("all three costs are stated before converting; no gain column left over", () => {
  render(<ConvertToTeamGate vaultName="Personal" vaultId="v1" onCancel={vi.fn()} onConverted={vi.fn()} />);
  expect(screen.getByText("members.convert.offlineWarning")).toBeTruthy();
  expect(screen.getByText("members.convert.keyCustody")).toBeTruthy();
  expect(screen.getByText("members.convert.change")).toBeTruthy();
  expect(screen.queryByText("members.convert.gain")).toBeNull();
  expect(screen.queryByText("members.convert.gainLabel")).toBeNull();
});

test("continue converts exactly once even on a double click", async () => {
  h.convert.mockResolvedValue("team-1");
  const onConverted = vi.fn();
  render(<ConvertToTeamGate vaultName="Personal" vaultId="v1" onCancel={vi.fn()} onConverted={onConverted} />);
  const go = screen.getByText("members.convert.confirm");
  fireEvent.click(go);
  fireEvent.click(go);
  await waitFor(() => expect(onConverted).toHaveBeenCalledWith("team-1"));
  expect(h.convert).toHaveBeenCalledTimes(1);
});

test("a failed conversion does not open the sheet", async () => {
  h.convert.mockRejectedValue(new Error("nope"));
  const onConverted = vi.fn();
  render(<ConvertToTeamGate vaultName="Personal" vaultId="v1" onCancel={vi.fn()} onConverted={onConverted} />);
  fireEvent.click(screen.getByText("members.convert.confirm"));
  await waitFor(() => expect(h.convert).toHaveBeenCalled());
  expect(onConverted).not.toHaveBeenCalled();
});

test("the vault name is interpolated into every placeholder, not left as {{vault}}", () => {
  h.t.mockImplementation(interpolatingT);
  render(<ConvertToTeamGate vaultName="Personal" vaultId="v1" onCancel={vi.fn()} onConverted={vi.fn()} />);
  // The modal portals into document.body, not the render() container.
  expect(document.body.textContent).toContain("Personal");
  expect(document.body.textContent).not.toContain("{{");
});
