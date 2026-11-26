import { useState } from "react";
import { Icon } from "@iconify/react";
import { useTranslation } from "react-i18next";
import type { MeResponse } from "@/services/account";
import { claimHandle, HandleClaimError } from "@/services/teamService";
import { useCopyHandle } from "@/hooks/useCopyHandle";
import { FormButtons, SETTINGS_SURFACE, SettingsInput } from "./shared";

/** Each claim refusal needs its own next step; 403 is the only one the user can fix themselves. */
function handleClaimMessage(e: unknown, t: (key: string) => string): string {
  if (!(e instanceof HandleClaimError)) return e instanceof Error ? e.message : String(e);
  const key =
    e.status === 403 ? "settings.account.handle.errorEmailNotVerified" :
    e.status === 409 ? "settings.account.handle.errorTaken" :
    e.status === 422 ? "settings.account.handle.errorInvalid" :
    e.status === 429 ? "settings.account.handle.errorCooldown" :
    "settings.account.handle.errorGeneric";
  return t(key);
}

/** The signed-in user's handle with copy and claim; `me` is null until /auth/me answers. */
export function HandleCard({ me, touch }: { me: MeResponse | null; touch?: boolean }) {
  const { t } = useTranslation();
  const [claimed, setClaimed] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [input, setInput] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const handle = claimed ?? me?.handle ?? null;
  const isCustom = claimed !== null || !!me?.handle_is_custom;
  const managed = !!me?.handle_managed;
  const verified = !!me?.email_verified;
  const { copied, copy } = useCopyHandle(handle);
  const small = touch ? "text-sm px-3 py-2" : "text-xs px-2.5 py-1";

  const start = () => {
    setInput(isCustom ? (handle ?? "") : "");
    setError("");
    setEditing(true);
  };

  const submit = async () => {
    const value = input.trim();
    if (!value) return setError(t("settings.account.handle.errorInvalid"));
    setSaving(true);
    setError("");
    try {
      await claimHandle(value);
      setClaimed(value);
      setEditing(false);
    } catch (e) {
      setError(handleClaimMessage(e, t));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div data-settings-card data-handle-card className={`${SETTINGS_SURFACE} px-4 py-3 space-y-2`}>
      <div className="flex items-center justify-between gap-2">
        <span className="min-w-0 truncate text-sm font-medium text-(--t-text-primary)">{handle ? `@${handle}` : "—"}</span>
        <button
          type="button"
          onClick={copy}
          disabled={!handle}
          className={`${small} shrink-0 rounded-md flex items-center gap-1 text-(--t-text-dim) hover:text-(--t-text-primary) transition-colors disabled:opacity-50`}
        >
          <Icon icon={copied ? "lucide:check" : "lucide:copy"} width={touch ? 14 : 12} />
          {copied ? t("settings.account.handle.copied") : t("settings.account.handle.copy")}
        </button>
      </div>

      {!me ? null : editing ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
          className="space-y-2"
        >
          <SettingsInput
            placeholder={t("settings.account.handle.placeholder")}
            value={input}
            onChange={setInput}
            autoFocus
            aria-label={t("settings.account.handle.inputLabel")}
          />
          {error && <p className="text-xs text-(--t-status-error)">{error}</p>}
          <FormButtons onCancel={() => setEditing(false)} submitLabel={t("settings.account.handle.save")} submitting={saving} />
        </form>
      ) : (
        <div>
          <button
            type="button"
            disabled={!verified || managed}
            onClick={start}
            className={`${small} rounded-md font-medium bg-(--t-accent) text-(--t-on-accent) hover:opacity-85 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:opacity-50`}
          >
            {isCustom ? t("settings.account.handle.change") : t("settings.account.handle.choose")}
          </button>
          {managed ? (
            <p className="text-xs mt-1.5 text-(--t-text-dim)">{t("settings.account.handle.managed")}</p>
          ) : (
            <>
              <p className="text-xs mt-1.5 text-(--t-text-dim)">{t("settings.account.handle.chooseSub")}</p>
              <p className="text-xs mt-0.5 text-(--t-text-muted)">{t("settings.account.handle.generatedNote")}</p>
            </>
          )}
          {!verified && !managed && <p className="text-xs mt-1.5 text-(--t-status-error)">{t("settings.account.handle.unverified")}</p>}
        </div>
      )}
    </div>
  );
}
