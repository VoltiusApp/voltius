import { useState } from "react";
import { Icon } from "@iconify/react";
import { useTranslation } from "react-i18next";
import { Toggle } from "@/components/shared/Toggle";
import { useNotificationStore } from "@/stores/notificationStore";
import { setVerboseLogging, createBugReport } from "@/services/diagnostics";
import { getLoggerVerbose } from "@/lib/logger";

type ReportState = "idle" | "working" | "done";

export default function DiagnosticsSection() {
  const { t } = useTranslation();
  const [verbose, setVerbose] = useState(() => getLoggerVerbose());
  const [reportState, setReportState] = useState<ReportState>("idle");
  const [showIncluded, setShowIncluded] = useState(false);
  const addToast = useNotificationStore((s) => s.addToast);

  const toggleVerbose = async (v: boolean) => {
    setVerbose(v);
    try {
      await setVerboseLogging(v);
    } catch {
      setVerbose(!v);
    }
  };

  const onCreate = async () => {
    setReportState("working");
    try {
      const path = await createBugReport();
      const name = path.split(/[\\/]/).pop() ?? "report.zip";
      setReportState("done");
      addToast({
        pluginId: "core", pluginName: "Voltius", type: "toast",
        message: t("settings.diagnostics.toastSaved", { name }),
        severity: "success", duration: 4000,
      });
      setTimeout(() => setReportState("idle"), 3000);
    } catch (e) {
      setReportState("idle");
      addToast({
        pluginId: "core", pluginName: "Voltius", type: "toast",
        message: t("settings.diagnostics.toastError", { reason: String(e) }),
        severity: "error", duration: 6000,
      });
    }
  };

  const buttonLabel =
    reportState === "working" ? t("settings.diagnostics.creatingButton")
    : reportState === "done" ? t("settings.diagnostics.createdButton")
    : t("settings.diagnostics.createButton");

  return (
    <div className="p-6 max-w-lg space-y-6">
      <p className="text-sm text-(--t-text-dim)">{t("settings.diagnostics.intro")}</p>

      {/* Troubleshooting */}
      <div>
        <h3 className="text-xs font-bold uppercase tracking-widest mb-3 text-(--t-text-dim)">
          {t("settings.diagnostics.troubleshootingTitle")}
        </h3>
        <div className="rounded-lg px-4 py-3 space-y-3 bg-(--t-bg-elevated) border border-(--t-border)">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm text-(--t-text-primary)">{t("settings.diagnostics.verboseLabel")}</p>
              <p className="text-xs mt-0.5 text-(--t-text-dim)">{t("settings.diagnostics.verboseSub")}</p>
            </div>
            <Toggle checked={verbose} onChange={(v) => void toggleVerbose(v)} />
          </div>
          {verbose && (
            <div
              className="rounded-md px-3 py-2 text-xs whitespace-pre-line text-(--t-text-primary)"
              style={{
                background: "color-mix(in srgb, var(--t-accent) 12%, transparent)",
                border: "1px solid color-mix(in srgb, var(--t-accent) 30%, transparent)",
              }}
            >
              {t("settings.diagnostics.verboseHint")}
            </div>
          )}
        </div>
      </div>

      {/* Bug report */}
      <div>
        <h3 className="text-xs font-bold uppercase tracking-widest mb-3 text-(--t-text-dim)">
          {t("settings.diagnostics.reportTitle")}
        </h3>
        <div className="rounded-lg px-4 py-3 space-y-3 bg-(--t-bg-elevated) border border-(--t-border)">
          <button
            type="button"
            onClick={() => void onCreate()}
            disabled={reportState === "working"}
            className="w-full flex items-center justify-center gap-2 rounded-md px-4 py-2 text-sm font-medium bg-(--t-accent) text-white disabled:opacity-60"
          >
            <Icon
              icon={reportState === "working" ? "lucide:loader-circle" : reportState === "done" ? "lucide:check" : "lucide:bug"}
              width={15}
              className={reportState === "working" ? "animate-spin" : ""}
            />
            {buttonLabel}
          </button>
          <p className="text-xs text-(--t-text-dim)">{t("settings.diagnostics.reportSub")}</p>
          <button
            type="button"
            onClick={() => setShowIncluded((s) => !s)}
            className="text-xs text-(--t-accent) hover:underline"
          >
            {t("settings.diagnostics.whatsIncluded")}
          </button>
          {showIncluded && (
            <p className="text-xs whitespace-pre-line text-(--t-text-dim)">
              {t("settings.diagnostics.includedBody")}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
