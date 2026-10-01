import { test, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import type { Connection } from "@/types";
import type { CredentialPlanResult } from "@/hooks/useCredentialPlan";

vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (k: string) => k }) }));
vi.mock("@iconify/react", () => ({ Icon: () => null }));
vi.mock("@/hooks/useConnectAsMenuItem", () => ({
  useConnectAsMenuItem: (_c: unknown, credential: { picksOffered: boolean }) =>
    credential.picksOffered ? { label: "x", children: [{ label: "y", onClick: () => {} }] } : undefined,
}));

import { YouConnectAsRow } from "./YouConnectAsRow";

afterEach(cleanup);

const connection = { id: "c1", name: "db", host: "h", port: 22, username: "root" } as unknown as Connection;
const alice = { id: "own", username: "alice" };
const credential = (over: object) =>
  ({ plan: { kind: "host" }, isOwn: () => true, hostIdentity: null, hasSharedCredential: false, picksOffered: false, ...over }) as unknown as CredentialPlanResult;

test("with a cached pick but picks not yet loaded, the row shows the pick without a Change button", () => {
  render(<YouConnectAsRow connection={connection} credential={credential({ plan: { kind: "pick", identity: alice } })} />);
  expect(screen.getByText("alice")).toBeTruthy();
  expect(screen.queryByText("connections.form.change")).toBeNull();
});

test("with picks offered the row keeps its Change button", () => {
  render(<YouConnectAsRow connection={connection} credential={credential({ plan: { kind: "pick", identity: alice }, picksOffered: true })} />);
  expect(screen.getByText("connections.form.change")).toBeTruthy();
});

test("without picks the host plan renders nothing, as in 0.45", () => {
  const { container } = render(<YouConnectAsRow connection={connection} credential={credential({})} />);
  expect(container.innerHTML).toBe("");
});
