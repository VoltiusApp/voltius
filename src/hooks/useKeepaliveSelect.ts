import { useTranslation } from "react-i18next";
import { useRangeSelect } from "@/components/shared/ManagedNote";
import { usePolicyLock } from "@/stores/policyStore";
import { KEEPALIVE_PRESETS, type KeepalivePreset } from "@/utils/keepalive";

const KEY = "appSettings.keepalivePreset";
const PRESETS = Object.keys(KEEPALIVE_PRESETS) as KeepalivePreset[];

export function useKeepaliveSelect() {
  const { t } = useTranslation();
  const label = (p: KeepalivePreset) => t(KEEPALIVE_PRESETS[p].labelKey);
  return { ...useRangeSelect(KEY, PRESETS, label), label, locked: usePolicyLock(KEY).locked };
}
