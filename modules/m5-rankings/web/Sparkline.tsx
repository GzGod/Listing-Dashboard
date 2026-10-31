/** Sparkline with real gaps: null days break the line (never drawn as 0). */
export function Sparkline({ data, emptyLabel, width = 120, height = 28 }: { data: (number | null)[]; emptyLabel: string; width?: number; height?: number }) {
  const vals = data.filter((v): v is number => v !== null);
  if (!vals.length) return <span style={{ color: '#999' }}>{emptyLabel}</span>;
  const max = Math.max(...vals, 1);
  const step = data.length > 1 ? width / (data.length - 1) : 0;
  const pt = (v: number, i: number) => [data.length > 1 ? i * step : width / 2, height - (v / max) * (height - 2) - 1] as const;
  const segments: (readonly [number, number])[][] = [];
  let cur: (readonly [number, number])[] = [];
  data.forEach((v, i) => { if (v === null) { if (cur.length) segments.push(cur); cur = []; } else cur.push(pt(v, i)); });
  if (cur.length) segments.push(cur);
  return (
    <svg width={width} height={height} aria-label="每日声量走势">
      {segments.map((seg, k) => seg.length === 1
        ? <circle key={k} cx={seg[0]![0]} cy={seg[0]![1]} r={1.5} fill="#3b82f6" />
        : <polyline key={k} points={seg.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ')} fill="none" stroke="#3b82f6" strokeWidth={1.5} />)}
    </svg>
  );
}
