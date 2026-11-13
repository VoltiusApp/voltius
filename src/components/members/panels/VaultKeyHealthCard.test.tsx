// @vitest-environment jsdom
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { RotationPass } from "@/services/teamKeyRotation";
import type { RotationStatus, StaleItem } from "@/services/teamService";

const h = vi.hoisted(() => ({
  status: null as RotationStatus | null,
  stale: [] as StaleItem[],
  hidden: 0,
  objects: [] as { object_id: string; name?: string; metadata: unknown }[],
  undecodable: new Set<string>(),
  allowed: new Set<string>(["VIEW_SECRETS", "COPY_SECRETS"]),
  pass: undefined as RotationPass | undefined,
  listeners: new Set<() => void>(),
  rotate: vi.fn(async () => undefined),
  deleteObject: vi.fn(async () => undefined),
  deleteSecret: vi.fn(async () => undefined),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string, o?: Record<string, unknown>) => (o?.count !== undefined ? `${k}:${o.count}` : o?.name ? `${k}:${o.name}` : k) }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));
vi.mock("@iconify/react", () => ({ Icon: () => null }));
vi.mock("@/hooks/usePermission", () => ({ usePermissions: () => (p: string) => h.allowed.has(p) }));
vi.mock("@/services/teamActionFeedback", () => ({ runTeamAction: ({ run }: { run: () => Promise<unknown> }) => run() }));
vi.mock("@/services/teamService", () => ({
  getRotationStatus: vi.fn(async () => {
    if (!h.status) throw new Error("403");
    return h.status;
  }),
  getStaleItems: vi.fn(async () => ({ epoch: 2, items: h.stale, hidden: h.hidden, truncated: false })),
}));
vi.mock("@/services/teamKeyRotation", () => ({
  checkAndRotateTeamKey: h.rotate,
  getLastRotationPass: () => h.pass,
  subscribeRotationPasses: (l: () => void) => { h.listeners.add(l); return () => h.listeners.delete(l); },
}));
vi.mock("@/services/teamObjects", () => ({
  listTeamObjects: vi.fn(async () => h.objects),
  deleteTeamObject: h.deleteObject,
  deleteTeamSecret: h.deleteSecret,
}));
vi.mock("@/services/teamObjectRows", () => ({
  decodeTeamObject: vi.fn(async (_t: string, row: { object_id: string; name?: string }) => {
    if (h.undecodable.has(row.object_id)) throw new Error("bad tag");
    return { name: `decoded-${row.object_id}` };
  }),
}));

import { VaultKeyHealthCard } from "./VaultKeyHealthCard";
import { PERM_BITS } from "@/services/permissions";

const EDIT = PERM_BITS.VIEW | PERM_BITS.EDIT_CONNECTIONS;
const item = (s: Partial<StaleItem>): StaleItem => ({
  kind: "object", object_id: "c1", secret_id: null, object_type: "connection", key_version: 1, orphan: false, my_permissions: EDIT, ...s,
});
const state = async () => {
  await waitFor(() => expect(document.querySelector("[data-vault-key-health]")?.getAttribute("data-vault-key-health")).not.toBe("loading"));
  return document.querySelector("[data-vault-key-health]")!.getAttribute("data-vault-key-health");
};

beforeEach(() => {
  h.status = { stale: false, draining: false, epoch: 1, rotated_at: null, rotation_requested_at: null, uncovered_members: 0, old_epoch: { objects: 0, secrets: 0, blobs: 0 } };
  h.stale = [];
  h.hidden = 0;
  h.objects = [];
  h.undecodable = new Set();
  h.allowed = new Set(["VIEW_SECRETS", "COPY_SECRETS"]);
  h.pass = undefined;
  h.rotate.mockClear();
  h.deleteObject.mockClear();
  h.deleteSecret.mockClear();
});
afterEach(cleanup);

test("a healthy vault reads up to date with its key version", async () => {
  render(<VaultKeyHealthCard teamId="t" />);
  expect(await state()).toBe("upToDate");
  expect(screen.getByText("members.keyHealth.versionNever")).toBeTruthy();
  expect(screen.getByText("members.keyHealth.device.never")).toBeTruthy();
});

