import { useState, useSyncExternalStore } from "react";
import { Icon } from "@iconify/react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { ConfirmModal } from "@/components/shared/ConfirmModal";
import { StatusDot } from "@/components/shared/StatusDot";
import { appToast } from "@/services/appToast";
import { isFailing, remoteSourceName, remoteSources, type RemoteSource, type RemoteSourceState } from "@/services/remoteSources";
import { removeRemoteSource, retryRemoteSources } from "@/services/sync";
import { useCrossDeviceSessionsStore } from "@/stores/crossDeviceSessionsStore";
import { useLanSyncStore } from "@/stores/lanSyncStore";
import { DEVICE_TILE_BASE, deviceIcon } from "@/utils/icons";
import { compareStrings, formatRelative } from "@/utils/localeFormat";
import { STATUS_TONE_COLOR, type StatusTone } from "@/utils/statusTone";
import { SETTINGS_ROW_BUTTON, SettingsGroup } from "./shared";

const P = "settings.sync.devices";

const TONE: Record<RemoteSourceState, StatusTone> = {
  synced: "connected",
  pending: "idle",
  unavailable: "warning",
  undecryptable: "error",
  unreadable: "error",
};
const RANK: Record<RemoteSourceState, number> = { undecryptable: 0, unreadable: 0, unavailable: 1, pending: 2, synced: 3 };

interface DeviceRow extends RemoteSource {
  name: string;
  platform: string;
}

function useDeviceRows(): DeviceRow[] {
  const { t } = useTranslation();
  const sources = useSyncExternalStore(remoteSources.subscribe, remoteSources.list);
  const manifests = useCrossDeviceSessionsStore((s) => s.manifests);
  const known = useLanSyncStore((s) => s.known);
  return sources
    .map((s) => ({
      ...s,
      name: remoteSourceName(s.deviceId, manifests, known) ?? t(`${P}.unnamed`, { id: s.deviceId.slice(0, 8) }),
      platform: known[s.deviceId]?.platform ?? "",
    }))
    .sort((a, b) => RANK[a.state] - RANK[b.state] || compareStrings(a.name, b.name));
}

function stateLine(t: TFunction, row: DeviceRow): string {
  if (row.state === "unavailable" && row.httpStatus) return t(`${P}.state.unavailableStatus`, { status: row.httpStatus });
  return t(`${P}.state.${row.state}`);
}

function timesLine(t: TFunction, row: DeviceRow): string {
  const changed = t(`${P}.changed`, { time: formatRelative(row.remoteUpdatedAt) });
  if (row.state === "synced") return changed;
  const read = row.syncedAt ? t(`${P}.lastSynced`, { time: formatRelative(row.syncedAt) }) : t(`${P}.neverSynced`);
  return `${changed} · ${read}`;
}

function DeviceSyncRow({ row, busy, onRetry, onRemove }: { row: DeviceRow; busy: boolean; onRetry: () => void; onRemove: () => void }) {
  const { t } = useTranslation();
  const failing = isFailing(row);
  return (
    <div data-sync-device={row.deviceId} data-state={row.state} className="flex flex-wrap items-center gap-3 px-4 py-3">
      <div className="relative shrink-0 w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: DEVICE_TILE_BASE }}>
        <Icon icon={deviceIcon(row.platform)} width={16} className="text-(--t-text-primary)" />
        <StatusDot tone={TONE[row.state]} size="md" corner halo="var(--t-bg-elevated)" label={stateLine(t, row)} />
      </div>
      <div className="min-w-60 flex-1">
        <p className="text-sm font-medium truncate text-(--t-text-primary)">{row.name}</p>
        <p className="text-xs mt-0.5 break-words" style={{ color: failing ? STATUS_TONE_COLOR[TONE[row.state]] : "var(--t-text-dim)" }}>
          {stateLine(t, row)}
        </p>
        {failing && <p className="text-xs mt-0.5 text-(--t-text-dim)">{t(`${P}.hint.${row.state}`)}</p>}
        <p className="text-[11px] mt-0.5 text-(--t-text-muted)">{timesLine(t, row)}</p>
      </div>
      <div className="flex gap-2 ml-auto">
        <button
          data-device-retry
          className={SETTINGS_ROW_BUTTON}
          disabled={busy || !failing}
          title={failing ? undefined : t(`${P}.retryNone`)}
          onClick={onRetry}
        >
          {t(`${P}.retry`)}
        </button>
        <button data-device-remove className={SETTINGS_ROW_BUTTON} disabled={busy} onClick={onRemove}>
          {t(`${P}.remove`)}
        </button>
      </div>
    </div>
  );
}

export function SyncDevicesGroup() {
  const { t } = useTranslation();
  const rows = useDeviceRows();
  const [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState<DeviceRow | null>(null);

  const run = (work: () => Promise<void>, onError?: (e: unknown) => void) => {
    setBusy(true);
    work().catch(onError ?? (() => {})).finally(() => setBusy(false));
  };
  const confirmRemove = (row: DeviceRow) =>
    run(
      async () => {
        await removeRemoteSource(row.deviceId);
        setRemoving(null);
      },
      (e) => {
        setRemoving(null);
        appToast("error", t(`${P}.removeFailed`, { error: e instanceof Error ? e.message : String(e) }));
      },
    );

  return (
    <div data-sync-devices>
      <SettingsGroup title={t(`${P}.title`)} divided>
        {rows.length === 0 ? (
          <p className="px-4 py-3 text-xs text-(--t-text-dim)">{t(`${P}.empty`)}</p>
        ) : (
          rows.map((row) => (
            <DeviceSyncRow
              key={row.deviceId}
              row={row}
              busy={busy}
              onRetry={() => run(() => retryRemoteSources([row.deviceId]))}
              onRemove={() => setRemoving(row)}
            />
          ))
        )}
      </SettingsGroup>
      <p className="text-xs mt-2 px-1 text-(--t-text-muted)">{t(`${P}.footer`)}</p>
      {removing && (
        <ConfirmModal
          title={t(`${P}.removeTitle`, { name: removing.name })}
          message={t(`${P}.removeBody`)}
          confirmLabel={t(`${P}.remove`)}
          busy={busy}
          onConfirm={() => confirmRemove(removing)}
          onCancel={() => setRemoving(null)}
        />
      )}
    </div>
  );
}
