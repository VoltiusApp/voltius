import { useState } from "react";
import { useTranslation } from "react-i18next";
import { DisclosureToggle, ErrorMsg, INPUT_CLASS, Input, SubmitBtn } from "@/components/layout/authParts";
import { parseEnrollInput } from "@/services/deepLinkUrl";
import type { EnrollmentTokenParts } from "@/services/enrollment/enrollmentToken";

export function EnrollTokenEntry({ onToken }: { onToken: (token: EnrollmentTokenParts) => void }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [error, setError] = useState("");

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const token = parseEnrollInput(text);
    if (token) onToken(token);
    else setError(t("layout.enroll.tokenEntry.invalid"));
  };

  return (
    <div className="mt-3">
      <DisclosureToggle open={open} onToggle={() => setOpen((v) => !v)} label={t("layout.enroll.tokenEntry.toggle")} />
      {open && (
        <form onSubmit={submit} className="mt-2 w-full space-y-2">
          <Input type="text" placeholder={t("layout.enroll.tokenEntry.placeholder")} value={text} autoFocus
            invalid={!!error} onChange={(v) => { setText(v); setError(""); }} className={`${INPUT_CLASS} font-mono`} />
          <ErrorMsg msg={error} />
          <SubmitBtn loading={false} disabled={!text.trim()} label={t("layout.enroll.continue")} />
        </form>
      )}
    </div>
  );
}
