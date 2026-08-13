import { test, expect, beforeEach, vi } from "vitest";
import { useNotificationStore } from "./notificationStore";
import type { NotificationSource } from "./notificationStore";

const get = () => useNotificationStore.getState();
const APP: NotificationSource = { kind: "app", area: "team" };

function entry(id: string, message = "m", actions: Array<{ label: string; run: () => Promise<void> }> = []) {
  return { id, source: APP, kind: "invite" as const, message, actions };
}

beforeEach(() => {
  useNotificationStore.setState({ toasts: [], banners: [], history: [], inbox: [] });
});

test("upsertInbox is idempotent for the same key", () => {
  get().upsertInbox(entry("invite:1"));
  get().upsertInbox(entry("invite:1"));
  expect(get().inbox).toHaveLength(1);
});

test("upsertInbox updates an existing entry in place, preserving createdAt", () => {
  get().upsertInbox(entry("invite:1", "old"));
  const createdAt = get().inbox[0].createdAt;
  get().upsertInbox(entry("invite:1", "new"));
  expect(get().inbox[0].message).toBe("new");
  expect(get().inbox[0].createdAt).toBe(createdAt);
});

test("retractInbox removes the entry entirely, leaving no history row", () => {
  get().upsertInbox(entry("invite:1"));
  get().retractInbox("invite:1");
  expect(get().inbox).toHaveLength(0);
  expect(get().history).toHaveLength(0);
});

test("resolveInbox keeps the entry but marks it resolved with its outcome", () => {
  get().upsertInbox(entry("invite:1"));
  get().resolveInbox("invite:1", "Declined");
  expect(get().inbox[0].state).toBe("resolved");
  expect(get().inbox[0].resolution).toBe("Declined");
});

test("runInboxAction blocks a second dispatch while the first is in flight", async () => {
  let release: () => void = () => {};
  const run = vi.fn(() => new Promise<void>((r) => { release = r; }));
  get().upsertInbox(entry("invite:1", "m", [{ label: "Accept", run }]));

  const first = get().runInboxAction("invite:1", 0);
  expect(get().inbox[0].state).toBe("acting");
  await get().runInboxAction("invite:1", 0);
  expect(run).toHaveBeenCalledTimes(1);

  release();
  await first;
});

test("a failed action returns the entry to pending so it can be retried", async () => {
  const run = vi.fn(async () => { throw new Error("network"); });
  get().upsertInbox(entry("invite:1", "m", [{ label: "Accept", run }]));
  await get().runInboxAction("invite:1", 0);
  expect(get().inbox[0].state).toBe("pending");
});

test("unreadCount counts pending inbox entries and banners, and falls to zero when they resolve", () => {
  get().upsertInbox(entry("invite:1"));
  get().upsertInbox(entry("invite:2"));
  expect(get().unreadCount()).toBe(2);
  get().resolveInbox("invite:1", "Accepted");
  get().retractInbox("invite:2");
  expect(get().unreadCount()).toBe(0);
});
