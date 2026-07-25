import { useState, type CSSProperties } from "react";
import { Icon } from "@iconify/react";
import { useTranslation } from "react-i18next";
import { getAgentDeps } from "../state/agentStore";
import { fieldVisibility, loadModels } from "../provider/models";
import { ProviderLogo } from "./ProviderLogo";
import type { ProviderKind, ProviderProfile } from "../types";

export interface ProviderFieldsValue {
  providerKind: ProviderKind;
  label: string;
  apiKey: string;
  baseUrl: string;
  model: string;
}

const BASE_URL_PLACEHOLDER: Record<ProviderKind, string> = {
  anthropic: "",
  "openai-compatible": "https://api.example.com",
  ollama: "http://localhost:11434",
  google: "",
};

const inputStyle: CSSProperties = {
  background: "var(--t-bg-input)",
  color: "var(--t-text-bright)",
  border: "1px solid var(--t-border)",
  borderRadius: 6,
  padding: "6px 8px",
  fontSize: 13,
};

const labelStyle: CSSProperties = {
  color: "var(--t-text-secondary)",
  fontSize: 12,
};

/** Shared by both consumers so validation can't drift. */
export function providerFieldsComplete(v: ProviderFieldsValue, hasStoredKey?: boolean): boolean {
  const vis = fieldVisibility(v.providerKind);
  if (v.model.trim().length === 0) return false;
  if (vis.apiKeyRequired && !hasStoredKey && v.apiKey.trim().length === 0) return false;
  if (vis.baseUrl && v.baseUrl.trim().length === 0) return false;
  return true;
}

export function ProviderFields({
  idPrefix,
  value,
  onChange,
  hasStoredKey,
  onReplaceKey,
}: {
  idPrefix: string;
  value: ProviderFieldsValue;
  onChange: (next: ProviderFieldsValue) => void;
  /** Renders `•••• set` + Replace instead of a key input until Replace is clicked. */
  hasStoredKey?: boolean;
  onReplaceKey?: () => void;
}) {
  const { t } = useTranslation();
  const [modelOptions, setModelOptions] = useState<string[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);
  const [testError, setTestError] = useState<string | null>(null);

  const visibility = fieldVisibility(value.providerKind);

  const onProviderChange = (kind: ProviderKind) => {
    setModelOptions([]);
    setTestError(null);
    // Drop a base URL the new provider doesn't accept, so a hidden stale value
    // can't be saved onto the profile.
    onChange({ ...value, providerKind: kind, baseUrl: fieldVisibility(kind).baseUrl ? value.baseUrl : "" });
  };

  const draftProfile = (id: string): ProviderProfile => ({
    id,
    providerKind: value.providerKind,
    label: value.label,
    baseUrl: visibility.baseUrl ? value.baseUrl.trim() : undefined,
    model: value.model.trim(),
  });

  const onLoadModels = async () => {
    const deps = getAgentDeps();
    if (!deps) return;
    setLoadingModels(true);
    setTestError(null);
    try {
      const res = await loadModels(deps.api, draftProfile("draft"), value.apiKey.trim() || undefined);
      setModelOptions(res.models);
      if (res.error) setTestError(res.error);
      else if (res.models.length && !value.model) onChange({ ...value, model: res.models[0] });
    } finally {
      setLoadingModels(false);
    }
  };

  return (
    <>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <label htmlFor={`${idPrefix}-provider`} style={labelStyle}>Provider</label>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <ProviderLogo kind={value.providerKind} size={16} />
          <select
            id={`${idPrefix}-provider`}
            value={value.providerKind}
            onChange={(e) => onProviderChange(e.target.value as ProviderKind)}
            style={{ ...inputStyle, flex: 1 }}
          >
            <option value="anthropic">Anthropic</option>
            <option value="openai-compatible">OpenAI-compatible</option>
            <option value="ollama">Ollama</option>
            <option value="google">Google</option>
          </select>
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <label htmlFor={`${idPrefix}-apikey`} style={labelStyle}>
          API key{visibility.apiKeyRequired ? "" : " (optional)"}
        </label>
        {hasStoredKey ? (
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ color: "var(--t-text-secondary)", fontSize: 12 }}>
              {t("aiAgent.settings.profiles.keySet")}
            </span>
            <button type="button" onClick={onReplaceKey} style={{ color: "var(--t-accent)", fontSize: 12 }}>
              {t("aiAgent.settings.profiles.replaceKey")}
            </button>
          </div>
        ) : (
          <input
            id={`${idPrefix}-apikey`}
            type="password"
            autoComplete="off"
            value={value.apiKey}
            onChange={(e) => onChange({ ...value, apiKey: e.target.value })}
            placeholder={visibility.apiKeyRequired ? "sk-…" : "leave blank if unused"}
            style={inputStyle}
          />
        )}
      </div>

      {visibility.baseUrl && (
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <label htmlFor={`${idPrefix}-baseurl`} style={labelStyle}>Base URL</label>
          <input
            id={`${idPrefix}-baseurl`}
            type="text"
            value={value.baseUrl}
            onChange={(e) => onChange({ ...value, baseUrl: e.target.value })}
            placeholder={BASE_URL_PLACEHOLDER[value.providerKind]}
            style={inputStyle}
          />
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <label htmlFor={`${idPrefix}-model`} style={labelStyle}>Model</label>
        <div style={{ display: "flex", gap: 6 }}>
          <input
            id={`${idPrefix}-model`}
            type="text"
            list={`${idPrefix}-model-options`}
            value={value.model}
            onChange={(e) => onChange({ ...value, model: e.target.value })}
            placeholder="model id"
            style={{ ...inputStyle, flex: 1 }}
          />
          <datalist id={`${idPrefix}-model-options`}>
            {modelOptions.map((m) => (
              <option key={m} value={m} />
            ))}
          </datalist>
          <button
            type="button"
            onClick={() => void onLoadModels()}
            disabled={loadingModels}
            title="Fetch available models (also tests the connection)"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
              background: "transparent",
              color: "var(--t-text-secondary)",
              border: "1px solid var(--t-border)",
              borderRadius: 6,
              padding: "4px 8px",
              fontSize: 12,
              opacity: loadingModels ? 0.6 : 1,
            }}
          >
            <Icon icon="lucide:refresh-cw" width={13} />
            Load models
          </button>
        </div>
        {testError && <div style={{ color: "var(--t-status-error)", fontSize: 11 }}>{testError}</div>}
      </div>
    </>
  );
}
