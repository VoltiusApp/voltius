import type { TFunction } from "i18next";
import type { QuickConnectInvalidPort, QuickConnectTarget } from "@/services/quickConnect";

export type QuickConnectRowIntent = QuickConnectTarget | QuickConnectInvalidPort;

export function quickConnectLabel(
  intent: QuickConnectRowIntent,
  t: TFunction,
): { title: string; subtitle: string; icon: string; invalid?: true } {
  switch (intent.kind) {
    case "ssh":
      return {
        title: intent.user
          ? t("omni.quickConnect.connectTo", { user: intent.user, host: intent.host })
          : t("omni.quickConnect.connectToHost", { host: intent.host }),
        subtitle: t("omni.quickConnect.portSsh", { port: intent.port }),
        icon: "lucide:arrow-right",
      };
    case "serial":
      return {
        title: t("omni.quickConnect.serialConnection"),
        subtitle: intent.port ?? t("omni.quickConnect.configurePortAndBaud"),
        icon: "lucide:ethernet-port",
      };
    case "local":
      return {
        title: intent.shell ? t("omni.quickConnect.localShellNamed", { shell: intent.shell }) : t("omni.quickConnect.localShell"),
        subtitle: t("omni.quickConnect.openLocalTerminal"),
        icon: "lucide:square-terminal",
      };
    case "invalid-port":
      return {
        title: t("omni.quickConnect.invalidPort"),
        subtitle: t("omni.quickConnect.portRange"),
        icon: "lucide:circle-alert",
        invalid: true,
      };
  }
}
