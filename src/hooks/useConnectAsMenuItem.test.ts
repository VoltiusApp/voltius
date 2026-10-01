import { test, expect, vi } from "vitest";
import { renderHook } from "@testing-library/react";

vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (k: string) => k }) }));
vi.mock("@/stores/identityPickStore", () => ({
  useIdentityPickStore: (sel: (s: unknown) => unknown) => sel({ byObject: {}, setHostPick: vi.fn() }),
}));
vi.mock("@/stores/teamStore", () => ({ useTeamStore: (sel: (s: unknown) => unknown) => sel({ teams: [{ id: "t1", name: "Ops" }] }) }));

import { useConnectAsMenuItem } from "./useConnectAsMenuItem";

const credential = (picksOffered: boolean) =>
  ({ plan: { kind: "host" }, teamId: "t1", choices: [{ id: "a", username: "u" }], hostIdentity: null, hasSharedCredential: true, ownIds: new Set(), picksOffered }) as never;

test("Connect as follows the single pick gate", () => {
  const closed = renderHook(() => useConnectAsMenuItem({ id: "c", connection_type: "ssh" } as never, credential(false)));
  expect(closed.result.current).toBeUndefined();
  const open = renderHook(() => useConnectAsMenuItem({ id: "c", connection_type: "ssh" } as never, credential(true)));
  expect(open.result.current?.label).toBe("hosts.connectAs.title");
});
