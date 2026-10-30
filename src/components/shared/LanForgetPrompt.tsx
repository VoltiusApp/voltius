import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { LanConfirmPrompt } from "@/components/shared/LanConfirmPrompt";
import type { SyncMenuVariant } from "@/components/shared/SyncSectionParts";
import { forgetDevice, lanScope } from "@/services/lanSync";
import type { DeviceRow } from "@/services/lanSyncDevices";

export function LanForgetPrompt({ row, variant, onDone }: { row: DeviceRow; variant: SyncMenuVariant; onDone: () => void }) {
  const { t } = useTranslation();
  const [group, setGroup] = useState<boolean | null>(null);

  useEffect(() => {
    let alive = true;
    void lanScope()
      .then((scope) => alive && setGroup(!!scope?.members))
      .catch(() => alive && setGroup(false));
    return () => {
      alive = false;
    };
  }, []);

  const name = row.name;
  return (
    <LanConfirmPrompt
      kind="forget"
      variant={variant}
      icon="lucide:trash-2"
      label={t("layout.sync.local.forget.label")}
      failed={t("layout.sync.local.forget.failed", { name })}
      ready={group !== null}
      run={() => forgetDevice(row.deviceId)}
      onDone={onDone}
      onCancel={onDone}
    >
      {group !== null && <p>{t(group ? "layout.sync.local.forget.group" : "layout.sync.local.forget.account", { name })}</p>}
      {row.flag === "keyChanged" && <p className="text-(--t-status-warning)">{t("layout.sync.local.forget.keyChanged")}</p>}
    </LanConfirmPrompt>
  );
}
