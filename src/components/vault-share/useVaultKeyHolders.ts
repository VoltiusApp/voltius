import { useCallback, useEffect, useRef, useState } from "react";
import { getVaultKeyHolders, type TeamMember, type TeamRole } from "@/services/teamService";
import { grantVaultKeyToMember } from "@/services/vaultShare";
import { holdsVaultKeyGate } from "@/services/permissionPreview";
import { getServerCapability } from "@/services/serverCapabilities";

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

/** Whether `member` may fetch the vault key: undefined while asking, null when the server cannot say. */
export function useVaultKeyGate(teamId: string, member: TeamMember, roles: TeamRole[]): boolean | null | undefined {
  const [gate, setGate] = useState<boolean | null | undefined>(undefined);

  useEffect(() => {
    if (!getServerCapability("permissionPreview")) { setGate(null); return; }
    let live = true;
    holdsVaultKeyGate(teamId, member.user_id).then(
      (held) => { if (live) setGate(held); },
      () => { if (live) setGate(null); },
    );
    return () => { live = false; };
  }, [teamId, member, roles]);

  return gate;
}
