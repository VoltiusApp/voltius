import { useTranslation } from "react-i18next";
import { useState } from "react";
import { Icon } from "@iconify/react";
import { ConfirmModal } from "@/components/shared/ConfirmModal";
import { useAgentStore } from "../state/agentStore";
import type { AllowlistEntry } from "../state/allowlist";
import { scopeLabelText } from "../state/connectionLabels";
import { useConnectionLabels } from "../ui/useConnectionLabels";

/**
 * Allowlist-management block of the settings page: every remembered
 * always-allow grant, grouped by scope, with a per-row revoke and a confirmed
 * revoke-all. Reads `allowlist` straight from `useAgentStore` (no local
 * copy, no refresh hook) so a grant made from an approval card while Settings
 * is open shows up here without any extra wiring.
 */
export function AllowlistBlock() {
  const { t } = useTranslation();
  const allowlist = useAgentStore((s) => s.allowlist);
  const revokeAllowlist = useAgentStore((s) => s.revokeAllowlist);
  const revokeAllAllowlist = useAgentStore((s) => s.revokeAllAllowlist);
  const labelFor = useConnectionLabels();
  const [confirmingRevokeAll, setConfirmingRevokeAll] = useState(false);

  const groups = new Map<string, AllowlistEntry[]>();
  for (const entry of allowlist) {
    const bucket = groups.get(entry.scope);
    if (bucket) bucket.push(entry);
    else groups.set(entry.scope, [entry]);
  }

  return (
    <div>
      <h3 className="text-xs font-bold uppercase tracking-widest mb-4 text-(--t-text-dim)">
        {t("aiAgent.settings.allowlist.heading")}
      </h3>

      {allowlist.length === 0 ? (
        <p className="text-sm mb-3 text-(--t-text-dim)">{t("aiAgent.settings.allowlist.empty")}</p>
      ) : (
        <div className="flex flex-col gap-3">
          {[...groups.entries()].map(([scope, entries]) => {
            const label = labelFor(scope);
            return (
            <details
              key={scope}
              open
              className="rounded-xl bg-(--t-bg-card) border border-(--t-border) p-4"
            >
              <summary className="cursor-pointer text-sm font-medium text-(--t-text-primary) flex items-center gap-2">
                <span>{scopeLabelText(label, t)}</span>
                {label.detail && (
                  <span className="text-xs text-(--t-text-dim) truncate">{label.detail}</span>
                )}
                <span className="text-xs text-(--t-text-dim)">({entries.length})</span>
              </summary>
              <ul className="mt-3 flex flex-col gap-2">
                {entries.map((entry) => (
                  <li
                    key={`${entry.tool}:${entry.grain}:${entry.key}`}
                    className="flex items-center justify-between gap-4"
                  >
                    {entry.grain === "exact" ? (
                      <code className="text-xs text-(--t-text-secondary) truncate">{entry.key}</code>
                    ) : (
                      <span className="text-sm text-(--t-text-secondary) truncate">{entry.tool}</span>
                    )}
                    <button
                      type="button"
                      onClick={() => revokeAllowlist(entry)}
                      className="btn btn-secondary px-2 py-1 rounded-md text-xs shrink-0"
                    >
                      {t("aiAgent.settings.allowlist.revoke")}
                    </button>
                  </li>
                ))}
              </ul>
            </details>
          );})}
        </div>
      )}

      {allowlist.length > 0 && (
        <button
          type="button"
          onClick={() => setConfirmingRevokeAll(true)}
          className="btn btn-secondary mt-3 inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm"
        >
          <Icon icon="lucide:trash-2" width={13} />
          {t("aiAgent.settings.allowlist.revokeAll")}
        </button>
      )}

      {confirmingRevokeAll && (
        <ConfirmModal
          title={t("aiAgent.settings.allowlist.revokeAllConfirm.title")}
          message={t("aiAgent.settings.allowlist.revokeAllConfirm.message")}
          confirmLabel={t("aiAgent.settings.allowlist.revokeAllConfirm.confirm")}
          onConfirm={() => {
            revokeAllAllowlist();
            setConfirmingRevokeAll(false);
          }}
          onCancel={() => setConfirmingRevokeAll(false)}
        />
      )}
    </div>
  );
}
