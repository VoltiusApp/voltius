import { Sparkline } from "./Sparkline";

interface MetricCardProps {
  label: string;
  value: string;
  color: string;
  history: number[];
}

export function MetricCard({ label, value, color, history }: MetricCardProps) {
  return (
    <div className="px-4 pt-3 pb-1 border-b border-(--t-border)">
      <div className="flex items-baseline justify-between mb-1">
        <span className="text-[10px] font-semibold uppercase tracking-widest text-(--t-text-dim)">
          {label}
        </span>
        <span className="text-xs font-mono font-semibold text-(--t-text-bright)">{value}</span>
      </div>
      <Sparkline data={history} color={color} height={36} />
    </div>
  );
}
