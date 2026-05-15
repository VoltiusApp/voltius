import test from "node:test";
import assert from "node:assert/strict";
import { clearPersistedAccountUiState } from "../src/stores/persistedAccountUiState.ts";

class MemoryStorage {
  private values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }
}

test("clears persisted vault and team state when resetting an account", () => {
  const storage = new MemoryStorage();
  storage.setItem("voltius-vaults", JSON.stringify({ state: { vaults: [{ id: "vault", teamId: "team" }] } }));
  storage.setItem("voltius-teams", JSON.stringify({ state: { teams: [{ id: "team" }] } }));
  storage.setItem("voltius-theme", "keep");

  clearPersistedAccountUiState(storage);

  assert.equal(storage.getItem("voltius-vaults"), null);
  assert.equal(storage.getItem("voltius-teams"), null);
  assert.equal(storage.getItem("voltius-theme"), "keep");
});
