import { test, expect, vi, beforeEach } from "vitest";
import { cleanup, renderHook, waitFor } from "@testing-library/react";

const h = vi.hoisted(() => ({ getSecret: vi.fn() }));

vi.mock("@/services/vault", () => ({ getSecret: h.getSecret }));
vi.mock("@/i18n", () => ({ default: { t: (k: string) => k } }));

import { useStoredSecrets } from "./useStoredSecrets";
import { VaultUnreadableError } from "@/services/vaultErrors";

beforeEach(() => {
  cleanup();
  h.getSecret.mockReset();
});

const load = (keys: Record<string, string | null>, apply: (v: Partial<Record<string, string>>) => void) =>
  renderHook(() => useStoredSecrets("c1", keys, apply));

test("applies the secrets it could read and reports the vault as available", async () => {
  h.getSecret.mockImplementation(async (k: string) => (k === "password:c1" ? "hunter2" : null));
  const apply = vi.fn();

  const { result } = load({ password: "password:c1", passphrase: "passphrase:c1" }, apply);

  await waitFor(() => expect(apply).toHaveBeenCalled());
  expect(apply).toHaveBeenCalledWith({ password: "hunter2" });
  expect(result.current).toBe(false);
});

// A secret that was never stored is not a vault failure: the field is genuinely
// empty and the form must not cry wolf.
test("a missing secret is not reported as a vault failure", async () => {
  h.getSecret.mockResolvedValue(null);
  const apply = vi.fn();

  const { result } = load({ password: "password:c1" }, apply);

  await waitFor(() => expect(apply).toHaveBeenCalledWith({}));
  expect(result.current).toBe(false);
});

// The empty field looks identical to "nothing stored", so a user types a guess
// over a password the app is holding but cannot read.
test("an unreadable vault is reported so the form can say so", async () => {
  h.getSecret.mockImplementation(async () => {
    throw new VaultUnreadableError();
  });
  const apply = vi.fn();

  const { result } = load({ password: "password:c1" }, apply);

  await waitFor(() => expect(result.current).toBe(true));
  expect(apply).toHaveBeenCalledWith({});
});

test("skips fields with no secret key and does not touch the vault for them", async () => {
  h.getSecret.mockResolvedValue(null);
  const apply = vi.fn();

  load({ password: "password:c1", privateKey: null }, apply);

  await waitFor(() => expect(apply).toHaveBeenCalled());
  expect(h.getSecret).toHaveBeenCalledTimes(1);
  expect(h.getSecret).toHaveBeenCalledWith("password:c1");
});

test("reads nothing when there is no object to edit", async () => {
  const apply = vi.fn();
  renderHook(() => useStoredSecrets(undefined, { password: "password:c1" }, apply));

  await new Promise((r) => setTimeout(r, 0));
  expect(h.getSecret).not.toHaveBeenCalled();
  expect(apply).not.toHaveBeenCalled();
});
