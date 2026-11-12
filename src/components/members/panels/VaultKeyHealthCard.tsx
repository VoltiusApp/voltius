import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Icon } from "@iconify/react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { ConfirmModal } from "@/components/shared/ConfirmModal";
import { StatusDot } from "@/components/shared/StatusDot";
import { SETTINGS_SURFACE } from "@/components/settings/sections/shared";
import { usePermissions } from "@/hooks/usePermission";
import { runTeamAction } from "@/services/teamActionFeedback";
import {
  checkAndRotateTeamKey, getLastRotationPass, subscribeRotationPasses, type RotationPass,
} from "@/services/teamKeyRotation";
import { deleteTeamObject, deleteTeamSecret, listTeamObjects } from "@/services/teamObjects";
import { decodeTeamObject } from "@/services/teamObjectRows";
import { getRotationStatus, getStaleItems, type RotationStatus, type StaleItem, type StaleItems } from "@/services/teamService";
import {
  isRemovable, itemKey, oldEpochTotal, passFailed, stuckReason, vaultKeyHealth, type VaultKeyHealthState,
} from "@/services/vaultKeyHealth";
import { formatRelative } from "@/utils/localeFormat";
import type { StatusTone } from "@/utils/statusTone";

const BTN = "btn btn-secondary inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium";
const P = "members.keyHealth";

const TONE: Record<VaultKeyHealthState, StatusTone> = {
  upToDate: "connected",
  rotationPending: "connecting",
  reencryptPending: "connecting",
  attention: "error",
  unavailable: "idle",
};

type Label = { name?: string; unreadable: boolean };

async function readLabels(teamId: string, items: StaleItem[]): Promise<Map<string, Label>> {
  const ids = new Set(items.flatMap((i) => (i.object_id && !i.orphan ? [i.object_id] : [])));
  if (ids.size === 0) return new Map();
  const rows = (await listTeamObjects(teamId)).filter((o) => ids.has(o.object_id));
  return new Map(await Promise.all(rows.map(async (row): Promise<[string, Label]> => {
    try {
      const o = (await decodeTeamObject(teamId, row)) as { name?: string; label?: string };
      return [row.object_id, { name: o.name || o.label || row.name, unreadable: false }];
    } catch {
      return [row.object_id, { name: row.name, unreadable: true }];
    }
  })));
}

function itemTitle(item: StaleItem, labels: Map<string, Label>, t: TFunction): string {
  if (item.kind === "blob") return t(`${P}.kind.blob`);
  const type = item.object_type ? t(`${P}.type.${item.object_type}`, { defaultValue: item.object_type }) : "";
  const name = (item.object_id && labels.get(item.object_id)?.name) || t(`${P}.unnamed`, { type });
  return item.kind === "secret" ? t(`${P}.kind.secret`, { name: item.orphan ? t(`${P}.kind.deleted`) : name }) : name;
}

function deviceLine(pass: RotationPass | undefined, t: TFunction): string {
  if (!pass) return t(`${P}.device.never`);
  const time = formatRelative(pass.at);
  if (pass.error) return t(`${P}.device.stopped`, { time, reason: t(`${P}.step.${pass.error}`) });
  if (pass.failures.length > 0) return t(`${P}.device.failed`, { time, count: pass.failures.length });
  return t(`${P}.device.finished`, { time });
}

