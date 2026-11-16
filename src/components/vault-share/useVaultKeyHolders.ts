import { useCallback, useEffect, useRef, useState } from "react";
import { getVaultKeyHolders } from "@/services/teamService";
import { grantVaultKeyToMember } from "@/services/vaultShare";

export interface VaultKeyHolders {
  holders: Set<string> | null;
  reload(): void;
  grant(m: { userId: string; label: string; publicKey: string }): Promise<void>;
}

export function useVaultKeyHolders(teamId: string | null): VaultKeyHolders {
  const [holders, setHolders] = useState<Set<string> | null>(null);
  const generation = useRef(0);

  // Best-effort: a member without MANAGE permission is refused this list, so it stays null.
  const reload = useCallback(() => {
    if (!teamId) return;
    const gen = ++generation.current;
    getVaultKeyHolders(teamId)
      .then((ids) => { if (gen === generation.current) setHolders(new Set(ids)); })
      .catch(() => {});
  }, [teamId]);

  useEffect(() => {
    setHolders(null);
    reload();
    return () => { generation.current++; };
  }, [reload]);

  const grant = useCallback(async (m: { userId: string; label: string; publicKey: string }) => {
    if (!teamId) return;
    try {
      await grantVaultKeyToMember({ teamId, ...m });
    } catch {
      return;
    }
    reload();
  }, [teamId, reload]);

  return { holders, reload, grant };
}
