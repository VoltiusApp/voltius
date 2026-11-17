import { expect, test } from "vitest";
import type { TFunction } from "i18next";
import { objectSyncItem } from "./objectSyncItem";

const t = ((k: string) => k) as unknown as TFunction;

test("synced objects offer to keep the object on this device", () => {
  expect(objectSyncItem(true, t)).toEqual({ label: "common.objectSync.disable", icon: "lucide:cloud-off" });
});

test("unsynced objects offer to sync", () => {
  expect(objectSyncItem(false, t)).toEqual({ label: "common.objectSync.enable", icon: "lucide:cloud" });
});
