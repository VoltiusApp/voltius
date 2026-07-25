import { useState } from "react";
import { Icon } from "@iconify/react";
import { getAgentDeps } from "../state/agentStore";
import { fieldVisibility } from "../provider/models";
import { ProviderFields, providerFieldsComplete, type ProviderFieldsValue } from "./ProviderFields";
import type { ProviderKind, ProviderProfile } from "../types";

const PROVIDER_LABEL: Record<ProviderKind, string> = {
  anthropic: "Anthropic",
  "openai-compatible": "OpenAI-compatible",
  ollama: "Ollama",
  google: "Google",
};

export function FirstRunCard({ onDone }: { onDone: () => void }) {
  const [fields, setFields] = useState<ProviderFieldsValue>({
    providerKind: "anthropic",
    label: PROVIDER_LABEL.anthropic,
    apiKey: "",
    baseUrl: "",
    model: "",
  });
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);

  // ProviderFields doesn't render a label editor, so keep `label` in sync
  // with the selected provider here (Task 8's editor is where it becomes
  // user-editable).
  const onFieldsChange = (next: ProviderFieldsValue) =>
    setFields(
      next.providerKind === fields.providerKind ? next : { ...next, label: PROVIDER_LABEL[next.providerKind] },
    );

  const draftProfile = (id: string): ProviderProfile => ({
    id,
    providerKind: fields.providerKind,
    label: fields.label,
    baseUrl: fieldVisibility(fields.providerKind).baseUrl ? fields.baseUrl.trim() : undefined,
    model: fields.model.trim(),
  });

  const canStart = providerFieldsComplete(fields);

  const onStart = async () => {
    const deps = getAgentDeps();
    if (!deps || !canStart) return;
    setStarting(true);
    setStartError(null);
    try {
      const profile = draftProfile(crypto.randomUUID());
      await deps.profiles.save(profile);
      if (fields.apiKey.trim()) await deps.profiles.setKey(profile.id, fields.apiKey.trim());
      await deps.profiles.setActive(profile.id);
      onDone();
    } catch (err) {
      setStartError(err instanceof Error ? err.message : String(err));
    } finally {
      setStarting(false);
    }
  };

  return (
    <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 12, overflowY: "auto" }}>
      <div>
        <div style={{ color: "var(--t-text-bright)", fontWeight: 600, fontSize: 13 }}>Set up your AI provider</div>
        <div style={{ color: "var(--t-text-secondary)", fontSize: 12, marginTop: 2 }}>
          Bring your own key. Nothing is sent until you configure a provider here.
        </div>
      </div>

      <ProviderFields idPrefix="fr" value={fields} onChange={onFieldsChange} />

      {startError && <div style={{ color: "var(--t-status-error)", fontSize: 12 }}>{startError}</div>}

      <button
        type="button"
        onClick={() => void onStart()}
        disabled={!canStart || starting}
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 6,
          background: "var(--t-accent)",
          color: "var(--t-on-accent, #fff)",
          border: "none",
          borderRadius: 6,
          padding: "6px 10px",
          fontSize: 13,
          opacity: !canStart || starting ? 0.5 : 1,
        }}
      >
        <Icon icon="lucide:play" width={14} />
        Start
      </button>
    </div>
  );
}
