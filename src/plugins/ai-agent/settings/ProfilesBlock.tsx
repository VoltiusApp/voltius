import { useEffect, useState } from "react";
import { useT } from "../useT";
import { Icon } from "@iconify/react";
import { ConfirmModal } from "@voltius/ui";
import { getAgentDeps, useAgentStore } from "../state/agentStore";
import { ProviderLogo } from "../ui/ProviderLogo";
import { ProfileEditor } from "./ProfileEditor";
import type { ProviderProfile } from "../types";

/**
 * Provider-profiles block of the settings page: list + active-selection radio
 * + inline create/edit/delete, all over the drawer's own `ProfilesStore`
 * (reached via `getAgentDeps()`, never a second store instance). Re-reads on
 * mount and whenever `profilesVersion` bumps, and bumps it itself after every
 * mutation so an already-open drawer picks the change up too.
 */
export function ProfilesBlock() {
  const { t } = useT();
  const [profiles, setProfiles] = useState<ProviderProfile[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | "new" | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const profilesVersion = useAgentStore((s) => s.profilesVersion);

  const refresh = async () => {
    const deps = getAgentDeps();
    if (!deps) return;
    const [list, id] = await Promise.all([deps.profiles.list(), deps.profiles.getActiveId()]);
    setProfiles(list);
    setActiveId(id);
  };

  useEffect(() => {
    void refresh();
  }, [profilesVersion]);

  const onActivate = async (id: string) => {
    const deps = getAgentDeps();
    if (!deps) return;
    setError(null);
    try {
      await deps.profiles.setActive(id);
      setActiveId(id);
      useAgentStore.getState().bumpProfilesVersion();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const onConfirmDelete = async () => {
    const deps = getAgentDeps();
    if (!deps || !deletingId) return;
    setError(null);
    try {
      await deps.profiles.remove(deletingId);
      if (editingId === deletingId) setEditingId(null);
      setDeletingId(null);
      useAgentStore.getState().bumpProfilesVersion();
      await refresh();
    } catch (err) {
      setDeletingId(null);
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const onSaved = () => {
    setEditingId(null);
    void refresh();
  };

  const deletingProfile = profiles.find((p) => p.id === deletingId) ?? null;

  return (
    <div>
      <h3 className="text-xs font-bold uppercase tracking-widest mb-4 text-(--t-text-dim)">
        {t("aiAgent.settings.profiles.heading")}
      </h3>

      {error && <div className="text-xs mb-3 text-(--t-status-error)">{error}</div>}

      {profiles.length === 0 && editingId !== "new" && (
        <p className="text-sm mb-3 text-(--t-text-dim)">{t("aiAgent.settings.profiles.empty")}</p>
      )}

      <div className="flex flex-col gap-3">
        {profiles.map((p) => (
          <div key={p.id}>
            <div className="group rounded-xl bg-(--t-bg-card) border border-(--t-border) p-4 flex items-center justify-between gap-4">
              <label className="flex items-center gap-3 min-w-0 cursor-pointer">
                <input
                  type="radio"
                  name="ai-active-profile"
                  checked={p.id === activeId}
                  onChange={() => void onActivate(p.id)}
                />
                <ProviderLogo kind={p.providerKind} />
                <span className="text-sm text-(--t-text-primary) truncate">{p.label}</span>
                <span className="text-xs text-(--t-text-dim) truncate">{p.model}</span>
              </label>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => setEditingId(editingId === p.id ? null : p.id)}
                  className="btn btn-secondary px-2 py-1 rounded-md text-xs"
                >
                  {t("aiAgent.settings.profiles.edit")}
                </button>
                <button
                  type="button"
                  onClick={() => setDeletingId(p.id)}
                  className="btn btn-secondary px-2 py-1 rounded-md text-xs"
                >
                  {t("aiAgent.settings.profiles.delete")}
                </button>
              </div>
            </div>
            {editingId === p.id && (
              <div className="mt-2">
                <ProfileEditor profile={p} onSaved={onSaved} onCancel={() => setEditingId(null)} />
              </div>
            )}
          </div>
        ))}
      </div>

      <button
        type="button"
        onClick={() => setEditingId("new")}
        className="btn btn-secondary mt-3 inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm"
      >
        <Icon icon="lucide:plus" width={13} />
        {t("aiAgent.settings.profiles.add")}
      </button>

      {editingId === "new" && (
        <div className="mt-2">
          <ProfileEditor profile={null} onSaved={onSaved} onCancel={() => setEditingId(null)} />
        </div>
      )}

      {deletingProfile && (
        <ConfirmModal
          title={t("aiAgent.settings.profiles.deleteConfirm.title")}
          message={t("aiAgent.settings.profiles.deleteConfirm.message")}
          confirmLabel={t("aiAgent.settings.profiles.deleteConfirm.confirm")}
          onConfirm={() => void onConfirmDelete()}
          onCancel={() => setDeletingId(null)}
        />
      )}
    </div>
  );
}
