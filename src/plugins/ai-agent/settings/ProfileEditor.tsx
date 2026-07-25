import { useState } from "react";
import { useTranslation } from "react-i18next";
import { getAgentDeps, useAgentStore } from "../state/agentStore";
import { ProviderFields, providerFieldsComplete, type ProviderFieldsValue } from "../ui/ProviderFields";
import type { ProviderKind, ProviderProfile } from "../types";

const PROVIDER_LABEL: Record<ProviderKind, string> = {
  anthropic: "Anthropic",
  "openai-compatible": "OpenAI-compatible",
  ollama: "Ollama",
  google: "Google",
};

/**
 * Inline create/edit form for one provider profile. `profile === null` means
 * create. Unlike FirstRunCard, this editor exposes its own Name field:
 * `labelEdited` tracks whether the user has typed into it directly, and the
 * default (provider-derived) label only keeps re-deriving on a provider
 * change while it's still false — once edited, the user's name sticks. It
 * starts true when editing an existing profile: a saved name is a fact the
 * user chose, and a provider switch must never silently overwrite it.
 */
export function ProfileEditor({
  profile, onSaved, onCancel,
}: { profile: ProviderProfile | null; onSaved: () => void; onCancel: () => void }) {
  const { t } = useTranslation();
  const [fields, setFields] = useState<ProviderFieldsValue>({
    providerKind: profile?.providerKind ?? "anthropic",
    label: profile?.label ?? PROVIDER_LABEL.anthropic,
    apiKey: "",
    baseUrl: profile?.baseUrl ?? "",
    model: profile?.model ?? "",
  });
  const [labelEdited, setLabelEdited] = useState(profile !== null);
  // An existing profile has a key on disk we never read back; until Replace is
  // clicked there is nothing to write, so save must not clear it.
  const [replacingKey, setReplacingKey] = useState(profile === null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const hasStoredKey = profile !== null && !replacingKey;
  const canSave = providerFieldsComplete(fields, hasStoredKey);

  const onFieldsChange = (next: ProviderFieldsValue) =>
    setFields(
      !labelEdited && next.providerKind !== fields.providerKind
        ? { ...next, label: PROVIDER_LABEL[next.providerKind] }
        : next,
    );

  const onLabelChange = (value: string) => {
    setLabelEdited(true);
    setFields({ ...fields, label: value });
  };

  const onSave = async () => {
    const deps = getAgentDeps();
    if (!deps || !canSave) return;
    setSaving(true);
    setError(null);
    try {
      const saved: ProviderProfile = {
        id: profile?.id ?? crypto.randomUUID(),
        providerKind: fields.providerKind,
        label: fields.label.trim() || fields.providerKind,
        baseUrl: fields.baseUrl.trim() || undefined,
        model: fields.model.trim(),
      };
      await deps.profiles.save(saved);
      if (replacingKey && fields.apiKey.trim()) await deps.profiles.setKey(saved.id, fields.apiKey.trim());
      useAgentStore.getState().bumpProfilesVersion();
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-3 p-4 rounded-xl bg-(--t-bg-elevated) border border-(--t-border)">
      <div className="flex flex-col gap-1">
        <label htmlFor="edit-label" className="text-xs text-(--t-text-dim)">
          {t("aiAgent.settings.profiles.name")}
        </label>
        <input
          id="edit-label"
          value={fields.label}
          onChange={(e) => onLabelChange(e.target.value)}
          className="form-input w-full px-3 py-2 rounded-lg text-sm bg-(--t-bg-input) border border-(--t-border) text-(--t-text-primary)"
        />
      </div>
      <ProviderFields
        idPrefix="edit"
        value={fields}
        onChange={onFieldsChange}
        hasStoredKey={hasStoredKey}
        onReplaceKey={() => setReplacingKey(true)}
      />
      {error && <div className="text-xs text-(--t-status-error)">{error}</div>}
      <div className="flex gap-2 justify-end">
        <button type="button" onClick={onCancel} className="btn btn-secondary px-3 py-1.5 rounded-lg text-sm">
          {t("aiAgent.settings.profiles.cancel")}
        </button>
        <button
          type="button"
          onClick={() => void onSave()}
          disabled={!canSave || saving}
          className="btn btn-primary px-3 py-1.5 rounded-lg text-sm font-medium disabled:opacity-50"
        >
          {t("aiAgent.settings.profiles.save")}
        </button>
      </div>
    </div>
  );
}
