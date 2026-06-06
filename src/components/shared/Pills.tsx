import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { Icon } from "@iconify/react";

export interface PillOption<T extends string> {
  value: T;
  label: string;
  icon?: string;
  disabled?: boolean;
}

export function Pills<T extends string>({
  options,
  value,
  onChange,
}: {
  options: PillOption<T>[];
  value: T;
  onChange: (v: T) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [indicatorStyle, setIndicatorStyle] = useState<React.CSSProperties>({});

  const updateIndicator = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
    const idx = options.findIndex((o) => o.value === value);
    const buttons = container.querySelectorAll<HTMLElement>("button");
    const btn = buttons[idx];
    if (!btn) return;
    setIndicatorStyle({
      left: btn.offsetLeft,
      width: btn.offsetWidth,
    });
  }, [value, options]);

  useLayoutEffect(() => {
    updateIndicator();
    const container = containerRef.current;
    if (!container) return;
    const ro = new ResizeObserver(updateIndicator);
    ro.observe(container);
    return () => ro.disconnect();
  }, [updateIndicator]);

  return (
    <div
      ref={containerRef}
      className="relative flex gap-0.5 p-0.5 rounded-lg bg-(--t-bg-base) border border-(--t-border)"
    >
      <div
        className="absolute rounded-md pointer-events-none"
        style={{
          left: indicatorStyle.left,
          width: indicatorStyle.width,
          top: 2,
          bottom: 2,
          background: "var(--t-accent)",
          opacity: 0.15,
          transition: "left 150ms ease, width 150ms ease",
        }}
      />
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          disabled={opt.disabled}
          onClick={() => !opt.disabled && onChange(opt.value)}
          className="relative z-10 flex flex-1 items-center justify-center px-2.5 py-1 rounded-md text-xs font-medium transition-colors"
          style={{
            color: value === opt.value
              ? "var(--t-accent)"
              : opt.disabled
                ? "var(--t-text-dim)"
                : "var(--t-text-secondary)",
            cursor: opt.disabled ? "not-allowed" : "pointer",
            opacity: opt.disabled ? 0.4 : 1,
          }}
        >
          {opt.icon ? <Icon icon={opt.icon} width={16} /> : opt.label}
        </button>
      ))}
    </div>
  );
}
