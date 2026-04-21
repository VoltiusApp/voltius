import logoUrl from "/logo.svg";

interface Props {
  size?: number;
  className?: string;
  active?: boolean;
  borderRadius?: string;
}

export default function LogoBadge({ size = 12, className = "", active = true, borderRadius = "0.75rem" }: Props) {
  const px = size * 4;
  return (
    <div
      className={`inline-flex items-center justify-center ${className}`}
      style={{
        width: px,
        height: px,
        borderRadius,
        backgroundColor: "#010318",
        border: "2px solid transparent",
        backgroundImage: active
          ? "linear-gradient(#010318, #010318), linear-gradient(to right, #28A5F9, #E98757)"
          : "none",
        backgroundOrigin: "border-box",
        backgroundClip: active ? "padding-box, border-box" : undefined,
        transition: "border-radius 200ms",
      }}
    >
      <img src={logoUrl} alt="Voltius" style={{ height: px * 0.62, width: "auto" }} />
    </div>
  );
}
