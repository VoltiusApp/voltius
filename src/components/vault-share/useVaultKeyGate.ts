import { useEffect, useState } from "react";
import type { TeamMember, TeamRole } from "@/services/teamService";
import { holdsVaultKeyGate } from "@/services/permissionPreview";
import { getServerCapability } from "@/services/serverCapabilities";

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
