export interface TagOverflowInput {
  containerWidth: number;
  tagWidths: number[];
  moreWidth: number;
  gapWidth: number;
}

function widthWithGaps(widths: number[], gapWidth: number) {
  return widths.reduce((total, width, index) => total + width + (index > 0 ? gapWidth : 0), 0);
}

export function calculateVisibleTagCount({ containerWidth, tagWidths, moreWidth, gapWidth }: TagOverflowInput) {
  if (tagWidths.length === 0 || containerWidth <= 0) {
    return 0;
  }

  if (widthWithGaps(tagWidths, gapWidth) <= containerWidth) {
    return tagWidths.length;
  }

  for (let count = tagWidths.length - 1; count > 0; count -= 1) {
    const visibleWidth = widthWithGaps(tagWidths.slice(0, count), gapWidth);
    const counterGap = visibleWidth > 0 ? gapWidth : 0;

    if (visibleWidth + counterGap + moreWidth <= containerWidth) {
      return count;
    }
  }

  return 0;
}
