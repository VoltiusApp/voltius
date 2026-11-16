import { Fragment, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { TagBadge } from "@/components/shared/TagBadge";
import { calculateVisibleTagCount } from "@/utils/tagOverflow";

export interface OverflowItem {
  key: string;
  label: string;
  node: ReactNode;
}

interface OverflowListProps {
  items: OverflowItem[];
  className?: string;
  moreClassName?: string;
  trailing?: ReactNode;
  maxWidth?: number;
}

const GAP_WIDTH = 4;

export function OverflowList({
  items, className = "", moreClassName = "shrink-0 text-xs text-(--t-text-dim)", trailing, maxWidth,
}: OverflowListProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<(HTMLSpanElement | null)[]>([]);
  const moreRef = useRef<HTMLSpanElement>(null);
  const trailingRef = useRef<HTMLSpanElement>(null);
  const [visibleCount, setVisibleCount] = useState(items.length);
  const hidden = items.slice(visibleCount);
  const itemsKey = items.map((i) => i.key).join("\u0000");

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    let frame = 0;
    const measure = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const tagWidths = itemRefs.current.slice(0, items.length).map((node) => node?.offsetWidth ?? 0);
        const moreWidth = moreRef.current?.offsetWidth ?? 0;

        if (tagWidths.some((width) => width === 0) || moreWidth === 0) {
          return;
        }

        const trailingWidth = trailingRef.current?.offsetWidth ?? 0;
        const available = maxWidth !== undefined
          ? Math.min(container.clientWidth, maxWidth)
          : container.clientWidth;

        setVisibleCount(calculateVisibleTagCount({
          containerWidth: available - (trailingWidth > 0 ? trailingWidth + GAP_WIDTH : 0),
          tagWidths,
          moreWidth,
          gapWidth: GAP_WIDTH,
        }));
      });
    };

    measure();

    const resizeObserver = new ResizeObserver(measure);
    resizeObserver.observe(container);

    return () => {
      cancelAnimationFrame(frame);
      resizeObserver.disconnect();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemsKey, maxWidth]);

  if (items.length === 0) {
    return null;
  }

  return (
    <div ref={containerRef} className={`relative min-w-0 overflow-hidden ${className}`}>
      <div className="flex items-center gap-1 overflow-hidden whitespace-nowrap">
        {items.slice(0, visibleCount).map((item) => <Fragment key={item.key}>{item.node}</Fragment>)}
        {hidden.length > 0 && (
          <span data-overflow-more title={hidden.map((i) => i.label).join(", ")} className={moreClassName}>
            +{hidden.length}
          </span>
        )}
        {trailing}
      </div>

      <div className="pointer-events-none invisible absolute left-0 top-0 flex items-center gap-1 whitespace-nowrap" aria-hidden="true">
        {items.map((item, index) => (
          <span key={item.key} ref={(node) => { itemRefs.current[index] = node; }} className="inline-flex">
            {item.node}
          </span>
        ))}
        <span ref={moreRef} className={moreClassName}>
          +{items.length}
        </span>
        <span ref={trailingRef} className="inline-flex">{trailing}</span>
      </div>
    </div>
  );
}

interface OverflowTagListProps {
  tags: string[];
  className?: string;
  badgeClassName?: string;
  maxWidth?: number;
}

export function OverflowTagList({ tags, className, badgeClassName = "", maxWidth }: OverflowTagListProps) {
  return (
    <OverflowList
      items={tags.map((tag) => ({ key: tag, label: tag, node: <TagBadge tag={tag} className={badgeClassName} /> }))}
      className={className}
      maxWidth={maxWidth}
    />
  );
}
