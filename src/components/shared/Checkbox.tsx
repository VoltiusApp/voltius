export function CheckboxBox({ checked, onClick, small }: { checked: boolean; onClick?: () => void; small?: boolean }) {
  return <span onClick={onClick} data-checked={checked || undefined} className={`checkbox-box transition-colors${small ? " checkbox-box-sm" : ""}`} />;
}

export function Checkbox({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="flex items-center gap-2 cursor-pointer select-none text-sm text-(--t-text-primary)">
      <CheckboxBox checked={checked} onClick={() => onChange(!checked)} />
      {label}
    </label>
  );
}
