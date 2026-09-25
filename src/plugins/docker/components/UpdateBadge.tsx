import { Icon } from "@iconify/react";
import { useDockerT } from "../runtime";
import type { ImageUpdateStatus } from "../types";

/** Compact image-update indicator shared across the Images/Containers/Stacks views. */
export function UpdateBadge({
  status,
  checking,
}: {
  status: ImageUpdateStatus | undefined;
  checking: boolean;
}) {
  const t = useDockerT();
  if (checking) {
    return (
      <Icon
        icon="lucide:loader-circle"
        width={10}
        className="shrink-0 animate-spin text-(--t-text-muted)"
      />
    );
  }
  if (!status) return null;
  if (status.status === "outdated") {
    return (
      <span
        title={t("updateAvailable")}
        className="shrink-0 inline-flex items-center gap-0.5 rounded-sm px-1 text-[9px] font-medium bg-[color-mix(in_srgb,var(--t-status-warning)_16%,transparent)] text-(--t-status-warning)"
      >
        {t("update")}
      </span>
    );
  }
  if (status.status === "current") {
    return (
      <span title={t("upToDate")} className="shrink-0 inline-flex">
        <Icon icon="lucide:check" width={11} className="text-(--t-status-connected)" />
      </span>
    );
  }
  // unknown — couldn't resolve the registry digest
  return (
    <span
      title={status.error ? t("updateCheckFailed", { error: status.error }) : t("updateStatusUnknown")}
      className="shrink-0 inline-flex"
    >
      <Icon icon="lucide:circle-question-mark" width={10} className="text-(--t-text-dim)" />
    </span>
  );
}
