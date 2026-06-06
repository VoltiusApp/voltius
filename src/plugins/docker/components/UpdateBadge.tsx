import { Icon } from "@iconify/react";
import type { ImageUpdateStatus } from "../types";

/** Compact image-update indicator shared across the Images/Containers/Stacks views. */
export function UpdateBadge({
  status,
  checking,
}: {
  status: ImageUpdateStatus | undefined;
  checking: boolean;
}) {
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
        title="A newer image is available in the registry"
        className="shrink-0 inline-flex items-center gap-0.5 rounded-sm px-1 text-[9px] font-medium bg-[color-mix(in_srgb,var(--t-status-warning)_16%,transparent)] text-(--t-status-warning)"
      >
        update
      </span>
    );
  }
  if (status.status === "current") {
    return (
      <span title="Up to date" className="shrink-0 inline-flex">
        <Icon icon="lucide:check" width={11} className="text-(--t-status-connected)" />
      </span>
    );
  }
  // unknown — couldn't resolve the registry digest
  return (
    <span
      title={status.error ? `Could not check: ${status.error}` : "Update status unknown"}
      className="shrink-0 inline-flex"
    >
      <Icon icon="lucide:help-circle" width={10} className="text-(--t-text-dim)" />
    </span>
  );
}
