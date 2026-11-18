import { useEffect, useRef, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { Icon } from "@iconify/react";
import { useTranslation } from "react-i18next";
import { useUIStore } from "@/stores/uiStore";
import { primaryOnly } from "@/utils/primaryModifier";
import { formInputStyle } from "@/components/shared/Panel";

const isTyping = (el: Element | null) =>
  !!el && (el.matches("input, textarea, select") || (el as HTMLElement).isContentEditable);

export function SettingsSearchField({ variant = "sidebar" }: { variant?: "sidebar" | "mobile" }) {
  const { t } = useTranslation();
  const query = useUIStore((s) => s.settingsQuery);
  const setQuery = useUIStore((s) => s.setSettingsQuery);
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const slash = e.key === "/" && !isTyping(document.activeElement);
      const find = primaryOnly(e) && e.key.toLowerCase() === "f";
      if (!slash && !find) return;
      e.preventDefault();
      e.stopPropagation();
      ref.current?.focus();
      ref.current?.select();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const onKeyDown = (e: ReactKeyboardEvent) => {
    if (e.key !== "Escape") return;
    e.stopPropagation();
    if (query) setQuery("");
    else ref.current?.blur();
  };

  if (variant === "mobile") {
    return (
      <div className="flex items-center gap-3 h-12 pl-4 pr-2 rounded-full bg-(--t-bg-input) text-(--t-text-dim)">
        <Icon icon="lucide:search" width={18} className="shrink-0" />
        <input
          ref={ref}
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={t("settings.search.placeholder")}
          aria-label={t("settings.search.placeholder")}
          className="flex-1 min-w-0 bg-transparent outline-hidden text-base text-(--t-text-primary) [&::-webkit-search-cancel-button]:hidden"
        />
        {query && (
          <button type="button" onClick={() => setQuery("")} aria-label={t("settings.search.clear")} className="w-10 h-10 shrink-0 rounded-full flex items-center justify-center">
            <Icon icon="lucide:x" width={18} />
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="relative">
      <Icon icon="lucide:search" width={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-(--t-text-dim) pointer-events-none" />
      <input
        ref={ref}
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder={t("settings.search.placeholder")}
        aria-label={t("settings.search.placeholder")}
        className="form-input w-full rounded-lg pl-7 pr-7 py-1.5 text-xs outline-hidden [&::-webkit-search-cancel-button]:hidden"
        style={formInputStyle}
      />
      {query ? (
        <button
          type="button"
          onClick={() => { setQuery(""); ref.current?.focus(); }}
          aria-label={t("settings.search.clear")}
          className="absolute right-2 top-1/2 -translate-y-1/2 text-(--t-text-dim)"
        >
          <Icon icon="lucide:x" width={12} />
        </button>
      ) : (
        <kbd className="absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none px-1 rounded-sm text-[10px] border border-(--t-border) text-(--t-text-dim)">/</kbd>
      )}
    </div>
  );
}
