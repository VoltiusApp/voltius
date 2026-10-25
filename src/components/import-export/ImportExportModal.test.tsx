// @vitest-environment jsdom
import { afterEach, expect, test, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { useUIStore } from "@/stores/uiStore";
import { ImportExportModal } from "./ImportExportModal";

vi.mock("@/utils/platform", async (orig) => ({ ...(await orig<object>()), useIsAndroid: () => true, useIsMobile: () => true }));
vi.mock("@/services/import-export/registry", () => ({ reloadAll: async () => {} }));
vi.mock("./useStores", () => ({ useReloadFns: () => [] }));
vi.mock("./ImportTab", () => ({ ImportTab: () => null }));
vi.mock("./ExportTab", () => ({ ExportTab: () => null }));
vi.mock("./UserDataImportTab", () => ({ UserDataImportTab: () => null }));
vi.mock("./UserDataExportTab", () => ({ UserDataExportTab: () => null }));
afterEach(cleanup);

test("fills the screen on Android", () => {
  useUIStore.getState().openImportExport("import");
  render(<ImportExportModal />);
  expect(document.querySelector("[data-import-export-fullscreen]")).toBeTruthy();
});
