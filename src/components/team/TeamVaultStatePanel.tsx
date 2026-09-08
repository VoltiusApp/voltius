/**
 * The panel a shell shows in place of a team vault's pages when the vault
 * cannot show its contents (issue #70). Shared by MainPanel and MobileShell so
 * the copy, the statuses and the recovery actions exist once.
 */

import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Icon } from "@iconify/react";
import { useTeamStore } from "@/stores/teamStore";
import { useUIStore } from "@/stores/uiStore";
import { fetchTeamData } from "@/services/teamVaultSync";
import { ownerHandle } from "@/services/teamVaultFirstAccess";

export default function TeamVaultStatePanel({
  status,
  teamId,
}: {
  status: string;
  teamId: string;
}) {
  const { t } = useTranslation();
  const team = useTeamStore((s) => s.teams.find((t) => t.id === teamId));
  const rolesByTeam = useTeamStore((s) => s.rolesByTeam);
  const members = useTeamStore((s) => s.membersByTeam[teamId]);
  const loadMembers = useTeamStore((s) => s.loadMembers);
  const myRoleIds = team?.role_ids ?? [];
  const teamRoles = rolesByTeam[teamId] ?? [];
  const isOwner = myRoleIds.some((rid) => {
    const r = teamRoles.find((role) => role.id === rid);
    return r?.is_builtin && r.name === "owner";
  });

  // The waiting copy names the owner the user is waiting on, so the roster has
  // to be there — this panel replaces the pages that would otherwise load it.
  useEffect(() => {
    if (status === "awaiting_key" && !members) loadMembers(teamId).catch(() => {});
  }, [status, members, teamId, loadMembers]);

  // Generic until the handle resolves: a name flashing in from blank reads worse
  // than the sentence that never had one.
  const owner = ownerHandle(team, members);

  const configs: Record<string, { icon: string; title: string; body: string }> = {
    offline: {
      icon: "lucide:cloud-off",
      title: t("layout.mainPanel.teamVault.offlineTitle"),
      body: t("layout.mainPanel.teamVault.offlineBody"),
    },
    forbidden: {
      icon: "lucide:shield-off",
      title: t("layout.mainPanel.teamVault.forbiddenTitle"),
      body: t("layout.mainPanel.teamVault.forbiddenBody"),
    },
    // Member has joined the team but no vault owner has distributed a key yet
    // (issue #41). Distinct from a hard error — a key-holder self-heals this on
    // their next sync, so present it as a benign waiting state, not a failure.
    awaiting_key: {
      icon: "lucide:clock",
      title: t("layout.mainPanel.teamVault.waitingForAccessTitle"),
      body: owner
        ? t("layout.mainPanel.teamVault.waitingForAccessBodyNamed", { owner: `@${owner}` })
        : t("layout.mainPanel.teamVault.waitingForAccessBody"),
    },
    payment_required: {
      icon: "lucide:credit-card",
      title: t("layout.mainPanel.teamVault.paymentRequiredTitle"),
      body: isOwner
        ? t("layout.mainPanel.teamVault.paymentRequiredBodyOwner")
        : t("layout.mainPanel.teamVault.paymentRequiredBodyMember"),
    },
    // No Try again: it repeats the same failing unwrap. Only a password sign-in
    // recovers the secrets (#228).
    key_mismatch: {
      icon: "lucide:key-round",
      title: t("layout.mainPanel.teamVault.keyMismatchTitle"),
      body: t("layout.mainPanel.teamVault.keyMismatchBody"),
    },
    error: {
      icon: "lucide:triangle-alert",
      title: t("layout.mainPanel.teamVault.errorTitle"),
      body: t("layout.mainPanel.teamVault.errorBody"),
    },
  };

  const cfg = configs[status] ?? configs.error;

  const openBilling = () => {
    useUIStore.getState().openSettings("account");
  };

  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-4 bg-(--t-bg-base)">
      <div
        className="flex items-center justify-center rounded-3xl w-[5.333rem] h-[5.333rem] text-(--t-text-dim)"
        style={{
          background: "linear-gradient(135deg, var(--t-bg-elevated) 0%, var(--t-bg-card) 100%)",
          border: "1px solid var(--t-border)",
        }}
      >
        <Icon icon={cfg.icon} width={36} />
      </div>
      <div className="flex flex-col items-center gap-1.5 text-center max-w-xs">
        <span className="text-base font-semibold text-(--t-text-primary)">{cfg.title}</span>
        <span className="text-sm text-(--t-text-dim)">{cfg.body}</span>
        {status === "payment_required" && isOwner && (
          <button
            onClick={openBilling}
            className="mt-2 text-sm px-3 py-1.5 rounded-lg"
            style={{ background: "var(--t-accent)", color: "#fff" }}
          >
            {t("layout.mainPanel.manageSubscription")}
          </button>
        )}
        {(!status || status === "error" || status === "awaiting_key") && (
          <button
            onClick={() => fetchTeamData(teamId).catch(() => {})}
            className="mt-2 text-sm px-3 py-1.5 rounded-lg"
            style={{ background: "var(--t-bg-elevated)", color: "var(--t-text-primary)", border: "1px solid var(--t-border)" }}
          >
            {t("layout.mainPanel.tryAgain")}
          </button>
        )}
      </div>
    </div>
  );
}
