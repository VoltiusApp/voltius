import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { Modal, ModalCard } from "@/components/shared/Modal";
import { ErrorMsg, Input, SubmitBtn } from "@/components/layout/authParts";

/** `onSubmit` resolves to null when done, or to the error to show. */
export function BindPasswordDialog({ title, body, onSubmit, onClose }: {
  title: string;
  body: string;
  onSubmit: (password: string) => Promise<string | null>;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError((await onSubmit(password)) ?? "");
    setLoading(false);
  };

  return (
    <Modal onClose={onClose}>
      <ModalCard className="w-80 p-5">
        <p className="text-sm font-medium mb-1 text-(--t-text-primary)">{title}</p>
        <p className="text-xs mb-4 text-(--t-text-dim)">{body}</p>
        <form onSubmit={submit} className="space-y-2">
          <Input type="password" placeholder={t("layout.auth.masterPasswordPlaceholder")} value={password}
            onChange={setPassword} autoFocus />
          <ErrorMsg msg={error} />
          <SubmitBtn loading={loading} label={t("settings.account.sessionSecurity.systemAuth.confirm")} />
        </form>
      </ModalCard>
    </Modal>
  );
}
