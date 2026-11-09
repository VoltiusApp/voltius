import { useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "@iconify/react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { ConfirmModal } from "@/components/shared/ConfirmModal";
import { BusinessLockLine } from "@/components/shared/BusinessLockBanner";
import { SETTINGS_SURFACE } from "@/components/settings/sections/shared";
import { useBusinessLock } from "@/hooks/useBusinessLock";
import { LOCK_TIMEOUT_KEY } from "@/services/lockPolicy";
import { usePeerResolver } from "@/services/peerName";
import { rangeOf, type PolicyRange } from "@/services/policy/range";
import { checkTeamDocText } from "@/services/policy/teamPolicy";
import { saveTextFile } from "@/services/saveFile";
import { pickWithFileInput } from "@/services/systemDialog";
import { runTeamAction } from "@/services/teamActionFeedback";
import {
  deleteTeamPolicy,
  getTeamPolicy,
  PolicyRevisionMismatch,
  putTeamPolicy,
  type StoredTeamPolicy,
  type TeamPolicyDoc,
} from "@/services/teamService";
import type { PolicyIssue } from "@/stores/policyStore";
import { useTeamStore } from "@/stores/teamStore";
import { formatRelative } from "@/utils/localeFormat";

const BTN = "btn btn-secondary inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium";
const FILE_NAME = "policy.json";
const ERROR_KINDS = new Set(["file", "type", "range", "notForTeam", "newerVersion"]);

type Row = { level: "error" | "warning"; key?: string; text: string; detail?: string };
type Preview = { name: string; doc: TeamPolicyDoc | null; rows: Row[] };

function counts(policy: Record<string, unknown>, t: TFunction): string {
  const values = Object.values(policy);
  const limited = values.filter((v) => rangeOf(v)).length;
  const locked = values.length - limited;
  const parts = [locked && t("members.devicePolicy.locked", { count: locked }), limited && t("members.devicePolicy.limited", { count: limited })];
  return parts.filter(Boolean).join(" · ") || t("members.devicePolicy.locked", { count: 0 });
}

function rangeText({ min, max, allowed }: PolicyRange, t: TFunction): string {
  if (allowed) return allowed.map(String).join(", ");
  if (min !== undefined && max !== undefined) return t("members.devicePolicy.rangeBetween", { min, max });
  return max !== undefined ? t("members.devicePolicy.rangeMax", { value: max }) : t("members.devicePolicy.rangeMin", { value: min });
}

function issueRow(issue: PolicyIssue, t: TFunction): Row {
  const p = "members.devicePolicy.issue";
  const level = ERROR_KINDS.has(issue.kind) ? "error" : "warning";
  if (issue.layer === "defaults") return { level: "error", text: t(`${p}.defaults`) };
  const key = issue.key ?? undefined;
  switch (issue.kind) {
    case "notForTeam": return { level, key, text: t(`${p}.machineOnly`) };
    case "unknownKey": return { level, key, text: t(`${p}.unknownKey`) };
    case "newerVersion": return { level, text: t(`${p}.newerVersion`) };
    case "type": case "range": return { level, key, text: t(`${p}.${issue.kind}`), detail: issue.message };
    default: return { level: "error", text: t(`${p}.file`), detail: issue.message };
  }
}

async function readPreview(file: File, t: TFunction): Promise<Preview> {
  const text = await file.text();
  const { doc, issues } = await checkTeamDocText(text);
  const byText = new Map(issues.map((i) => issueRow(i, t)).map((r) => [`${r.key}|${r.text}`, r]));
  const rows = [...byText.values()].sort((a, b) => (a.level === b.level ? 0 : a.level === "error" ? -1 : 1));
  if (rows.some((r) => r.level === "error")) return { name: file.name, doc: null, rows };
  const raw = JSON.parse(text) as { policy?: Record<string, unknown> };
  const policy = raw.policy ?? {};
  const timeout = policy[LOCK_TIMEOUT_KEY];
  if (typeof timeout === "number") {
    const example = JSON.stringify({ $range: { max: timeout } });
    rows.push({ level: "warning", key: LOCK_TIMEOUT_KEY, text: t("members.devicePolicy.issue.plainTimeout", { example }) });
  }
  return { name: file.name, doc: { version: doc.version, policy }, rows };
}

export function DevicePolicyCard({ teamId }: { teamId: string }) {
  const { t } = useTranslation();
  const { locked: lapsed } = useBusinessLock(teamId);
  const teamRevision = useTeamStore((s) => s.teams.find((x) => x.id === teamId)?.policy_revision);
  const peer = usePeerResolver();
  const [stored, setStored] = useState<StoredTeamPolicy | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [toggled, setOpen] = useState<boolean | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [clearing, setClearing] = useState(false);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const seq = useRef(0);
  const loadedRevision = useRef<number | null>(null);

  const reload = useCallback(async () => {
    const mine = ++seq.current;
    try {
      const next = await getTeamPolicy(teamId);
      if (mine !== seq.current) return;
      loadedRevision.current = next.revision;
      setStored(next);
      setLoadFailed(false);
    } catch {
      if (mine === seq.current) setLoadFailed(true);
    }
  }, [teamId]);

  useEffect(() => {
    if (loadedRevision.current !== teamRevision) void reload();
  }, [reload, teamRevision]);

  const change = async (pending: string, success: string, run: () => Promise<void>) => {
    setBusy(true);
    try {
      await runTeamAction({ pending, success, run });
      setPreview(null);
      setClearing(false);
    } catch (e) {
      if (!(e instanceof PolicyRevisionMismatch)) return;
      setPreview(null);
    } finally {
      setBusy(false);
    }
    await Promise.all([reload(), useTeamStore.getState().loadTeams()]);
  };

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    const unreadable: Preview = { name: file.name, doc: null, rows: [{ level: "error", text: t("members.devicePolicy.issue.file") }] };
    setPreview(await readPreview(file, t).catch(() => unreadable));
  };

  if (!stored) {
    return loadFailed ? <p className="text-xs pt-4 border-t border-(--t-border) text-(--t-text-dim)">{t("members.devicePolicy.loadFailed")}</p> : null;
  }
  const doc = stored.policy;
  if (lapsed && !doc) return null;
  const open = toggled ?? !lapsed;
  const entries = Object.entries(doc?.policy ?? {});
  const updated = stored.updated_at && formatRelative(stored.updated_at);

  return (
    <div data-device-policy className="space-y-3 pt-4 border-t border-(--t-border)">
      <div>
        <div className="flex items-center gap-1.5">
          <Icon icon="lucide:building-2" width={14} className="shrink-0 text-(--t-text-dim)" />
          <p className="text-sm font-medium text-(--t-text-primary)">{t("members.devicePolicy.title")}</p>
        </div>
        {doc ? (
          <>
            <p className="text-xs mt-0.5 text-(--t-text-primary)">{counts(doc.policy, t)}</p>
            {updated && (
              <p className="text-xs mt-0.5 text-(--t-text-dim)">
                {stored.updated_by
                  ? t("members.devicePolicy.updatedBy", { name: peer(stored.updated_by, { teamId }).primary, time: updated })
                  : t("members.devicePolicy.updated", { time: updated })}
              </p>
            )}
          </>
        ) : (
          <p className="text-xs mt-0.5 text-(--t-text-dim)">{t("members.devicePolicy.empty")}</p>
        )}
      </div>

      {entries.length > 0 && (
        <div className={`${SETTINGS_SURFACE} overflow-hidden`}>
          <button
            type="button"
            onClick={() => setOpen(!open)}
            aria-expanded={open}
            className="w-full flex items-center gap-1.5 px-3 py-2 text-xs text-(--t-text-secondary)"
          >
            <Icon icon={open ? "lucide:chevron-down" : "lucide:chevron-right"} width={12} className="text-(--t-text-dim)" />
            {open ? t("members.devicePolicy.hide") : t("members.devicePolicy.show", { count: entries.length })}
          </button>
          {open && (
            <ul className="divide-y divide-(--t-border) border-t border-(--t-border)">
              {entries.map(([key, value]) => {
                const range = rangeOf(value);
                return (
                  <li key={key} className="flex flex-wrap items-baseline gap-x-3 px-3 py-1.5 font-mono text-[11px]">
                    <span className="shrink-0 max-w-full break-all text-(--t-text-primary)">
                      <Icon
                        icon={range ? "lucide:sliders-horizontal" : "lucide:lock"}
                        width={11}
                        className="inline align-[-1px] mr-1.5 text-(--t-text-dim)"
                      />
                      {key}
                    </span>
                    <span className="ml-auto max-w-full break-all text-(--t-text-secondary)">
                      {range ? rangeText(range, t) : JSON.stringify(value)}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}

      {doc && <BusinessLockLine teamId={teamId} label={t("members.devicePolicy.lapsed")} />}

      <div className="flex flex-wrap items-center gap-2">
        {!lapsed && (
          <button type="button" className={BTN} disabled={busy} onClick={() => input.current && pickWithFileInput(input.current)}>
            <Icon icon="lucide:upload" width={13} />
            {t("members.devicePolicy.import")}
          </button>
        )}
        {doc && (
          <>
            <button type="button" className={BTN} onClick={() => void saveTextFile(FILE_NAME, `${JSON.stringify(doc, null, 2)}\n`)}>
              <Icon icon="lucide:download" width={13} />
              {t("members.devicePolicy.export")}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => setClearing(true)}
              className="ml-auto text-xs px-2 py-1.5 text-(--t-status-error) disabled:opacity-40"
            >
              {t("members.devicePolicy.clear")}
            </button>
          </>
        )}
        <input
          ref={input}
          type="file"
          accept=".json,application/json"
          className="hidden"
          onChange={(e) => { void onFile(e.target.files?.[0]); e.target.value = ""; }}
        />
      </div>

      {doc && <p className="text-xs text-(--t-text-muted)">{t("members.devicePolicy.olderVersions")}</p>}

      {preview && (
        <ImportPreview
          preview={preview}
          busy={busy}
          onCancel={() => setPreview(null)}
          onSave={(next) =>
            void change(t("members.devicePolicy.saving"), t("members.devicePolicy.saved"), () =>
              putTeamPolicy(teamId, next, stored.revision))}
        />
      )}
      {clearing && (
        <ConfirmModal
          title={t("members.devicePolicy.clearTitle")}
          message={t("members.devicePolicy.clearMessage")}
          confirmLabel={t("members.devicePolicy.clearConfirm")}
          busy={busy}
          onCancel={() => setClearing(false)}
          onConfirm={() =>
            void change(t("members.devicePolicy.clearing"), t("members.devicePolicy.cleared"), () => deleteTeamPolicy(teamId))}
        />
      )}
    </div>
  );
}

function ImportPreview({ preview, busy, onCancel, onSave }: {
  preview: Preview; busy: boolean; onCancel: () => void; onSave: (doc: TeamPolicyDoc) => void;
}) {
  const { t } = useTranslation();
  const { doc, rows } = preview;
  const errors = rows.filter((r) => r.level === "error").length;
  const message = errors
    ? t("members.devicePolicy.fixErrors", { count: errors })
    : rows.length ? t("members.devicePolicy.warningsOnly") : t("members.devicePolicy.replaces");
  return (
    <ConfirmModal
      tone="primary"
      icon="lucide:building-2"
      title={t("members.devicePolicy.previewTitle")}
      subtitle={doc ? `${preview.name} · ${counts(doc.policy, t)}` : preview.name}
      message={message}
      confirmLabel={t("members.devicePolicy.save")}
      busy={busy || !doc}
      onCancel={onCancel}
      onConfirm={() => doc && onSave(doc)}
    >
      {rows.length > 0 && (
        <ul className={`${SETTINGS_SURFACE} divide-y divide-(--t-border) max-h-[40vh] overflow-y-auto`}>
          {rows.map((row) => (
            <li key={`${row.key}|${row.text}`} className="flex items-start gap-2 px-3 py-2 text-xs text-(--t-text-primary)">
              <Icon
                icon={row.level === "error" ? "lucide:circle-x" : "lucide:triangle-alert"}
                width={14}
                className="mt-px shrink-0"
                style={{ color: row.level === "error" ? "var(--t-status-error)" : "var(--t-status-warning)" }}
              />
              <span className="min-w-0 break-words">
                {row.key && <><code className="font-mono break-all">{row.key}</code> </>}
                {row.text}
                {row.detail && <span className="block mt-0.5 font-mono text-[11px] break-all text-(--t-text-dim)">{row.detail}</span>}
              </span>
            </li>
          ))}
        </ul>
      )}
    </ConfirmModal>
  );
}
