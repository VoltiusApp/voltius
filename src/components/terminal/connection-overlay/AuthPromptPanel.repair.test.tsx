import { afterEach, describe, test, expect, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { Identity } from "@/types";

vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (k: string) => k }), initReactI18next: { type: "3rdParty", init: () => {} } }));
vi.mock("@iconify/react", () => ({ Icon: () => null }));

const { own, shared, fromState } = vi.hoisted(() => ({
  own: { id: "own", username: "alice", tags: [] } as unknown as Identity,
  shared: { id: "shared", username: "deploy", vault_id: "t1", tags: [] } as unknown as Identity,
  fromState: (state: object) => Object.assign((sel?: (s: object) => unknown) => (sel ? sel(state) : state), { getState: () => state }),
}));

vi.mock("@/stores/keyStore", () => ({ useKeyStore: fromState({ keys: [], teamKeys: {}, loadKeys: async () => {} }) }));
vi.mock("@/stores/uiStore", () => ({ useUIStore: fromState({ setActiveNav: () => {} }) }));
vi.mock("@/stores/teamStore", () => ({ useTeamStore: fromState({ teams: [{ id: "t1", name: "Ops" }] }) }));
vi.mock("@/stores/vaultStore", () => ({ useVaultStore: fromState({ vaults: [] }) }));
vi.mock("@/stores/identityStore", () => ({ useIdentityStore: fromState({ identities: [own], teamIdentities: { t1: [shared] }, loadIdentities: async () => {} }) }));
vi.mock("@/stores/identityPickStore", () => ({ useIdentityPickStore: fromState({ status: "loaded" }) }));
vi.mock("@/hooks/usePermission", () => ({ usePermissions: () => () => true }));
vi.mock("@/components/shared/Pills", () => ({
  Pills: ({ options }: { options: { value: string; label: string }[] }) => <div>{options.map((o) => <span key={o.value}>{o.label}</span>)}</div>,
}));
vi.mock("@/components/connections/KeySelector", () => ({ default: () => null }));
vi.mock("@/components/connections/IdentitySelector", () => ({
  default: ({ identities, ownIdentities, onChange }: { identities: Identity[]; ownIdentities?: Identity[]; onChange: (id: string) => void }) => (
    <div>
      {[...identities, ...(ownIdentities ?? [])].map((i) => <button key={i.id} onClick={() => onChange(i.id)}>{`pick-${i.id}`}</button>)}
    </div>
  ),
}));

import { AuthPromptPanel } from "./AuthPromptPanel";

afterEach(cleanup);

const renderPanel = (repairVia?: "pick" | "default") => {
  const onSubmit = vi.fn();
  render(<AuthPromptPanel vaultId="t1" connectionId="c1" hostName="db-01" initialMode="identity" repairVia={repairVia} onSubmit={onSubmit} />);
  return onSubmit;
};

describe("choosing another identity after a broken pick", () => {
  test("an editor normally saves a team identity for everyone", () => {
    const onSubmit = renderPanel();
    fireEvent.click(screen.getByText("pick-shared"));
    expect(screen.getByText("terminal.overlay.saveTarget.everyone")).toBeTruthy();
    fireEvent.keyDown(window, { key: "Enter" });
    expect(onSubmit).toHaveBeenLastCalledWith({ identityId: "shared" }, true);
  });

  test.each([
    ["pick", "pick"],
    ["default", "vault-default"],
  ] as const)("repairing a %s replaces it and never offers Everyone", (via, saveAs) => {
    const onSubmit = renderPanel(via);
    fireEvent.click(screen.getByText("pick-shared"));
    expect(screen.queryByText("terminal.overlay.saveTarget.everyone")).toBeNull();
    expect(screen.queryByText("terminal.overlay.authPrompt.modePassword")).toBeNull();
    fireEvent.keyDown(window, { key: "Enter" });
    expect(onSubmit).toHaveBeenLastCalledWith({ identityId: "shared", saveAs }, true);
  });
});
