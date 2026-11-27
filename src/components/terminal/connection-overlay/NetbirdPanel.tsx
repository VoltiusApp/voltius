import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { NetbirdProfile } from "@/types";

const initial: NetbirdProfile = {
  issuer: "",
  clientId: "",
  fingerprint: "",
  scope: "openid profile email",
  audience: "",
  tokenType: "access_token",
};
const fields = ["issuer", "clientId", "fingerprint", "scope", "audience"] as const;

function readProfile(key?: string): NetbirdProfile {
  try {
    const saved = key && JSON.parse(localStorage.getItem(key) ?? "null");
    if (saved && fields.every((field) => typeof saved[field] === "string")
      && (saved.tokenType === "id_token" || saved.tokenType === "access_token")) {
      const { issuer, clientId, fingerprint, scope, audience, tokenType } = saved;
      return { issuer, clientId, fingerprint, scope, audience, tokenType };
    }
  } catch { /* Storage is optional. */ }
  return initial;
}

export function NetbirdSetup({ connectionId, onSubmit }: {
  connectionId?: string; onSubmit: (profile: NetbirdProfile) => void;
}) {
  const { t } = useTranslation();
  const key = connectionId && `netbird-ssh:${connectionId}`;
  const [profile, setProfile] = useState(() => readProfile(key));
  return (
    <form className="w-full max-h-[60dvh] overflow-y-auto space-y-3 text-left" onSubmit={(e) => {
      e.preventDefault();
      const settings = { ...profile };
      for (const field of fields) settings[field] = settings[field].trim();
      // Only public configuration is remembered. Tokens and device codes stay in Rust.
      try { if (key) localStorage.setItem(key, JSON.stringify(settings)); } catch { /* optional */ }
      onSubmit(settings);
    }}>
      <p className="text-sm">{t("terminal.overlay.netbird.setup")}</p>
      {fields.map((field) => (
        <label key={field} className="block text-xs text-text-secondary">
          {t(`terminal.overlay.netbird.${field}`)}
          <input className="input w-full mt-1" value={profile[field]} autoCapitalize="none" spellCheck={false}
            type={field === "issuer" ? "url" : "text"} required={field !== "audience" && field !== "scope"}
            pattern={field === "issuer" ? String.raw`https:\/\/[^@\/?#\s]+(\/[^?#\s]*)?`
              : field === "fingerprint" ? String.raw`SHA256:[A-Za-z0-9+\/]{43}` : undefined}
            onChange={(e) => setProfile({ ...profile, [field]: e.target.value.trimStart() })} />
        </label>
      ))}
      <label className="block text-xs text-text-secondary">
        {t("terminal.overlay.netbird.tokenType")}
        <select className="input w-full mt-1" value={profile.tokenType}
          onChange={(e) => setProfile({ ...profile, tokenType: e.target.value as NetbirdProfile["tokenType"] })}>
          <option value="access_token">access_token</option>
          <option value="id_token">id_token</option>
        </select>
      </label>
      <button type="submit" className="btn btn-primary w-full">{t("terminal.overlay.netbird.signIn")}</button>
    </form>
  );
}
