import { test, expect, vi } from "vitest";
import { renderHook } from "@testing-library/react";

vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (k: string) => k }) }));
vi.mock("@/stores/identityPickStore", () => ({
  useIdentityPickStore: (sel: (s: unknown) => unknown) => sel({ byObject: {}, setHostPick: vi.fn() }),
}));
vi.mock("@/stores/teamStore", () => ({ useTeamStore: (sel: (s: unknown) => unknown) => sel({ teams: [{ id: "t1", name: "Ops" }] }) }));

import { useConnectAsMenuItem } from "./useConnectAsMenuItem";

const credential = { plan: { kind: "host" }, teamId: "t1", choices: [{ id: "a", username: "u" }], hostIdentity: null, hasSharedCredential: true, ownIds: new Set(), supported: true } as never;

test("serial hosts get no Connect as; ssh hosts do", () => {
  const serial = renderHook(() => useConnectAsMenuItem({ id: "c", connection_type: "serial" } as never, credential));
  expect(serial.result.current).toBeUndefined();
  const ssh = renderHook(() => useConnectAsMenuItem({ id: "c", connection_type: "ssh" } as never, credential));
  expect(ssh.result.current?.label).toBe("hosts.connectAs.title");
});
