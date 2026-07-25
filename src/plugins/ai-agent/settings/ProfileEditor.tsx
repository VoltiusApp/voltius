import { useEffect, useState } from "react";
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

function urlOrigin(url: string): string | null {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

/**
 * Both sides must parse to count as "different": a partial/unparseable value
 * (the user mid-typing) never forces a re-entry, but once a value *does*
 * parse to an origin distinct from what was saved, it is one — an
 * unparseable value is never treated as "same origin" either.
 */
function destinationOriginChanged(savedBaseUrl: string | undefined, typedBaseUrl: string): boolean {
  const saved = urlOrigin(savedBaseUrl ?? "");
  const typed = urlOrigin(typedBaseUrl);
  return saved !== null && typed !== null && saved !== typed;
}

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
  // Whether a key actually exists for `profile.id`, as a fact from the
  // keychain rather than an assumption — see ProfilesStore.hasKey. Defaults
  // closed (false) until the check resolves, so an unresolved fetch never
  // renders a false "•••• set".
  const [hasKeyFact, setHasKeyFact] = useState(false);

  useEffect(() => {
    if (!profile) {
      setHasKeyFact(false);
      return;
    }
    let cancelled = false;
    const deps = getAgentDeps();
    if (deps) {
      void deps.profiles
        .hasKey(profile.id)
        .then((v) => {
          if (cancelled) return;
          setHasKeyFact(v);
          // hasKeyFact starts false, so the real key input can render while
          // this probe is in flight. If it resolves true after the user
          // typed a key, the masked badge is about to replace that input —
          // clear the typed value in the same tick so it can never sit in
          // state past the point Save would silently stop writing it (see M-fix2).
          if (v) setFields((f) => ({ ...f, apiKey: "" }));
        })
        .catch(() => {
          if (!cancelled) setHasKeyFact(false);
        });
    }
    return () => {
      cancelled = true;
    };
  }, [profile?.id]);

  const hasStoredKey = profile !== null && !replacingKey && hasKeyFact;
  const canSave = providerFieldsComplete(fields, hasStoredKey);

  // A key never carries across a provider switch, or across a change to the
  // actual request destination: the stored key belongs to the
  // provider+baseUrl the profile was saved under, and reusing it (or
  // offering it as "already set") against a different provider or a
  // different origin would leak it — see I2. Forcing Replace mode clears the
  // masked badge and requires a fresh key (or a deliberate blank, for a
  // provider where it's optional). The origin check is gated on the baseUrl
  // field actually having changed this call, so it only fires on the
  // transition — not on every subsequent keystroke in an unrelated field
  // while the destination remains diverged from what's saved.
  const onFieldsChange = (next: ProviderFieldsValue) => {
    const providerChanged = next.providerKind !== fields.providerKind;
    const baseUrlChanged = next.baseUrl !== fields.baseUrl;
    const destinationChanged =
      profile !== null && baseUrlChanged && destinationOriginChanged(profile.baseUrl, next.baseUrl);
    const forceReplace = providerChanged || destinationChanged;
    if (forceReplace) setReplacingKey(true);
    const withKeyCleared = forceReplace ? { ...next, apiKey: "" } : next;
    setFields(
      !labelEdited && providerChanged
        ? { ...withKeyCleared, label: PROVIDER_LABEL[next.providerKind] }
        : withKeyCleared,
    );
  };

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
      // Write whenever the input holding a real key is the one on screen —
      // the same fact `hasStoredKey` gates the input's visibility with, so
      // the two can never diverge and silently drop a typed key (see I1).
      // This one condition covers create, Replace, a provider/destination
      // switch, and an existing profile with no key on disk.
      const willWriteKey = !hasStoredKey && fields.apiKey.trim().length > 0;
      const destinationChanged =
        profile !== null &&
        (profile.providerKind !== fields.providerKind || destinationOriginChanged(profile.baseUrl, fields.baseUrl));
      if (destinationChanged) {
        // The old key belongs to the previous provider/endpoint and must
        // never be reachable against the new one. Delete it *before*
        // persisting the new destination, so a failed setKey afterward
        // can't leave the profile pointing at the new destination while the
        // stale key is still sitting under this id (see M2).
        await deps.profiles.deleteKey(saved.id);
        await deps.profiles.save(saved);
        if (willWriteKey) await deps.profiles.setKey(saved.id, fields.apiKey.trim());
      } else {
        await deps.profiles.save(saved);
        if (willWriteKey) await deps.profiles.setKey(saved.id, fields.apiKey.trim());
      }
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
        // Only offered while `hasStoredKey` holds — i.e. never after a
        // provider switch forced Replace mode, since the stored key belongs
        // to the *previous* provider (see I2) and must not authenticate a
        // request to the new one either. Read for use in the request only,
        // never rendered or put into field state.
        getApiKey={
          hasStoredKey && profile
            ? async () => {
                const d = getAgentDeps();
                return d ? ((await d.profiles.getKey(profile.id)) ?? undefined) : undefined;
              }
            : undefined
        }
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
