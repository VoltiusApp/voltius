// @vitest-environment jsdom
import { test, expect, vi } from "vitest";
import { renderHook } from "@testing-library/react";

vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (k: string) => k }) }));
const h = vi.hoisted(() => ({ byObject: {} as Record<string, string> }));
vi.mock("@/stores/identityPickStore", () => ({
  useIdentityPickStore: (sel: (s: unknown) => unknown) => sel({ byObject: h.byObject, setHostPick: vi.fn() }),
}));
vi.mock("@/stores/teamStore", () => ({ useTeamStore: (sel: (s: unknown) => unknown) => sel({ teams: [{ id: "t1", name: "Ops" }] }) }));

import { useConnectAsMenuItem } from "./useConnectAsMenuItem";

const credential = (picksOffered: boolean) =>
  ({ plan: { kind: "host" }, teamId: "t1", choices: [{ id: "a", username: "u" }], hostIdentity: null, hasSharedCredential: true, isOwn: () => false, picksOffered }) as never;

test("Connect as follows the single pick gate", () => {
  const closed = renderHook(() => useConnectAsMenuItem({ id: "c", connection_type: "ssh" } as never, credential(false)));
  expect(closed.result.current).toBeUndefined();
  const open = renderHook(() => useConnectAsMenuItem({ id: "c", connection_type: "ssh" } as never, credential(true)));
  expect(open.result.current?.label).toBe("hosts.connectAs.title");
});

test("a stale pick with nothing else to choose can still be cleared", () => {
  const bare = { plan: { kind: "unavailable" }, teamId: "t1", choices: [], hostIdentity: null, hasSharedCredential: false, isOwn: () => false, picksOffered: true } as never;
  h.byObject = {};
  expect(renderHook(() => useConnectAsMenuItem({ id: "c" } as never, bare)).result.current).toBeUndefined();
  h.byObject = { c: "gone" };
  const menu = renderHook(() => useConnectAsMenuItem({ id: "c" } as never, bare)).result.current;
  expect(menu?.children?.map((i) => i.label)).toContain("hosts.connectAs.clearPick");
});

test("the host's own identity appears only as the host default", () => {
  h.byObject = {};
  const shared = { id: "a", username: "u", name: "ops-deploy" };
  const cred = { plan: { kind: "host" }, teamId: "t1", choices: [shared], hostIdentity: shared, hasSharedCredential: true, isOwn: () => false, picksOffered: true } as never;
  const menu = renderHook(() => useConnectAsMenuItem({ id: "c" } as never, cred)).result.current;
  expect(menu?.children?.filter((i) => i.label === "ops-deploy").map((i) => i.hint)).toEqual(["hosts.connectAs.hostDefault"]);
});
