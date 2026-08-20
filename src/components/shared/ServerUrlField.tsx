import { useState } from "react";
import { useTranslation } from "react-i18next";
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
}: {
  value: string;
  onChange: (value: string) => void;
  inputClassName: string;
}) {
  const { t } = useTranslation();
  const [shown, setShown] = useState(() => !isDefaultServer(value));
  const host = instanceLabel(value);

  return (
    <>
      <button
        type="button"
        onClick={() => setShown((v) => !v)}
        className="text-xs w-full text-left transition-colors text-(--t-text-dim)"
      >
        {shown ? "▾" : "▸"}{" "}
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
