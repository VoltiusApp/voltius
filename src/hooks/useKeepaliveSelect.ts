import { useTranslation } from "react-i18next";
import { useRangeSelect } from "@/components/shared/ManagedNote";
import { usePolicyLock } from "@/stores/policyStore";
import { KEEPALIVE_PRESETS, type KeepalivePreset } from "@/utils/keepalive";

const KEY = "appSettings.keepalivePreset";
const PRESETS = Object.keys(KEEPALIVE_PRESETS) as KeepalivePreset[];

export function useKeepaliveSelect() {
  const { t } = useTranslation();
  const label = (p: KeepalivePreset) => t(KEEPALIVE_PRESETS[p].labelKey);
  const select = useRangeSelect(KEY, PRESETS, label);
  const locked = usePolicyLock(KEY).locked;
  const hostValue = (v: KeepalivePreset | "") => (locked || (v && !select.allows(v)) ? "" : v);
  return { ...select, label, locked, hostValue };
}
