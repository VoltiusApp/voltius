import { useEffect, useRef } from "react";
import uPlot from "uplot";
import "uplot/dist/uPlot.min.css";

interface SparklineProps {
  data: number[];
  color: string;
  height?: number;
}

export function Sparkline({ data, color, height = 38 }: SparklineProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const uRef = useRef<uPlot | null>(null);
  const dataRef = useRef(data);
  dataRef.current = data;

  // Init / reinit when structural params change
  useEffect(() => {
    if (!containerRef.current) return;
    const width = containerRef.current.clientWidth || 268;

    uRef.current?.destroy();
    // Clear leftover DOM from previous uPlot instance
    containerRef.current.innerHTML = "";

    const d = dataRef.current;
    const xs = Array.from({ length: Math.max(d.length, 1) }, (_, i) => i);
    const ys = d.length ? d : [0];

    const opts: uPlot.Options = {
      width,
      height,
      cursor: { show: false },
      legend: { show: false },
      padding: [4, 0, 2, 0],
      axes: [{ show: false }, { show: false }],
      scales: {
        x: { time: false },
        y: {
          range: (_u, min, max) => {
            const pad = Math.max((max - min) * 0.1, 1);
            return [Math.max(0, min - pad), max + pad];
          },
        },
      },
      series: [
        {},
        {
          stroke: color,
          fill: color + "28",
          width: 1.5,
          spanGaps: true,
        },
      ],
    };

    uRef.current = new uPlot(opts, [xs, ys], containerRef.current);
    return () => {
      uRef.current?.destroy();
      uRef.current = null;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [height, color]);

  // Update data without recreating
  useEffect(() => {
    if (!uRef.current || !data.length) return;
    const xs = Array.from({ length: data.length }, (_, i) => i);
    uRef.current.setData([xs, data]);
  }, [data]);

  return <div ref={containerRef} style={{ width: "100%" }} />;
}
