import { afterEach, beforeEach, describe, test, expect, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { Identity } from "@/types";

vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (k: string) => k }), initReactI18next: { type: "3rdParty", init: () => {} } }));
vi.mock("@iconify/react", () => ({ Icon: () => null }));

const h = vi.hoisted(() => {
  const ident = (id: string, over: object = {}) => ({ id, username: id, tags: [], ...over }) as unknown as Identity;
  const fromState = (state: () => object) =>
    Object.assign((sel?: (s: object) => unknown) => (sel ? sel(state()) : state()), { getState: state });
  return {
    ident,
    fromState,
    own: ident("own", { username: "alice" }),
    shared: ident("shared", { vault_id: "t1" }),
    hidden: ident("hidden", { vault_id: "t1" }),
    personalOnly: ident("mine", { vault_id: "personal" }),
    status: "loaded",
    connections: [] as object[],
    denied: new Set<string>(),
  };
});

vi.mock("@/stores/keyStore", () => ({ useKeyStore: h.fromState(() => ({ keys: [], teamKeys: {}, loadKeys: async () => {} })) }));
vi.mock("@/stores/uiStore", () => ({ useUIStore: h.fromState(() => ({ setActiveNav: () => {} })) }));
vi.mock("@/stores/teamStore", () => ({ useTeamStore: h.fromState(() => ({ teams: [{ id: "t1", name: "Ops" }] })) }));
vi.mock("@/stores/vaultStore", () => ({ useVaultStore: h.fromState(() => ({ vaults: [] })) }));
vi.mock("@/stores/identityStore", () => ({
  useIdentityStore: h.fromState(() => ({ identities: [h.own, h.personalOnly], teamIdentities: { t1: [h.shared, h.hidden] }, loadIdentities: async () => {} })),
}));
vi.mock("@/stores/identityPickStore", () => ({ useIdentityPickStore: h.fromState(() => ({ status: h.status, byObject: {}, byTeam: {} })) }));
vi.mock("@/hooks/usePermission", () => ({ usePermissions: () => (_p: string, _v: string, o?: string) => !h.denied.has(o ?? "") }));
vi.mock("@/hooks/useAllConnections", () => ({
  useAllConnections: () => h.connections,
  useConnection: (id: string) => (h.connections as { id: string }[]).find((c) => c.id === id),
}));
vi.mock("@/components/shared/Pills", () => ({
  Pills: ({ options }: { options: { value: string; label: string }[] }) => <div>{options.map((o) => <span key={o.value}>{o.label}</span>)}</div>,
}));
vi.mock("@/components/connections/KeySelector", () => ({ default: () => null }));
vi.mock("@/components/connections/IdentitySelector", () => ({
  default: ({ identities, ownIdentities, onChange }: { identities: Identity[]; ownIdentities?: Identity[]; onChange: (id: string) => void }) => (
    <div>
      {identities.map((i) => <button key={i.id} onClick={() => onChange(i.id)}>{`shared-${i.id}`}</button>)}
      {ownIdentities?.map((i) => <button key={i.id} onClick={() => onChange(i.id)}>{`own-${i.id}`}</button>)}
    </div>
  ),
}));

import { AuthPromptPanel } from "./AuthPromptPanel";

const teamHost = { id: "c1", vault_id: "t1", connection_type: "ssh", username: "root", host: "db-01" };

beforeEach(() => {
  h.status = "loaded";
  h.connections = [teamHost];
  h.denied = new Set();
});
afterEach(cleanup);

const renderPanel = (repairVia?: "pick" | "default", vaultId = "t1") => {
  const onSubmit = vi.fn();
  render(<AuthPromptPanel vaultId={vaultId} connectionId="c1" hostName="db-01" initialMode="identity" repairVia={repairVia} onSubmit={onSubmit} />);
  return onSubmit;
};

const listed = () => screen.getAllByRole("button").map((b) => b.textContent).filter((t) => /^(shared|own)-/.test(t ?? ""));

describe("choosing another identity after a broken pick", () => {
  test("an editor normally saves a team identity for everyone", () => {
    const onSubmit = renderPanel();
    fireEvent.click(screen.getByText("shared-shared"));
    expect(screen.getByText("terminal.overlay.saveTarget.everyone")).toBeTruthy();
    fireEvent.keyDown(window, { key: "Enter" });
    expect(onSubmit).toHaveBeenLastCalledWith({ identityId: "shared" }, true);
  });

  test.each([
    ["pick", "pick"],
    ["default", "vault-default"],
  ] as const)("repairing a %s replaces it and never offers Everyone", (via, saveAs) => {
    const onSubmit = renderPanel(via);
    fireEvent.click(screen.getByText("shared-shared"));
    expect(screen.queryByText("terminal.overlay.saveTarget.everyone")).toBeNull();
    expect(screen.queryByText("terminal.overlay.authPrompt.modePassword")).toBeNull();
    fireEvent.keyDown(window, { key: "Enter" });
    expect(onSubmit).toHaveBeenLastCalledWith({ identityId: "shared", saveAs }, true);
  });
});

describe("overlay identity groups", () => {
  test("a team host lists only identities the member can connect with, in both groups", () => {
    h.denied = new Set(["hidden"]);
    renderPanel();
    expect(listed()).toEqual(["shared-shared", "own-own", "own-mine"]);
  });

  test("a member without Connect on the host gets no own group", () => {
    h.denied = new Set(["c1"]);
    renderPanel();
    expect(listed()).toEqual(["shared-shared", "shared-hidden"]);
  });

  test("an FTP or unsupported team host gets no own group", () => {
    h.connections = [{ ...teamHost, connection_type: "ftp" }];
    renderPanel();
    expect(listed()).not.toContain("own-own");
    h.connections = [teamHost];
    h.status = "unsupported";
    cleanup();
    renderPanel();
    expect(listed()).not.toContain("own-own");
  });

  test("a personal host keeps today's list exactly", () => {
    h.connections = [{ ...teamHost, vault_id: "personal" }];
    renderPanel(undefined, "personal");
    expect(listed()).toEqual(["shared-own", "shared-mine"]);
  });
});
