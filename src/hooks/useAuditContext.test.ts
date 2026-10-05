// @vitest-environment jsdom
import { test, expect, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useVaultStore } from "@/stores/vaultStore";
import { useTeamStore } from "@/stores/teamStore";
import { useSelectedAuditContext } from "./useAuditContext";

const initialVault = useVaultStore.getState();
const initialTeam = useTeamStore.getState();

afterEach(() => {
  useVaultStore.setState(initialVault, true);
  useTeamStore.setState(initialTeam, true);
});

test("an owner's converted vault reads the whole team trail, not rows filtered by the local vault id", () => {
  useTeamStore.setState({ teams: [{ id: "team-1", name: "Ops" }] as never });
  useVaultStore.setState({
    vaults: [{ id: "local-1", name: "Ops", teamId: "team-1" }] as never,
    selectedVaultIds: ["local-1"],
  });

  const { result } = renderHook(() => useSelectedAuditContext());

  expect(result.current).toEqual({ kind: "team", teamId: "team-1" });
});

test("a private vault keeps its local context", () => {
  useVaultStore.setState({
    vaults: [{ id: "local-2", name: "Mine" }] as never,
    selectedVaultIds: ["local-2"],
  });

  const { result } = renderHook(() => useSelectedAuditContext());

  expect(result.current).toEqual({ kind: "local", vaultId: "local-2" });
});
