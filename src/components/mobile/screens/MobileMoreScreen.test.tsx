// @vitest-environment jsdom
import { afterEach, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { useUIStore } from "@/stores/uiStore";
import MobileMoreScreen from "./MobileMoreScreen";

vi.mock("../MobileHeader", () => ({ default: () => null }));
vi.mock("@/services/account", () => ({ getCurrentUserEmail: async () => null }));
afterEach(cleanup);

test("opens Import/Export from More", () => {
  const open = vi.spyOn(useUIStore.getState(), "openImportExport");
  const { container } = render(<MobileMoreScreen />);
  fireEvent.click(container.querySelector('[data-more-page="import-export"]')!);
  expect(open).toHaveBeenCalledWith("import");
});
