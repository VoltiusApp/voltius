import type { InputHTMLAttributes } from "react";
import { useTranslation } from "react-i18next";
import { refuseWhilePreviewing } from "@/services/previewGuard";
import type { MemberDetailModel } from "@/components/members/panels/useMemberDetailModel";

export const MEMBER_NAME_MAX_LENGTH = 64;

export function MemberNameInput({ touch, ...props }: InputHTMLAttributes<HTMLInputElement> & { touch?: boolean }) {
  return (
    <input
      type="text"
      maxLength={MEMBER_NAME_MAX_LENGTH}
      className={`form-input w-full px-3 ${touch ? "h-12" : "py-2"} rounded-lg text-sm outline-hidden`}
      style={{ background: "var(--t-bg-input)", border: "1px solid var(--t-border)", color: "var(--t-text-primary)" }}
      {...props}
    />
  );
}

export function MemberNameField({ name, handle, touch }: { name: MemberDetailModel["name"]; handle?: string; touch?: boolean }) {
  const { t } = useTranslation();
  return (
    <>
      <MemberNameInput
        touch={touch}
        aria-label={t("members.detail.nameLabel")}
        value={name.value}
        placeholder={handle ? `@${handle}` : ""}
        readOnly={name.readOnly}
        title={name.title}
        onFocus={() => { refuseWhilePreviewing(); }}
        onChange={(e) => name.setValue(e.target.value)}
        onBlur={name.commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") name.commit();
          if (e.key === "Escape") name.revert();
        }}
      />
      {name.error && <p className="text-[11px] mt-1.5" style={{ color: "var(--t-status-error)" }}>{name.error}</p>}
      <p className="text-[11px] mt-1.5" style={{ color: "var(--t-text-secondary)" }}>{t("members.detail.nameHint")}</p>
    </>
  );
}
