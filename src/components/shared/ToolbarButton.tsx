import type { ButtonHTMLAttributes, ReactNode } from "react";
import { Icon } from "@iconify/react";
import { GREYED_CLASS } from "@/hooks/useGreyedUnless";

export type ToolbarVariant = "neutral" | "accent";
type Round = "all" | "left" | "right";

const FILL: Record<ToolbarVariant, string> = {
  neutral: "bg-(--t-bg-input) enabled:hover:bg-(--t-bg-input-hover) text-(--t-text-primary) border border-transparent",
  accent: "bg-(--t-accent) enabled:hover:bg-(--t-accent-hover) text-(--t-on-accent) border border-(--t-accent-hover)",
};

const PRESSED: Record<ToolbarVariant, string> = {
  neutral: "bg-[color-mix(in_srgb,var(--t-accent)_15%,var(--t-bg-input))] text-(--t-accent) border border-(--t-accent)",
  accent: "bg-(--t-accent-hover) text-(--t-on-accent) border border-(--t-accent-hover)",
};

const ROUND: Record<Round, string> = {
  all: "rounded-[0.533rem]",
  left: "rounded-l-[0.533rem] border-r-0",
  right: "rounded-r-[0.533rem]",
};

const DISABLED = `${GREYED_CLASS} aria-disabled:opacity-50 aria-disabled:cursor-not-allowed`;

export const toolbarButtonClass = (variant: ToolbarVariant = "neutral", pressed = false, round: Round = "all") =>
  `relative flex items-center gap-2 px-3 h-8 text-sm font-bold tracking-wider transition-colors shrink-0 whitespace-nowrap ${ROUND[round]} ${pressed ? PRESSED[variant] : FILL[variant]} ${DISABLED}`;

export const toolbarChevronClass = (variant: ToolbarVariant = "neutral") =>
  `relative overflow-hidden flex items-center justify-center w-8 h-8 transition-colors ${ROUND.right} ${FILL[variant]} ${DISABLED}`;

type ToolbarButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> & {
  variant?: ToolbarVariant;
  pressed?: boolean;
  round?: Round;
  icon: string;
  iconSize?: number;
  label: string;
  compact?: boolean;
  children?: ReactNode;
};

export function ToolbarButton({
  variant = "neutral", pressed, round = "all", icon, iconSize = 20, label, compact = false, className = "", children, title, ...rest
}: ToolbarButtonProps) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      title={title ?? (compact ? label : undefined)}
      {...rest}
      className={`${toolbarButtonClass(variant, pressed, round)} ${className}`}
    >
      {children}
      <Icon icon={icon} width={iconSize} />
      {!compact && label}
    </button>
  );
}