test("an unreadable status shows unavailable", async () => {
  h.status = null;
  render(<VaultKeyHealthCard teamId="t" />);
  expect(await state()).toBe("unavailable");
  expect(screen.getByText("members.keyHealth.loadFailed")).toBeTruthy();
});

test("a pending rotation greys out retry with a reason for someone who can't share passwords", async () => {
  h.status = { ...h.status!, stale: true, rotation_requested_at: new Date().toISOString() };
  h.allowed = new Set(["VIEW_SECRETS"]);
  render(<VaultKeyHealthCard teamId="t" />);
  expect(await state()).toBe("rotationPending");
  const retry = screen.getByRole("button", { name: "members.keyHealth.retry" }) as HTMLButtonElement;
  expect(retry.disabled).toBe(true);
  expect(retry.title).toBe("members.keyHealth.retryDenied");
});

test("retry runs one pass", async () => {
  h.status = { ...h.status!, stale: true, rotation_requested_at: new Date().toISOString() };
  render(<VaultKeyHealthCard teamId="t" />);
  await state();
  fireEvent.click(screen.getByRole("button", { name: "members.keyHealth.retry" }));
  await waitFor(() => expect(h.rotate).toHaveBeenCalledWith("t"));
});

test("stuck items show why, and only undecryptable or orphan rows offer removal", async () => {
  h.status = { ...h.status!, draining: true, epoch: 2, rotated_at: new Date().toISOString(), old_epoch: { objects: 3, secrets: 1, blobs: 0 } };
  h.stale = [
    item({ object_id: "bad" }),
    item({ object_id: "ok" }),
    item({ object_id: "locked", my_permissions: PERM_BITS.VIEW }),
    item({ kind: "secret", secret_id: "s9", object_id: "gone", object_type: null, orphan: true, my_permissions: 0 }),
  ];
  h.hidden = 2;
  h.objects = [{ object_id: "bad", metadata: {} }, { object_id: "ok", metadata: {} }, { object_id: "locked", metadata: {} }];
  h.undecodable = new Set(["bad"]);
  render(<VaultKeyHealthCard teamId="t" />);

  expect(await state()).toBe("reencryptPending");
  await screen.findByText("decoded-ok");
  expect(screen.getByText("members.keyHealth.remaining:4", { exact: false })).toBeTruthy();
  expect(screen.getByText("members.keyHealth.reason.undecryptable")).toBeTruthy();
  expect(screen.getByText("members.keyHealth.reason.waiting")).toBeTruthy();
  expect(screen.getByText("members.keyHealth.reason.needsEditor")).toBeTruthy();
  expect(screen.getByText("members.keyHealth.reason.orphan")).toBeTruthy();
  expect(screen.getByText("members.keyHealth.stuck.hidden:2")).toBeTruthy();
  expect(screen.getAllByRole("button", { name: "members.keyHealth.remove" })).toHaveLength(2);
});

test("removing an orphan secret deletes the secret after confirmation", async () => {
  h.status = { ...h.status!, draining: true, epoch: 2, rotated_at: new Date().toISOString() };
  h.stale = [item({ kind: "secret", secret_id: "s9", object_id: "gone", object_type: null, orphan: true, my_permissions: 0 })];
  render(<VaultKeyHealthCard teamId="t" />);
  fireEvent.click(await screen.findByRole("button", { name: "members.keyHealth.remove" }));
  expect(screen.getByText("members.keyHealth.removeOrphanBody")).toBeTruthy();
  const buttons = screen.getAllByRole("button", { name: "members.keyHealth.remove" });
  fireEvent.click(buttons[buttons.length - 1]);
  await waitFor(() => expect(h.deleteSecret).toHaveBeenCalledWith("t", "s9"));
  expect(h.deleteObject).not.toHaveBeenCalled();
});

test("a failed pass on this device marks the vault as needing attention", async () => {
  h.status = { ...h.status!, draining: true, epoch: 2, rotated_at: new Date().toISOString() };
  h.pass = { at: Date.now(), action: "drained", failures: [{ kind: "object", id: "c1", stage: "upload" }], skipped: 0 };
  h.stale = [item({})];
  render(<VaultKeyHealthCard teamId="t" />);
  expect(await state()).toBe("attention");
  expect(screen.getByText("members.keyHealth.device.failed:1")).toBeTruthy();
  expect(await screen.findByText("members.keyHealth.reason.uploadFailed")).toBeTruthy();
});
