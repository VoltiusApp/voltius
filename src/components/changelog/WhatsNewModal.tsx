import { useEffect, useState } from "react";
import { Icon } from "@iconify/react";
import { getVersion } from "@tauri-apps/api/app";
import { Modal, ModalCard } from "@/components/shared/Modal";
import { useUIStore } from "@/stores/uiStore";
import {
  getUpdaterState,
  onUpdaterStateChange,
  installUpdate,
  checkForUpdate,
  type UpdaterStatus,
} from "@/services/updater";
import {
  fetchChangelog,
  parseChangelog,
  cmpSemver,
  type ChangelogEntry,
} from "@/services/changelog";

export default function WhatsNewModal() {
  const open = useUIStore((s) => s.whatsNewOpen);
  if (!open) return null;
  return <WhatsNewInner />;
}

function WhatsNewInner() {
  const closeWhatsNew = useUIStore((s) => s.closeWhatsNew);
  const markChangelogSeen = useUIStore((s) => s.markChangelogSeen);

  const [installed, setInstalled] = useState<string | null>(null);
  const [entries, setEntries] = useState<ChangelogEntry[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [updater, setUpdater] = useState<UpdaterStatus>(getUpdaterState);
  const [showOlder, setShowOlder] = useState(false);

  useEffect(() => {
    let alive = true;
    getVersion().then((v) => alive && setInstalled(v)).catch(() => {});
    fetchChangelog()
      .then((raw) => { if (alive) setEntries(raw ? parseChangelog(raw) : null); })
      .finally(() => { if (alive) setLoading(false); });
    const unsub = onUpdaterStateChange(() => setUpdater(getUpdaterState()));
    checkForUpdate().catch(() => {});
    return () => { alive = false; unsub(); };
  }, []);

  function handleClose() {
    if (installed) markChangelogSeen(installed);
    closeWhatsNew();
  }

  const latest = entries?.[0] ?? null;
  const older = entries?.slice(1) ?? [];

  return (
    <Modal onClose={handleClose}>
      <ModalCard
        className="flex flex-col overflow-hidden animate-fadeIn"
        style={{ width: "min(34rem, 92vw)", maxHeight: "min(42rem, 80vh)" }}
      >
        {/* Header */}
        <div className="flex items-center gap-2.5 px-5 py-4 border-b border-(--t-border) shrink-0">
          <Icon icon="lucide:megaphone" width={18} className="text-(--t-accent)" />
          <h2 className="text-sm font-semibold text-(--t-text-primary)">What's new</h2>
          <button
            onClick={handleClose}
            title="Close"
            className="ml-auto flex items-center justify-center w-7 h-7 rounded-lg text-(--t-text-dim) transition-colors hover:bg-(--t-bg-elevated) hover:text-(--t-text-primary)"
          >
            <Icon icon="lucide:x" width={16} />
          </button>
        </div>

        <UpdateBanner state={updater} />

        {/* Body */}
        <div className="overflow-y-auto px-5 py-4 space-y-5">
          {loading && (
            <div className="flex items-center gap-2 text-sm text-(--t-text-dim) py-6 justify-center">
              <Icon icon="lucide:loader-2" width={16} className="animate-spin" />
              Loading changelog…
            </div>
          )}

          {!loading && !entries && (
            <p className="text-sm text-(--t-text-dim) py-6 text-center">
              Changelog unavailable offline. Reconnect to see what's new.
            </p>
          )}

          {!loading && latest && (
            <EntryBlock entry={latest} installed={installed} />
          )}

          {!loading && older.length > 0 && (
            <div className="space-y-5">
              <button
                onClick={() => setShowOlder((v) => !v)}
                className="flex items-center gap-1.5 text-xs font-medium text-(--t-text-dim) transition-colors hover:text-(--t-text-primary)"
              >
                <Icon icon={showOlder ? "lucide:chevron-down" : "lucide:chevron-right"} width={14} />
                {showOlder ? "Hide previous releases" : `Previous releases (${older.length})`}
              </button>
              {showOlder && older.map((e) => (
                <EntryBlock key={e.version} entry={e} installed={installed} />
              ))}
            </div>
          )}
        </div>
      </ModalCard>
    </Modal>
  );
}

function UpdateBanner({ state }: { state: UpdaterStatus }) {
  if (state.status === "downloading") {
    return (
      <div className="px-5 py-3 border-b border-(--t-border) bg-(--t-bg-elevated) shrink-0 space-y-2">
        <div className="flex items-center gap-2 text-sm text-(--t-text-primary)">
          <Icon icon="lucide:download" width={15} className="text-(--t-accent) animate-bounce" />
          Downloading v{state.version}… {state.progress}%
        </div>
        <div className="h-1 rounded-full overflow-hidden bg-(--t-bg-input)">
          <div className="h-full rounded-full transition-all bg-(--t-accent)" style={{ width: `${state.progress}%` }} />
        </div>
      </div>
    );
  }

  if (state.status === "ready") {
    return (
      <div className="flex items-center gap-3 px-5 py-3 border-b border-(--t-border) bg-(--t-bg-elevated) shrink-0">
        <Icon icon="lucide:sparkles" width={15} className="text-(--t-accent) shrink-0" />
        <span className="text-sm text-(--t-text-primary) min-w-0">
          v{state.version} is ready to install
        </span>
        <button
          onClick={() => installUpdate().catch(() => {})}
          className="ml-auto flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-white transition-opacity bg-(--t-accent) shrink-0"
          onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.opacity = "0.85"; }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.opacity = "1"; }}
        >
          <Icon icon="lucide:refresh-cw" width={13} />
          Restart to update
        </button>
      </div>
    );
  }

  if (state.status === "checking") {
    return (
      <div className="flex items-center gap-2 px-5 py-2.5 border-b border-(--t-border) text-xs text-(--t-text-dim) shrink-0">
        <Icon icon="lucide:loader-2" width={13} className="animate-spin" />
        Checking for updates…
      </div>
    );
  }

  return null;
}

