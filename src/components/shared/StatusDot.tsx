interface StatusDotProps {
  color: string;
  animate?: boolean;
  size?: number;
  fast?: boolean;
  className?: string;
}

export function StatusDot({ color, animate = false, size = 11, fast = false, className = "" }: StatusDotProps) {
  return (
    <span className={`absolute bottom-0 right-0 ${className}`}>
      {animate && (
        <span
          className={`absolute inset-0 rounded-full group-hover:animate-ping ${fast ? "animate-ping" : "animate-ping-slow"}`}
          style={{ background: color }}
        />
      )}
      <span
        className="relative block rounded-full border-2 border-(--t-bg-card)"
        style={{ width: size, height: size, background: color }}
      />
    </span>
  );
}
