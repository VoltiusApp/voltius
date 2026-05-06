import { getTagColorStyle } from "@/utils/tagColors";

interface TagBadgeProps {
  tag: string;
  className?: string;
  children?: React.ReactNode;
}

export function TagBadge({ tag, className = "", children }: TagBadgeProps) {
  return (
    <span
      className={`px-1.5 py-0.5 rounded text-xxs border ${className}`}
      style={getTagColorStyle(tag)}
    >
      {children ?? tag}
    </span>
  );
}
