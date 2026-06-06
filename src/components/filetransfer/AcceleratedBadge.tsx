import { Icon } from "@iconify/react";
import { open as openUrl } from "@tauri-apps/plugin-shell";
import { InfoTooltip } from "@/components/shared/InfoTooltip";

const BLOG_URL = "https://voltius.app/blog/sftp-tar-acceleration";

/** Zap badge shown on tar-accelerated transfers, with a hover card explaining it. */
export function AcceleratedBadge() {
  return (
    <InfoTooltip icon="lucide:zap" iconColor="var(--t-accent)" width={11} placement="top" interactive>
      <div className="flex items-center gap-1.5 mb-1 font-medium text-[var(--t-text-primary)]">
        <Icon icon="lucide:zap" width={12} style={{ color: "var(--t-accent)" }} />
        Tar acceleration
      </div>
      <p className="m-0">Bundled into one archive and extracted on the other side — far fewer round trips than file-by-file.</p>
      <button
        type="button"
        onClick={() => void openUrl(BLOG_URL)}
        className="mt-1.5 inline-flex items-center gap-1 text-[var(--t-accent)] hover:underline"
      >
        How it works
        <Icon icon="lucide:arrow-up-right" width={12} />
      </button>
    </InfoTooltip>
  );
}
