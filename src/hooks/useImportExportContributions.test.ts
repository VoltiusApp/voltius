import { beforeEach, expect, test } from "vitest";
import { renderHook } from "@testing-library/react";
import { useUIContributionStore } from "@/stores/uiContributionStore";
import { useImportExportContributions } from "./useImportExportContributions";

const panelActions = (slot: string) =>
  useUIContributionStore.getState().contributions.get(`core:import-export::${slot}`)!;

beforeEach(() => {
  useUIContributionStore.setState({ contributions: new Map(), statusBarContributions: new Map() });
  renderHook(() => useImportExportContributions());
});

test.each(["connection.panelActions", "key.panelActions", "identity.panelActions"])(
  "%s offers nothing for an unsaved object instead of throwing",
  (slot) => {
    expect(panelActions(slot)(undefined)).toEqual([]);
  },
);

test("connection.panelActions offers Export for a saved connection", () => {
  expect(panelActions("connection.panelActions")({ id: "c1" })).toHaveLength(1);
});
