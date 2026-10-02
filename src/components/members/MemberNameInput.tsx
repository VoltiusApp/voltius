import type { InputHTMLAttributes } from "react";

export const MEMBER_NAME_MAX_LENGTH = 64;

export function MemberNameInput(props: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      type="text"
      maxLength={MEMBER_NAME_MAX_LENGTH}
      className="form-input w-full px-3 py-2 rounded-lg text-sm outline-hidden"
      style={{ background: "var(--t-bg-input)", border: "1px solid var(--t-border)", color: "var(--t-text-primary)" }}
      {...props}
    />
  );
}
