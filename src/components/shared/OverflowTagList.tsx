import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { TagBadge } from "@/components/shared/TagBadge";
import { calculateVisibleTagCount } from "@/utils/tagOverflow";

interface OverflowTagListProps {
  tags: string[];
  className?: string;
  badgeClassName?: string;
  maxWidth?: number;
}

const GAP_WIDTH = 4;

export function OverflowTagList({ tags, className = "", badgeClassName = "", maxWidth }: OverflowTagListProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const tagRefs = useRef<(HTMLSpanElement | null)[]>([]);
  const moreRef = useRef<HTMLSpanElement>(null);
  const [visibleCount, setVisibleCount] = useState(tags.length);
  const hiddenTags = tags.slice(visibleCount);
  const tagsKey = tags.join("\u0000");

  const hiddenTitle = useMemo(() => hiddenTags.join(", "), [hiddenTags]);

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    let frame = 0;
    const measure = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const tagWidths = tags.map((_, index) => tagRefs.current[index]?.offsetWidth ?? 0);
        const moreWidth = moreRef.current?.offsetWidth ?? 0;

        if (tagWidths.some((width) => width === 0) || moreWidth === 0) {
          return;
        }

        const containerWidth = maxWidth !== undefined
          ? Math.min(container.clientWidth, maxWidth)
          : container.clientWidth;

        const nextVisibleCount = calculateVisibleTagCount({
          containerWidth,
          tagWidths,
          moreWidth,
          gapWidth: GAP_WIDTH,
        });

        setVisibleCount(nextVisibleCount);
      });
    };

    measure();

    const resizeObserver = new ResizeObserver(measure);
    resizeObserver.observe(container);

    return () => {
      cancelAnimationFrame(frame);
      resizeObserver.disconnect();
    };
  }, [tags, tagsKey, maxWidth]);

  if (tags.length === 0) {
    return null;
  }

  return (
    <div ref={containerRef} className={`relative min-w-0 overflow-hidden ${className}`}>
      <div className="flex items-center gap-1 overflow-hidden whitespace-nowrap">
        {tags.slice(0, visibleCount).map((tag) => <TagBadge key={tag} tag={tag} className={badgeClassName} />)}
        {hiddenTags.length > 0 && (
          <span title={hiddenTitle} className="shrink-0 text-xs text-[var(--t-text-dim)]">
            +{hiddenTags.length}
          </span>
        )}
      </div>

      <div className="pointer-events-none invisible absolute left-0 top-0 flex items-center gap-1 whitespace-nowrap" aria-hidden="true">
        {tags.map((tag, index) => (
          <span key={`${tag}-${index}`} ref={(node) => { tagRefs.current[index] = node; }} className="inline-flex">
            <TagBadge tag={tag} className={badgeClassName} />
          </span>
        ))}
        <span ref={moreRef} className="shrink-0 text-xs text-[var(--t-text-dim)]">
          +{tags.length}
        </span>
      </div>
    </div>
  );
}
