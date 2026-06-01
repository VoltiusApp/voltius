import { Icon } from "@iconify/react";

export function ConnectionHeader({
  icon,
  name,
  subtitle,
  isConnecting,
  showSpecialPanel,
}: {
  icon: string;
  name: string;
  subtitle?: string;
  isConnecting: boolean;
  showSpecialPanel: boolean;
}) {
  return (
    <>
      <div className="relative">
        <div className="w-14 h-14 rounded-2xl bg-accent/10 border border-accent/20 flex items-center justify-center">
          <Icon icon={icon} width={22} className="text-accent" />
        </div>
        {isConnecting && !showSpecialPanel && (
          <svg
            className="absolute inset-0 w-full h-full pointer-events-none"
            viewBox="0 0 56 56"
          >
            <rect
              x="0.5"
              y="0.5"
              width="55"
              height="55"
              rx="16"
              ry="16"
              fill="none"
              stroke="#6366f1"
              strokeWidth="1.5"
              strokeDasharray="48 145"
              strokeLinecap="round"
              style={{ animation: "border-trace 0.8s linear infinite" }}
            />
          </svg>
        )}
      </div>

      <div>
        <p className="text-text-primary font-medium text-base leading-tight">{name}</p>
        {subtitle && <p className="text-text-muted text-xs mt-1">{subtitle}</p>}
      </div>
    </>
  );
}
