import { useEffect, useRef, useState } from "react";
import { Icon } from "@iconify/react";
import { useTranslation } from "react-i18next";
import { useVaultStore } from "@/stores/vaultStore";
import { useTeamStore } from "@/stores/teamStore";
import { getMyUserId } from "@/services/teamService";
import { effectivePermissions, PERM_BITS } from "@/hooks/usePermission";
import { PickerSurface } from "./PickerSurface";

export function VaultPicker({
  vaultId,
  onChange,
}: {
  vaultId: string;
  onChange: (id: string) => void;
}) {
  const { t } = useTranslation();
  const { vaults, selectVaultOnly } = useVaultStore();
  const { teams, membersByTeam, loadMembers, loadTeams, rolesByTeam, loadRoles } = useTeamStore();
  const [myUserId, setMyUserId] = useState("");
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    getMyUserId().then((id) => { if (id) setMyUserId(id); }).catch(() => {});
  }, []);

  useEffect(() => {
    loadTeams().catch(() => {});
  }, [loadTeams]);

  useEffect(() => {
    teams.forEach((team) => {
      if (!membersByTeam[team.id]) loadMembers(team.id).catch(() => {});
      if (!rolesByTeam[team.id]) loadRoles(team.id).catch(() => {});
    });
  }, [teams, membersByTeam, rolesByTeam, loadMembers, loadRoles]);

  const myPrimaryRoleIn = (teamId: string): string => {
    const member = membersByTeam[teamId]?.find((m) => m.user_id === myUserId);
    if (!member) return "";
    const roles = rolesByTeam[teamId] ?? [];
    return roles
      .filter((r) => member.role_ids.includes(r.id) && r.is_builtin)
      .sort((a, b) => a.position - b.position)[0]?.name ?? "";
  };

  const canWrite = (vId: string): boolean => {
    if (vId === "personal") return true;
    const member = membersByTeam[vId]?.find((m) => m.user_id === myUserId);
    if (!member || !myUserId) return true; // optimistic while loading
    const roles = rolesByTeam[vId] ?? [];
    if (roles.length === 0) return true; // optimistic while loading
    return (effectivePermissions(member, roles) & PERM_BITS.EDIT_CONNECTIONS) !== 0;
  };

  const linkedTeamIds = new Set(vaults.map((v) => v.teamId).filter(Boolean));
  // Use teamId (the portable team UUID) as the ID for team-linked vaults so the
  // displayed selection matches what is stored in vault_id after a move/create.
  const allVaults = [
    ...vaults.map((v) => ({ id: v.teamId ?? v.id, name: v.name, team: !!v.teamId })),
    ...teams.filter((team) => !linkedTeamIds.has(team.id)).map((team) => ({ id: team.id, name: team.name, team: true })),
  ];

  const currentId = vaultId || "personal";
  const currentVault = allVaults.find((v) => v.id === currentId);
  const label = currentVault?.name ?? t("common.entity.personal");

  const select = (id: string) => {
    if (!canWrite(id)) return;
    onChange(id);
    selectVaultOnly(id);
    setOpen(false);
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1 text-xs select-none transition-opacity hover:opacity-80"
        style={{ color: "var(--t-text-dim)" }}
      >
        <span>{label}</span>
        <Icon icon="lucide:chevron-down" width={11} style={{ color: "var(--t-text-dim)" }} />
      </button>

      <PickerSurface
        open={open}
        onClose={() => setOpen(false)}
        anchorRef={triggerRef}
        title={t("common.entity.vault")}
        width="content"
        minWidth="13rem"
      >
        {allVaults.map((v) => {
              const selected = v.id === currentId;
              const writable = canWrite(v.id);
              const role = v.team ? myPrimaryRoleIn(v.id) : "";
              const blocked = !writable;

              return (
                <button
                  key={v.id}
                  type="button"
                  onClick={() => select(v.id)}
                  disabled={blocked}
                  className="w-full flex items-center gap-2.5 p-3 rounded-lg text-sm font-medium-bold transition-colors"
                  style={{ color: "var(--t-text-secondary)", cursor: blocked ? "default" : "pointer", opacity: !writable ? 0.45 : 1 }}
                  onMouseEnter={(e) => { if (!blocked) { (e.currentTarget as HTMLButtonElement).style.background = "var(--t-bg-card-hover)"; (e.currentTarget as HTMLButtonElement).style.color = "var(--t-text-primary)"; } }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "transparent"; (e.currentTarget as HTMLButtonElement).style.color = "var(--t-text-secondary)"; }}
                >
                  <Icon icon="lucide:vault" width={14} className="shrink-0" style={{ color: "var(--t-text-muted)" }} />
                  <span className="flex-1 text-left text-(--t-text-primary) truncate">
                    {v.name}
                  </span>
                  {!writable && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full shrink-0" style={{ color: "var(--t-text-dim)", background: "var(--t-bg-elevated)" }}>
                      {t("shared.vaultPicker.memberBadge")}
                    </span>
                  )}
                  {writable && role && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full shrink-0" style={{ color: "var(--t-text-dim)", background: "var(--t-bg-elevated)" }}>
                      {role}
                    </span>
                  )}
                  {selected && (
                    <span className="[&_path]:stroke-[2.5] shrink-0">
                      <Icon icon="lucide:check" width={14} />
                    </span>
                  )}
                </button>
              );
        })}
      </PickerSurface>
    </>
  );
}