function EntryBlock({ entry, installed }: { entry: ChangelogEntry; installed: string | null }) {
  const isNew = installed != null && cmpSemver(entry.version, installed) > 0;
  return (
    <div className="space-y-3">
      <div className="flex items-baseline gap-2">
        <h3 className="text-sm font-semibold text-(--t-text-primary)">v{entry.version}</h3>
        {isNew && (
          <span
            className="px-1.5 py-0.5 rounded text-[0.65rem] font-bold uppercase tracking-wide"
            style={{
              color: "var(--t-accent)",
              background: "color-mix(in srgb, var(--t-accent) 15%, transparent)",
            }}
          >
            New
          </span>
        )}
        <span className="text-xs text-(--t-text-dim) ml-auto">{entry.date}</span>
      </div>
      {entry.groups.map((g) => (
        <div key={g.label} className="space-y-1.5">
          <span
            className="inline-block px-1.5 py-0.5 rounded text-[0.65rem] font-bold uppercase tracking-wide"
            style={groupChipStyle(g.label)}
          >
            {g.label}
          </span>
          <ul className="space-y-1 pl-1">
            {g.items.map((item, i) => (
              <li key={i} className="flex gap-2 text-[0.8rem] text-(--t-text-secondary) leading-snug">
                <span className="text-(--t-text-dim) shrink-0">•</span>
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

function groupChipStyle(label: string): React.CSSProperties {
  const l = label.toLowerCase();
  let color = "var(--t-text-dim)";
  if (l === "added") color = "var(--t-status-connected)";
  else if (l === "fixed") color = "var(--t-accent)";
  else if (l === "security" || l === "removed") color = "var(--t-status-error)";
  return { color, background: `color-mix(in srgb, ${color} 14%, transparent)` };
}
