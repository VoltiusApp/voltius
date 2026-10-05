// @vitest-environment jsdom
import { test, expect, vi, afterEach } from "vitest";

vi.mock("@/services/sync", () => ({ scheduleSync: vi.fn() }));

import { useTeamStore } from "@/stores/teamStore";
import { useVaultStore } from "@/stores/vaultStore";
import type { Team } from "@/services/teamService";
import { startTeamVaultNames } from "./teamVaultNames";

const team = (id: string, name: string) => ({ id, name, owner_id: "o", owner_tier: "team", created_at: "", role_ids: [] }) as Team;

afterEach(() => useTeamStore.setState({ teams: [] }));

test("a team vault shows its team's server name and follows a rename", () => {
  useVaultStore.setState({ vaults: [{ id: "personal", name: "Personal" }, { id: "v-team", name: "", teamId: "t1" }] });
  useTeamStore.setState({ teams: [team("t1", "test")] });
  const stop = startTeamVaultNames();
  expect(useVaultStore.getState().vaults.find((v) => v.id === "v-team")?.name).toBe("test");

  useTeamStore.setState({ teams: [team("t1", "Ops")] });
  expect(useVaultStore.getState().vaults.find((v) => v.id === "v-team")?.name).toBe("Ops");
  expect(useVaultStore.getState().vaults.find((v) => v.id === "personal")?.name).toBe("Personal");
  stop();
});
