import { test, expect, vi, afterEach } from "vitest";
import { render, cleanup, fireEvent, waitFor } from "@testing-library/react";

const h = vi.hoisted(() => ({ notify: vi.fn() }));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));
vi.mock("@iconify/react", () => ({ Icon: () => null }));
vi.mock("@/services/saveFile", () => ({ notify: h.notify }));

import { RuleSetMoveCancelled } from "@/services/teamObjectPersistence";
import MoveToFolderSheet from "./MoveToFolderSheet";

afterEach(() => {
  cleanup();
  h.notify.mockReset();
});

function pick(onPick: (folderId: string | null) => Promise<unknown>) {
  const onClose = vi.fn();
  render(<MoveToFolderSheet targets={[{ id: "f1", name: "Prod", depth: 0 }]} currentFolderId={null} onPick={onPick} onClose={onClose} />);
  fireEvent.click(document.querySelector("[data-move-target='f1']")!);
  return onClose;
}

test("cancelling the rule-set move warning closes the sheet silently", async () => {
  const onPick = vi.fn(async () => { throw new RuleSetMoveCancelled(); });
  const onClose = pick(onPick);
  expect(onPick).toHaveBeenCalledWith("f1");
  expect(onClose).toHaveBeenCalled();
  await Promise.resolve();
  await Promise.resolve();
  expect(h.notify).not.toHaveBeenCalled();
});

test("a failed move is reported instead of left unhandled", async () => {
  pick(async () => { throw new Error("boom"); });
  await waitFor(() => expect(h.notify).toHaveBeenCalledWith("error", "boom"));
});
