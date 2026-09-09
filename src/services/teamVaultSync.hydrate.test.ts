import { test, expect, vi, beforeEach } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => null) }));

vi.mock("@/services/teamObjectEnvelope", () => ({
  isEncryptedEnvelope: (m: unknown) =>
    typeof m === "object" && m !== null &&
    (m as Record<string, unknown>).v === 2 &&
    typeof (m as Record<string, unknown>).enc === "string",
  decodeObjectMetadata: vi.fn(async (_teamId: string, m: unknown) => {
    const rec = m as Record<string, unknown>;
    if (rec?.v === 2) return JSON.parse(rec.enc as string);
    return m as object;
  }),
}));

import { _hydrateTeamObjectStores } from "./teamVaultSync";
import { useConnectionStore } from "@/stores/connectionStore";

beforeEach(() => {
  useConnectionStore.setState({ teamConnections: {} });
});

test("hydrates a team holding both legacy and encrypted rows", async () => {
  await _hydrateTeamObjectStores("t1", [
    {
      object_id: "c1",
      object_type: "connection",
      metadata: { id: "c1", name: "legacy", host: "10.0.0.1" },
      updated_at: "2026-09-01T00:00:00.000Z",
      updated_by: "u1",
    },
    {
      object_id: "c2",
      object_type: "connection",
      metadata: { v: 2, enc: JSON.stringify({ id: "c2", name: "encrypted", host: "10.0.0.2" }) },
      updated_at: "2026-09-02T00:00:00.000Z",
      updated_by: "u2",
    },
  ] as never);

  const conns = useConnectionStore.getState().teamConnections.t1 ?? [];
  expect(conns.map((c) => c.name).sort()).toEqual(["encrypted", "legacy"]);
  expect(conns.find((c) => c.id === "c2")?.host).toBe("10.0.0.2");
  // updated_by is stamped from the row, not the decrypted payload.
  const c2 = conns.find((c) => c.id === "c2") as { updated_by?: string } | undefined;
  expect(c2?.updated_by).toBe("u2");
});

test("a row that fails to decrypt is dropped, not spread as garbage", async () => {
  const { decodeObjectMetadata } = await import("@/services/teamObjectEnvelope");
  vi.mocked(decodeObjectMetadata).mockRejectedValueOnce(new Error("bad key"));

  await _hydrateTeamObjectStores("t1", [
    {
      object_id: "c1",
      object_type: "connection",
      metadata: { v: 2, enc: "corrupt" },
      updated_at: "2026-09-01T00:00:00.000Z",
      updated_by: "u1",
    },
  ] as never);

  expect(useConnectionStore.getState().teamConnections.t1 ?? []).toEqual([]);
});
