import { test, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({ sent: [] as Record<string, unknown>[] }));

vi.mock("@/services/teamObjects", () => ({
  upsertTeamObject: vi.fn(async (_teamId: string, object: Record<string, unknown>) => {
    h.sent.push(object);
  }),
  deleteTeamObject: vi.fn(async () => {}),
}));

vi.mock("@/services/teamObjectEnvelope", () => ({
  encodeObjectMetadata: vi.fn(async (_teamId: string, item: object) => ({
    v: 2 as const,
    enc: JSON.stringify(item),
  })),
}));

import { saveTeamVaultObject } from "./teamObjectPersistence";

beforeEach(() => {
  h.sent = [];
});

test("sends an encrypted envelope and no plaintext name or folder id", async () => {
  await saveTeamVaultObject("t1", "connection", {
    id: "c1",
    name: "prod-db-master",
    folder_id: "f7",
    host: "10.0.0.1",
  } as never);

  expect(h.sent).toHaveLength(1);
  const sent = h.sent[0];
  expect(sent.object_id).toBe("c1");
  expect(sent.object_type).toBe("connection");
  expect(sent.name).toBeNull();
  expect(sent.folder_id).toBeNull();
  expect(sent.metadata).toEqual({ v: 2, enc: expect.any(String) });
  // The mock's `enc` is a passthrough JSON.stringify(item), so the plaintext
  // legitimately appears *inside* the envelope. What must never happen is the
  // plaintext appearing anywhere else in the request (e.g. name/folder_id).
  expect(JSON.stringify({ ...sent, metadata: undefined })).not.toContain("prod-db-master");
});
