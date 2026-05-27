import {
  clampRatio,
  computeKateMinimapLayout,
  samplePlacement,
  pointerRatio,
  pointerRatioForLayout,
  sampleLineDensities,
  scrollDeltaForRatio,
  viewportThumb,
} from "./minimapMath.ts";

function equal<T>(actual: T, expected: T) {
  if (actual !== expected) throw new Error(`Expected ${String(expected)}, got ${String(actual)}`);
}

function deepEqual(actual: unknown, expected: unknown) {
  const actualJson = JSON.stringify(actual);
  const expectedJson = JSON.stringify(expected);
  if (actualJson !== expectedJson) throw new Error(`Expected ${expectedJson}, got ${actualJson}`);
}

function run() {
  equal(clampRatio(-0.2), 0);
  equal(clampRatio(1.2), 1);
  equal(clampRatio(0.4), 0.4);

  equal(pointerRatio(75, 50, 100), 0.25);
  equal(pointerRatio(10, 50, 100), 0);
  equal(pointerRatio(200, 50, 100), 1);

  equal(pointerRatioForLayout(100, 50, { contentHeight: 100 }), 0.5);
  equal(pointerRatioForLayout(175, 50, { contentHeight: 100 }), 1);

  deepEqual(
    sampleLineDensities(["", "abcd", "abcdefgh"], 3, 8),
    [{ density: 0, text: "" }, { density: 0.5, text: "abcd" }, { density: 1, text: "abcdefgh" }],
  );

  deepEqual(
    sampleLineDensities(["", "abcd", "abcdefgh", "ab"], 2, 8),
    [{ density: 0.25, text: "abcd" }, { density: 0.625, text: "abcdefgh" }],
  );

  deepEqual(
    sampleLineDensities(["one", "two"], 6, 3),
    [{ density: 1, text: "one" }, { density: 1, text: "two" }],
  );

  equal(scrollDeltaForRatio(0.5, 100, 20, 10), 30);
  equal(scrollDeltaForRatio(2, 100, 20, 10), 70);

  deepEqual(viewportThumb(100, 20, 10, 200), { top: 20, height: 40 });
  deepEqual(viewportThumb(10, 20, 0, 200), { top: 0, height: 200 });

  deepEqual(
    computeKateMinimapLayout({ bufferLength: 5, rows: 20, viewportY: 0, canvasHeight: 200, rowHeight: 2 }),
    { contentHeight: 10, scaleY: 1, viewportTop: 0, viewportHeight: 10 },
  );

  deepEqual(
    computeKateMinimapLayout({ bufferLength: 1000, rows: 20, viewportY: 490, canvasHeight: 200, rowHeight: 2 }),
    { contentHeight: 200, scaleY: 0.1, viewportTop: 98, viewportHeight: 4 },
  );

  deepEqual(
    samplePlacement({ sampleIndex: 99, sampleCount: 100, layout: { contentHeight: 200, scaleY: 0.1, viewportTop: 0, viewportHeight: 4 }, rowHeight: 2 }),
    { top: 198, height: 2 },
  );

  deepEqual(
    samplePlacement({ sampleIndex: 4, sampleCount: 5, layout: { contentHeight: 10, scaleY: 1, viewportTop: 0, viewportHeight: 10 }, rowHeight: 2 }),
    { top: 8, height: 2 },
  );
}

run();
console.log("minimapMath tests passed");
