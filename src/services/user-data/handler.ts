// One implementation per settings domain. Register in registry.ts.
// Adding a new domain = new handler file + one entry in USER_DATA_HANDLERS.

export interface UserDataHandler {
  readonly key: string;
  readonly label: string;
  readonly icon: string;

  // Read current state from stores. Must be side-effect free: mergeUserDataBundle
  // calls this on the absent-section path, outside of any explicit export flow.
  export(): unknown;

  // Write exported state to stores.
  import(data: unknown): Promise<void>;

  // LWW merge: returns the winning value and whether local was overwritten by remote.
  merge(
    local: unknown,
    remote: unknown,
    localTs: string,
    remoteTs: string,
  ): { value: unknown; updated: boolean };

  // ISO timestamp of the most recent local change to this domain.
  getTimestamp(): string;

  // Stamp this domain as changed now, so the next merge publishes local values.
  // Called when the user switches sync back on for the domain.
  touch(): void;

  // Short human-readable summary of current state, e.g. "3 custom themes".
  describe(): string;
}

// The default merge: whichever side is missing loses, otherwise the newer
// timestamp wins. Every handler so far wants exactly this.
export const lastWriteWins: UserDataHandler["merge"] = (local, remote, localTs, remoteTs) => {
  if (!local) return { value: remote, updated: true };
  if (!remote) return { value: local, updated: false };
  if (remoteTs > localTs) return { value: remote, updated: true };
  return { value: local, updated: false };
};
