import { Icon } from "@iconify/react";
import { useTranslation } from "react-i18next";
import { statusSurface } from "./statusSurface";
import type { StoredSecretsState } from "@/hooks/useStoredSecrets";

/** One warning row: an icon and a sentence on the shared warning surface. */
function WarningNote({ icon, text, className }: { icon: string; text: string; className?: string }) {
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

/**
 * Renders whichever explanation a `useStoredSecrets` result calls for, so the
 * three editors that load stored secrets don't each spell out the same pair.
 */
export function StoredSecretsNote({ state, className }: {
  state: StoredSecretsState;
  className?: string;
}) {
  const { t } = useTranslation();
  if (state === "ok") return null;
  if (state === "unavailable") return <VaultUnavailableNote className={className} />;
  return <WarningNote icon="lucide:eye-off" text={t("shared.storedSecrets.forbidden")} className={className} />;
}

/**
 * Shown on a team vault whose stored credentials never reached the local
 * keychain. The hosts render normally — their metadata is plaintext on the
 * server — so without this the first sign of trouble is an authentication
 * failure at connect time (issue #190).
 */
export function TeamCredentialsNote({ className }: { className?: string }) {
  const { t } = useTranslation();
  return <WarningNote icon="lucide:key-round" text={t("shared.teamCredentials.unavailable")} className={className} />;
}
