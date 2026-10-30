import { useCallback, useEffect, useRef } from "react";
import { Icon } from "@iconify/react";
import { useTranslation } from "react-i18next";
import { Modal, ModalCard } from "@/components/shared/Modal";
import { useDeviceFilesStore, type FileAnswer } from "@/stores/deviceFilesStore";
import { answerFileRequest } from "@/services/deviceFiles";
import { routeLabel } from "@/services/myDevices";
import { APP_SOURCE, useNotificationStore } from "@/stores/notificationStore";
import { logFailure } from "@/lib/logger";
import { DEVICE_TILE_BASE, deviceIcon } from "@/utils/icons";

const folderName = (path: string) => path.split(/[\\/]/).filter(Boolean).pop() ?? path;

function useSessionToasts() {
  const { t } = useTranslation();
  const sessions = useDeviceFilesStore((s) => s.sessions);
  const seen = useRef<Set<string> | null>(null);
  useEffect(() => {
    const keys = new Set(sessions.map((s) => `${s.deviceKey}|${s.since}`));
    if (seen.current) {
      for (const s of sessions) {
        if (seen.current.has(`${s.deviceKey}|${s.since}`)) continue;
        useNotificationStore.getState().addToast({
          source: APP_SOURCE,
          type: "toast",
          message: t("layout.deviceFiles.sessionToast", { name: s.deviceName }),
          severity: "info",
          duration: 5000,
        });
      }
    }
    seen.current = keys;
  }, [sessions, t]);
}

export function FileAccessRequestModal() {
  const { t } = useTranslation();
  const prompt = useDeviceFilesStore((s) => s.pending[0]);
  const config = useDeviceFilesStore((s) => s.config);
  const answered = useRef<string | null>(null);
  useSessionToasts();

  const answer = useCallback((requestId: string, choice: FileAnswer) => {
    if (answered.current === requestId) return;
    answered.current = requestId;
    answerFileRequest(requestId, choice).catch((e) => {
      if (answered.current === requestId) answered.current = null;
      logFailure("answer file access request")(e);
    });
  }, []);

  if (!prompt) return null;
  const { requestId } = prompt;
  const folders = config?.folders.map(folderName).join(", ");
  return (
    <Modal onClose={() => answer(requestId, "deny")}>
      <ModalCard className="p-5 flex flex-col gap-3.5 w-[min(26.25rem,calc(100vw-2rem))]">
        <div className="flex items-center gap-3">
          <span
            className="w-9 h-9 rounded-[10px] flex items-center justify-center shrink-0 text-(--t-text-bright)"
            style={{ background: DEVICE_TILE_BASE }}
          >
            <Icon icon={deviceIcon(prompt.platform)} width={18} />
          </span>
          <div className="flex flex-col gap-0.5 min-w-0">
            <h2 className="text-[0.9375rem] font-semibold text-(--t-text-bright)">
              {t("layout.deviceFiles.title", { name: prompt.deviceName })}
            </h2>
            <span className="text-xs text-(--t-text-muted)">
              {t("layout.deviceFiles.subtitle", { route: routeLabel(t, prompt.route) })}
              {prompt.newDevice && (
                <span className="ml-2 px-1.5 py-0.5 rounded text-[0.6875rem] text-(--t-accent) bg-(--t-bg-hover)">
                  {t("layout.deviceFiles.newDevice")}
                </span>
              )}
            </span>
          </div>
        </div>
        {config && config.folders.length > 0 && (
          <p className="text-sm leading-normal text-(--t-text-secondary)">
            {t("layout.deviceFiles.folders", { folders })}{" "}
            {t(config.readOnly ? "layout.deviceFiles.readOnly" : "layout.deviceFiles.readWrite")}
          </p>
        )}
        <div className="flex justify-end gap-2 mt-1">
          <button onClick={() => answer(requestId, "deny")} className="btn btn-ghost px-3 py-2 rounded-lg text-sm">
            {t("layout.deviceFiles.deny")}
          </button>
          <button onClick={() => answer(requestId, "once")} className="btn btn-secondary px-3 py-2 rounded-lg text-sm">
            {t("layout.deviceFiles.once")}
          </button>
          <button onClick={() => answer(requestId, "always")} className="btn btn-primary px-3 py-2 rounded-lg text-sm font-medium">
            {t("layout.deviceFiles.always")}
          </button>
        </div>
      </ModalCard>
    </Modal>
  );
}
