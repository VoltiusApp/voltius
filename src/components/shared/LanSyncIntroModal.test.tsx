import { describe, test, expect, vi, afterEach } from "vitest";
import { render, cleanup, fireEvent } from "@testing-library/react";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => undefined) }));

import { LanSyncIntroModal } from "./LanSyncIntroModal";
import { useLanSyncIntroStore } from "@/services/lanSyncIntro";

afterEach(() => {
  cleanup();
  useLanSyncIntroStore.setState({ open: false });
});

describe("LanSyncIntroModal", () => {
  test("Escape and a backdrop click do not dismiss it; Continue does", () => {
    useLanSyncIntroStore.setState({ open: true });
    const { getByText, queryByText } = render(<LanSyncIntroModal />);
    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.click(document.querySelector("[role='dialog']")!.parentElement!);
    expect(getByText("layout.sync.local.intro")).toBeTruthy();
    fireEvent.click(getByText("layout.sync.local.introContinue"));
    expect(queryByText("layout.sync.local.intro")).toBeNull();
  });
});
