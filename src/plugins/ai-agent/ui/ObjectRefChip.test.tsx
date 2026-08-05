import { it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { ObjectRefChip } from "./ObjectRefChip";
import type { ObjectRef } from "../state/objectRefs";
import { installFakeI18n } from "../testing/fakeI18n";

installFakeI18n((k: string) => k);

vi.mock("@iconify/react", () => ({ Icon: () => null }));
vi.mock("@voltius/ui", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  ConnectionAvatar: () => null,
}));
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const ref: ObjectRef = {
  kind: "connection", id: "c1", name: "Prod DB", detail: "root@10.0.0.1:22",
  connection: { id: "c1", name: "Prod DB", host: "10.0.0.1", port: 22, username: "root", auth_type: "key", tags: [] },
};

it("renders the resolved name and endpoint title", () => {
  render(<ObjectRefChip id="c1" refObj={ref} />);
  expect(screen.getByText("Prod DB")).toBeTruthy();
  expect(screen.getByTitle("root@10.0.0.1:22")).toBeTruthy();
});

it("renders a fallback with the raw id in the title when unresolved", () => {
  render(<ObjectRefChip id="conn_gone" refObj={null} />);
  expect(screen.getByText("aiAgent.objectRef.unknown")).toBeTruthy();
  expect(screen.getByTitle("conn_gone")).toBeTruthy();
});
