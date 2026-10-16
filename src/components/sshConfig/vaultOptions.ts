import { useTranslation } from "react-i18next";
import { PERSONAL_VAULT, personalVaults } from "@/services/vaultLookup";
import { useVaultStore } from "@/stores/vaultStore";

export function usePersonalVaultOptions(current: string | undefined): { value: string; label: string }[] {
  const { t } = useTranslation();
  const vaults = useVaultStore((s) => s.vaults);
  const options = personalVaults(vaults).map((v) => ({ value: v.id, label: v.id === PERSONAL_VAULT.id ? t("settings.hosts.sshConfig.vault.personal") : v.name }));
  if (current && !options.some((o) => o.value === current)) options.push({ value: current, label: current });
  return options;
}
