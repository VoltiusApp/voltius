import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";

export function useReadOnlyFlips(sftpId: string | null, apply: (readOnly: boolean) => void) {
  useEffect(() => {
    if (!sftpId) return;
    const unlisten = listen<{ readOnly: boolean }>(`sftp-readonly-${sftpId}`, ({ payload }) => apply(payload.readOnly));
    return () => { void unlisten.then((fn) => fn()); };
  }, [sftpId, apply]);
}

export function readOnlyTip(t: TFunction, readOnly: boolean | undefined, name: string | null | undefined): string | undefined {
  return readOnly ? t("fileTransfer.myDevices.readOnlyShare", { name }) : undefined;
}

export function useReadOnlyTip(readOnly: boolean | undefined, name: string | null | undefined): string | undefined {
  const { t } = useTranslation();
  return readOnlyTip(t, readOnly, name);
}

export function refuseReadOnly(tip: string | undefined): boolean {
  if (tip) alert(tip);
  return !!tip;
}
