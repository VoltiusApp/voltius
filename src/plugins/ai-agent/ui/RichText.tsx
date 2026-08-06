import { useMemo, Fragment } from "react";
import { segmentText } from "../state/segmentText";
import { ObjectRefChip } from "./ObjectRefChip";
import type { ObjectRefResolver } from "./useObjectRefs";

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

/**
 * Renders a text segment, abbreviating any UUID that did not resolve to a known
 * object — a closed session, a deleted connection. The full value stays in the
 * `title`, since it is what the model actually addressed.
 */
function Text({ value }: { value: string }) {
  const parts = useMemo(() => value.split(UUID), [value]);
  const ids = useMemo(() => value.match(UUID) ?? [], [value]);
  if (ids.length === 0) return <span>{value}</span>;
  return (
    <span>
      {parts.map((part, i) => (
        <Fragment key={i}>
          {part}
          {ids[i] && (
            <span title={ids[i]} className="font-mono opacity-80">
              {ids[i].slice(0, 8)}…
            </span>
          )}
        </Fragment>
      ))}
    </span>
  );
}

/**
 * Renders text, swapping any known object-id for an inline ObjectRefChip.
 *
 * `oneLine` is required wherever the parent clamps with `truncate`: the default
 * `whitespace-pre-wrap` on this root re-enables wrapping and defeats the clamp.
 */
export function RichText({ text, refs, oneLine }: { text: string; refs: ObjectRefResolver; oneLine?: boolean }) {
  const segments = useMemo(() => segmentText(text, refs.knownIds), [text, refs.knownIds]);
  return (
    <span className={oneLine ? "whitespace-nowrap" : "whitespace-pre-wrap break-words"}>
      {segments.map((seg, i) =>
        seg.type === "text" ? (
          <Text key={i} value={seg.value} />
        ) : (
          <ObjectRefChip key={i} id={seg.id} refObj={refs.resolve(seg.id)} />
        ),
      )}
    </span>
  );
}
