import type { TFunction } from "i18next";
import { formatRelative } from "@/utils/localeFormat";

export const statusLine = (t: TFunction, lastRead: number | undefined, managed: number, skipped: number) =>
  t("settings.hosts.sshConfig.status.line", {
    when: lastRead === undefined ? t("settings.hosts.sshConfig.status.never") : formatRelative(lastRead),
    managed,
    skipped,
  });
