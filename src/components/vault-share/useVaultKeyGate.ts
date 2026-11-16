import { useEffect, useState } from "react";
import type { TeamMember, TeamRole } from "@/services/teamService";
import { holdsVaultKeyGate } from "@/services/permissionPreview";
import { getServerCapability } from "@/services/serverCapabilities";

/** Whether `member` may fetch the vault key: undefined while asking, null when the server cannot or will not say. */
export function useVaultKeyGate(teamId: string, member: TeamMember, roles: TeamRole[], canManage: boolean): boolean | null | undefined {
  const [gate, setGate] = useState<boolean | null | undefined>(undefined);

  useEffect(() => {
    if (!canManage || !getServerCapability("permissionPreview")) { setGate(null); return; }
    let live = true;
    holdsVaultKeyGate(teamId, member.user_id).then(
      (held) => { if (live) setGate(held); },
      () => { if (live) setGate(null); },
    );
    return () => { live = false; };
  }, [teamId, member, roles, canManage]);

  return gate;
}
