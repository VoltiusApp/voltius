import { Icon } from "@iconify/react";
import { useTranslation } from "react-i18next";
import { statusSurface } from "./statusSurface";
import type { StoredSecretsState } from "@/hooks/useStoredSecrets";
import { useTeamCredentialsUnavailable, useTeamUndecryptableCount, type TeamCredentialsReason } from "@/hooks/useBlockedTeamVault";

/** One warning row: an icon and a sentence on the shared warning surface. */
export function WarningNote({ icon, text, className }: { icon: string; text: string; className?: string }) {
  return (
    <div
      role="status"
      className={`flex items-start gap-2 px-3 py-2 rounded-lg text-xs ${className ?? ""}`}
      style={statusSurface("warning")}
    >
      <Icon icon={icon} width={14} className="mt-0.5 shrink-0" />
      <span>{text}</span>
    </div>
  );
}

/**
 * Shown on an editor whose stored secrets could not be read. Without it the
 * fields render empty, which is indistinguishable from a credential that was
 * never saved — and typing a guess into one replaces the real secret.
 */
export function VaultUnavailableNote({ className }: { className?: string }) {
  const { t } = useTranslation();
  return <WarningNote icon="lucide:shield-alert" text={t("shared.vaultUnavailable.note")} className={className} />;
}

/** A forbidden result explains itself: the editor hides its secret fields. */
export function StoredSecretsNote({ state, className }: {
  state: StoredSecretsState;
  className?: string;
}) {
  if (state !== "unavailable") return null;
  return <VaultUnavailableNote className={className} />;
}

/**
 * Shown on a team vault whose stored credentials never reached the local
 * keychain. The hosts render normally — their metadata is plaintext on the
 * server — so without this the first sign of trouble is an authentication
 * failure at connect time (issue #190).
 */
export function TeamCredentialsNote({ reason, className }: { reason: TeamCredentialsReason; className?: string }) {
  const { t } = useTranslation();
  const lapsed = reason === "plan_lapsed";
  return (
    <WarningNote
      icon={lapsed ? "lucide:lock" : "lucide:key-round"}
      text={t(lapsed ? "layout.mainPanel.teamVault.planLapsedBody" : "shared.teamCredentials.unavailable")}
      className={className}
    />
  );
}

/** The warnings a team vault shows above its list when it loaded only part of what it holds. */
export function TeamVaultNotes({ className, secrets = true }: { className?: string; secrets?: boolean }) {
  const { t } = useTranslation();
  const unavailable = useTeamCredentialsUnavailable();
  const credentials = secrets ? unavailable : null;
  const undecryptable = useTeamUndecryptableCount();
  if (!credentials && undecryptable === 0) return null;
  return (
    <div className={`flex flex-col gap-2 ${className ?? ""}`}>
      {undecryptable > 0 && (
        <WarningNote icon="lucide:file-lock" text={t("shared.teamVaultUndecryptable", { count: undecryptable })} />
      )}
      {credentials && <TeamCredentialsNote reason={credentials} />}
    </div>
  );
}
