import { Icon } from "@iconify/react";

export default function MobileFilterBar({
  value, onChange, placeholder = "Filter…",
}: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <div className="px-3 py-2 shrink-0">
      <div className="flex items-center gap-2 px-3 h-10 rounded-xl"
        style={{ background: "var(--t-bg-card)", border: "1px solid var(--t-border)" }}>
        <Icon icon="lucide:search" width={16} className="text-(--t-text-dim) shrink-0" />
        <input
          data-mobile-filter
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="flex-1 bg-transparent outline-none text-sm text-(--t-text-primary) placeholder:text-(--t-text-dim)"
        />
        {value && (
          <button data-mobile-filter-clear onClick={() => onChange("")} className="shrink-0 text-(--t-text-dim) active:text-(--t-text-primary)">
            <Icon icon="lucide:x" width={16} />
          </button>
        )}
      </div>
    </div>
  );
}
