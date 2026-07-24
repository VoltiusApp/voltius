import { useState, type CSSProperties } from "react";
import { Icon } from "@iconify/react";
import { _getDeps } from "../state/agentStore";
import { fieldVisibility, loadModels } from "../provider/models";
import type { ProviderKind, ProviderProfile } from "../types";

const PROVIDER_LABEL: Record<ProviderKind, string> = {
  anthropic: "Anthropic",
  "openai-compatible": "OpenAI-compatible",
  ollama: "Ollama",
  google: "Google",
};

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

export function FirstRunCard({ onDone }: { onDone: () => void }) {
  const [providerKind, setProviderKind] = useState<ProviderKind>("anthropic");
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [model, setModel] = useState("");
  const [modelOptions, setModelOptions] = useState<string[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);
  const [testError, setTestError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);

  const visibility = fieldVisibility(providerKind);

  const onProviderChange = (kind: ProviderKind) => {
    setProviderKind(kind);
    setModelOptions([]);
    setTestError(null);
  };

  const draftProfile = (id: string): ProviderProfile => ({
    id,
    providerKind,
    label: PROVIDER_LABEL[providerKind],
    baseUrl: visibility.baseUrl ? baseUrl.trim() : undefined,
    model: model.trim(),
  });

  const onLoadModels = async () => {
    const deps = _getDeps();
    if (!deps) return;
    setLoadingModels(true);
    setTestError(null);
    try {
      const res = await loadModels(deps.api, draftProfile("draft"), apiKey.trim() || undefined);
      setModelOptions(res.models);
      if (res.error) setTestError(res.error);
      else if (res.models.length && !model) setModel(res.models[0]);
    } finally {
      setLoadingModels(false);
    }
  };

  const canStart =
    model.trim().length > 0 &&
    (!visibility.apiKeyRequired || apiKey.trim().length > 0) &&
    (!visibility.baseUrl || baseUrl.trim().length > 0);

  const onStart = async () => {
    const deps = _getDeps();
    if (!deps || !canStart) return;
    setStarting(true);
    setStartError(null);
    try {
      const profile = draftProfile(crypto.randomUUID());
      await deps.profiles.save(profile);
      if (apiKey.trim()) await deps.profiles.setKey(profile.id, apiKey.trim());
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

      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <label htmlFor="fr-provider" style={labelStyle}>Provider</label>
        <select
          id="fr-provider"
          value={providerKind}
          onChange={(e) => onProviderChange(e.target.value as ProviderKind)}
          style={inputStyle}
        >
          <option value="anthropic">Anthropic</option>
          <option value="openai-compatible">OpenAI-compatible</option>
          <option value="ollama">Ollama</option>
          <option value="google">Google</option>
        </select>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <label htmlFor="fr-apikey" style={labelStyle}>
          API key{visibility.apiKeyRequired ? "" : " (optional)"}
        </label>
        <input
          id="fr-apikey"
          type="password"
          autoComplete="off"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder={visibility.apiKeyRequired ? "sk-…" : "leave blank if unused"}
          style={inputStyle}
        />
      </div>

      {visibility.baseUrl && (
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <label htmlFor="fr-baseurl" style={labelStyle}>Base URL</label>
          <input
            id="fr-baseurl"
            type="text"
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder={BASE_URL_PLACEHOLDER[providerKind]}
            style={inputStyle}
          />
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <label htmlFor="fr-model" style={labelStyle}>Model</label>
        <div style={{ display: "flex", gap: 6 }}>
          <input
            id="fr-model"
            type="text"
            list="fr-model-options"
            value={model}
            onChange={(e) => setModel(e.target.value)}
            placeholder="model id"
            style={{ ...inputStyle, flex: 1 }}
          />
          <datalist id="fr-model-options">
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
