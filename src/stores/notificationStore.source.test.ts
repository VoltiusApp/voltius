import { test, expect, beforeEach } from "vitest";
import { useNotificationStore } from "./notificationStore";
import type { NotificationSource } from "./notificationStore";

const get = () => useNotificationStore.getState();
const PLUGIN: NotificationSource = { kind: "plugin", id: "p1", name: "Plugin One" };
const APP: NotificationSource = { kind: "app", area: "team" };

beforeEach(() => {
  useNotificationStore.setState({ toasts: [], banners: [], history: [] });
});

test("a toast carries its source through to history on dismiss", () => {
  const id = get().addToast({
    source: APP,
    type: "toast",
    message: "hi",
    severity: "info",
    duration: 3000,
  });
  get().dismissToast(id);
  expect(get().history[0].source).toEqual(APP);
});

test("dismissAllForPlugin drops only that plugin's entries, never app entries", () => {
  get().addToast({ source: PLUGIN, type: "toast", message: "p", severity: "info", duration: 3000 });
  get().addToast({ source: APP, type: "toast", message: "a", severity: "info", duration: 3000 });
  get().addBanner({ source: PLUGIN, message: "pb", severity: "info", actions: [], dismissable: true });
  get().dismissAllForPlugin("p1");
  expect(get().toasts.map((t) => t.message)).toEqual(["a"]);
  expect(get().banners).toHaveLength(0);
});

test("entry ids stay namespaced per source so two sources cannot collide", () => {
  const a = get().addToast({ source: APP, type: "toast", message: "a", severity: "info", duration: 1 });
  const p = get().addToast({ source: PLUGIN, type: "toast", message: "p", severity: "info", duration: 1 });
  expect(a).not.toEqual(p);
  expect(p.startsWith("p1:")).toBe(true);
  expect(a.startsWith("app:")).toBe(true);
});
