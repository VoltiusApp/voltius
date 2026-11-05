import { Icon } from "@iconify/react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ManagedNote } from "@/components/shared/ManagedNote";
import { DEFAULT_SERVER_URL, instanceLabel, isDefaultServer } from "@/utils/serverInstance";

/**
 * The server URL disclosure shared by the auth page and the cloud auth modal.
 *
 * It starts open whenever the account is not headed for the official cloud: the
 * field used to reset to api.voltius.app behind a collapsed row, so a
 * self-hosted user adding a second account aimed at the wrong instance without
 * ever seeing which one they were on.
 *
 * `inputClassName` is the only thing the two screens disagree about — their
 * input styling differs — and it is cheaper to pass than to reconcile.
 */
export function ServerUrlField({
  value,
  onChange,
  inputClassName,
  locked = false,
}: {
  value: string;
  onChange: (value: string) => void;
  inputClassName: string;
  locked?: boolean;
}) {
  const { t } = useTranslation();
  const [shown, setShown] = useState(() => !isDefaultServer(value));
  const host = instanceLabel(value);

  if (locked) {
    return (
      <div className="flex flex-col items-start gap-1 min-w-0 text-xs text-(--t-text-dim)">
        <span className="max-w-full truncate" title={value}>
          {host ? t("layout.auth.serverNamed", { host }) : DEFAULT_SERVER_URL}
        </span>
        <ManagedNote />
      </div>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setShown((v) => !v)}
        aria-expanded={shown}
        className="focus-ring flex items-center gap-1 text-xs w-full text-left transition-colors text-(--t-text-dim) hover:text-(--t-text-primary)"
      >
        <Icon icon={shown ? "lucide:chevron-down" : "lucide:chevron-right"} width={12} />
        {host ? t("layout.auth.serverNamed", { host }) : t("layout.auth.customServerUrl")}
      </button>
      {shown && (
        <input
          type="url"
          placeholder={DEFAULT_SERVER_URL}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={inputClassName}
        />
      )}
    </>
  );
}