export function VaultKeyHealthCard({ teamId }: { teamId: string }) {
  const { t } = useTranslation();
  const can = usePermissions();
  const pass = useSyncExternalStore(subscribeRotationPasses, () => getLastRotationPass(teamId));
  const [status, setStatus] = useState<RotationStatus | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [stuck, setStuck] = useState<StaleItems | null>(null);
  const [labels, setLabels] = useState<Map<string, Label>>(new Map());
  const [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState<StaleItem | null>(null);
  const seq = useRef(0);

  const reload = useCallback(async () => {
    const mine = ++seq.current;
    try {
      const next = await getRotationStatus(teamId);
      if (mine !== seq.current) return;
      setStatus(next);
      setLoadFailed(false);
      const items = next.draining ? await getStaleItems(teamId).catch(() => null) : null;
      const names = items ? await readLabels(teamId, items.items).catch(() => new Map<string, Label>()) : new Map<string, Label>();
      if (mine !== seq.current) return;
      setStuck(items);
      setLabels(names);
    } catch {
      if (mine === seq.current) setLoadFailed(true);
    }
  }, [teamId]);

  useEffect(() => { void reload(); }, [reload, pass]);

  const retry = async () => {
    setBusy(true);
    try {
      await checkAndRotateTeamKey(teamId);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (item: StaleItem) => {
    setBusy(true);
    try {
      await runTeamAction({
        pending: t(`${P}.removing`),
        success: t(`${P}.removed`),
        run: () => (item.kind === "secret" ? deleteTeamSecret(teamId, item.secret_id!) : deleteTeamObject(teamId, item.object_id!)),
      });
      setRemoving(null);
    } catch {
      // runTeamAction already reported the failure.
    } finally {
      setBusy(false);
    }
    await reload();
  };

  const state = loadFailed ? "unavailable" : status ? vaultKeyHealth(status, pass, Date.now()) : null;
  const canRotate = can("VIEW_SECRETS", teamId) && can("COPY_SECRETS", teamId);
  const retryDenied = status?.stale && !status.draining && !canRotate;
  const remaining = status && oldEpochTotal(status);

  return (
    <div data-vault-key-health={state ?? "loading"} className="space-y-3 pb-4 border-b border-(--t-border)">
      <div className="flex items-center gap-1.5">
        <Icon icon="lucide:key-round" width={14} className="shrink-0 text-(--t-text-dim)" />
        <p className="text-sm font-medium text-(--t-text-primary)">{t(`${P}.title`)}</p>
        {state && (
          <span className="ml-auto inline-flex items-center gap-1.5 text-xs text-(--t-text-secondary)">
            <StatusDot tone={TONE[state]} size="sm" />
            {t(`${P}.state.${state}`)}
          </span>
        )}
      </div>

      {loadFailed && <p className="text-xs text-(--t-text-dim)">{t(`${P}.loadFailed`)}</p>}

      {status && !loadFailed && (
        <div className="space-y-1 text-xs">
          {status.epoch !== undefined && (
            <p className="text-(--t-text-primary)">
              {status.rotated_at
                ? t(`${P}.version`, { version: status.epoch, time: formatRelative(status.rotated_at) })
                : t(`${P}.versionNever`, { version: status.epoch })}
            </p>
          )}
          {!!status.uncovered_members && <p className="text-(--t-text-secondary)">{t(`${P}.uncovered`, { count: status.uncovered_members })}</p>}
          {status.rotation_requested_at && (
            <p className="text-(--t-text-secondary)">{t(`${P}.requested`, { time: formatRelative(status.rotation_requested_at) })}</p>
          )}
          {status.draining && (
            <p className="text-(--t-text-secondary)">
              {remaining ? t(`${P}.remaining`, { count: remaining }) : t(`${P}.remainingUnknown`)} {t(`${P}.blocked`)}
            </p>
          )}
          <p className="text-(--t-text-dim)">{t(`${P}.fromServer`)}</p>
        </div>
      )}

      <p className={`text-xs ${passFailed(pass) ? "text-(--t-status-warning)" : "text-(--t-text-dim)"}`}>
        {deviceLine(pass, t)}
        {!!pass?.skipped && ` ${t(`${P}.device.skipped`, { count: pass.skipped })}`}
      </p>

      {stuck && stuck.items.length + stuck.hidden > 0 && (
        <div className="space-y-1.5">
          <p className="text-xs text-(--t-text-dim)">{t(`${P}.stuck.title`)}</p>
          <ul className={`${SETTINGS_SURFACE} divide-y divide-(--t-border) max-h-[40vh] overflow-y-auto`}>
            {stuck.items.map((item) => {
              const reason = stuckReason(item, pass, item.kind === "object" && !!item.object_id && !!labels.get(item.object_id)?.unreadable);
              return (
                <li key={itemKey(item)} className="flex items-center gap-2 px-3 py-2 text-xs">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-(--t-text-primary)">{itemTitle(item, labels, t)}</p>
                    <p className={reason === "undecryptable" || reason === "uploadFailed" ? "text-(--t-status-warning)" : "text-(--t-text-dim)"}>
                      {t(`${P}.reason.${reason}`)}
                      {item.object_id && !item.orphan && !labels.get(item.object_id)?.name && (
                        <span className="ml-1.5 font-mono text-[11px] text-(--t-text-dim)">{item.object_id.slice(0, 8)}</span>
                      )}
                    </p>
                  </div>
                  {isRemovable(item, reason) && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => setRemoving(item)}
                      className="shrink-0 px-2 py-1 text-(--t-status-error) disabled:opacity-40"
                    >
                      {t(`${P}.remove`)}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
          {stuck.truncated && <p className="text-xs text-(--t-text-dim)">{t(`${P}.stuck.truncated`, { count: stuck.items.length })}</p>}
          {stuck.hidden > 0 && <p className="text-xs text-(--t-text-dim)">{t(`${P}.stuck.hidden`, { count: stuck.hidden })}</p>}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className={BTN}
          disabled={busy || !status || state === "upToDate" || retryDenied}
          title={retryDenied ? t(`${P}.retryDenied`) : undefined}
          onClick={() => void retry()}
        >
          <Icon icon={busy ? "lucide:loader-circle" : "lucide:rotate-cw"} width={13} className={busy ? "animate-spin" : ""} />
          {busy ? t(`${P}.retrying`) : t(`${P}.retry`)}
        </button>
        <button type="button" className={BTN} disabled={busy} onClick={() => void reload()}>
          <Icon icon="lucide:refresh-cw" width={13} />
          {t(`${P}.refresh`)}
        </button>
      </div>
      {retryDenied && <p className="text-xs text-(--t-text-dim)">{t(`${P}.retryDenied`)}</p>}

      <p className="text-xs text-(--t-text-muted)">{t(`${P}.note`)}</p>

      {removing && (
        <ConfirmModal
          title={t(`${P}.removeTitle`, { name: itemTitle(removing, labels, t) })}
          message={t(removing.orphan ? `${P}.removeOrphanBody` : `${P}.removeBody`)}
          confirmLabel={t(`${P}.remove`)}
          busy={busy}
          busyLabel={t(`${P}.removing`)}
          onConfirm={() => void remove(removing)}
          onCancel={() => setRemoving(null)}
        />
      )}
    </div>
  );
}
