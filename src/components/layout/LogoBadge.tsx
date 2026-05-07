import LogoSvg from "/logo.svg?react";

interface Props {
  size?: number;
  className?: string;
  active?: boolean;
  borderRadius?: string;
}

export default function LogoBadge({ size = 12, className = "", active = true, borderRadius }: Props) {
  const px = size * 4;
  const radius = borderRadius ?? `${size}px`;
  const borderWidth = Math.max(1, Math.round(size / 6));
  return (
    <div
      className={`inline-flex items-center justify-center ${className}`}
      style={{
        width: px,
        height: px,
        borderRadius: radius,
        backgroundColor: "#010318",
        border: `${borderWidth}px solid transparent`,
        backgroundImage: active
          ? "linear-gradient(#010318, #010318), linear-gradient(to right, #28A5F9, #E98757)"
          : "none",
        backgroundOrigin: "border-box",
        backgroundClip: active ? "padding-box, border-box" : undefined,
        transition: "border-radius 200ms",
      }}
    >
      <LogoSvg style={{ height: px * 0.62, width: "auto" }} />
    </div>
  );
}
