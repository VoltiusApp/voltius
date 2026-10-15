import { test, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import type { Connection } from "@/types";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));
vi.mock("@iconify/react", () => ({ Icon: () => null }));
vi.mock("./ConnectionAvatar", () => ({ ConnectionAvatar: () => null }));
vi.mock("@/hooks/useLocalShells", () => ({ useLocalShells: () => [] }));

import { SessionPickerPanel } from "./SessionPickerPanel";
import { useConnectionStore } from "@/stores/connectionStore";

const initial = useConnectionStore.getState();
afterEach(() => { cleanup(); useConnectionStore.setState(initial, true); });

const host = (id: string, last_used_at: string | null = null): Connection =>
  ({ id, name: id, host: `${id}.lan`, port: 22, username: "u", vault_id: "personal", last_used_at }) as Connection;

test("recent hosts come first, once each, and drop out while searching", () => {
  useConnectionStore.setState({ connections: [host("idle-box"), host("used-box", "2026-02-01T00:00:00Z")] });
  render(<SessionPickerPanel mode="execute" onConfirm={() => {}} onClose={() => {}} />);
  const recent = () => document.querySelector("[data-host-picker-recent]")?.textContent ?? "";
  expect(recent()).toContain("used-box");
  expect(recent()).not.toContain("idle-box");
  expect(screen.getAllByText("used-box")).toHaveLength(1);
  expect(screen.getByText("common.entity.hosts")).toBeTruthy();

  fireEvent.change(screen.getByPlaceholderText("common.placeholder.filter"), { target: { value: "box" } });
  expect(document.querySelector("[data-host-picker-recent]")).toBeNull();
});
