import { it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { ObjectRefCard } from "./ObjectRefCard";
import type { ObjectRef } from "../state/objectRefs";

vi.mock("@iconify/react", () => ({ Icon: () => null }));
vi.mock("@voltius/ui", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  ConnectionAvatar: () => null,
}));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (k: string) => k }) }));
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const ref: ObjectRef = {
  kind: "connection", id: "c1", name: "Prod DB", detail: "root@10.0.0.1:22",
  connection: { id: "c1", name: "Prod DB", host: "10.0.0.1", port: 22, username: "root", auth_type: "key", tags: [], connection_type: "ssh" },
};

it("renders name, endpoint and protocol badge", () => {
  render(<ObjectRefCard id="c1" refObj={ref} />);
  expect(screen.getByText("Prod DB")).toBeTruthy();
  expect(screen.getByText("root@10.0.0.1:22")).toBeTruthy();
  expect(screen.getByText("SSH")).toBeTruthy();
});

it("defaults the protocol badge to SSH when connection_type is absent", () => {
  render(<ObjectRefCard id="c1" refObj={{ ...ref, connection: { ...ref.connection, connection_type: undefined } }} />);
  expect(screen.getByText("SSH")).toBeTruthy();
});

it("renders a fallback card carrying the raw id when unresolved", () => {
  render(<ObjectRefCard id="conn_gone" refObj={null} />);
  expect(screen.getByText("aiAgent.objectRef.unknown")).toBeTruthy();
  expect(screen.getByTitle("conn_gone")).toBeTruthy();
});
