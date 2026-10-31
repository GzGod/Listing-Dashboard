'use client';
import { useEffect, useRef } from 'react';
import type { SeriesVM } from './api-client.js';
import type { M6Config } from '../config.js';
import { usd } from './format.js';
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** Pure option builder (testable): top grid buzz(left)+price(right), bottom grid spot volume bars, shared x, linked pointer, dataZoom. */
export function buildChartOption(s: SeriesVM, cfg: M6Config) {
  const STAGE_LABEL = cfg.labels.stage;
  const STAGE_COLOR = cfg.stageColors;
  const empty = cfg.labels.noData;
  const byDate = new Map<string, SeriesVM['events']>();
  s.events.forEach((e) => byDate.set(e.date, [...(byDate.get(e.date) ?? []), e]));
  const markLine = {
    symbol: 'none', silent: false,
    data: s.events.map((e) => ({ xAxis: e.date, name: `${STAGE_LABEL[e.stage]} · ${e.exchange}`,
      lineStyle: { color: STAGE_COLOR[e.stage], type: 'dashed' as const, width: 1.5 },
      label: { formatter: STAGE_LABEL[e.stage], color: STAGE_COLOR[e.stage], position: 'insideEndTop' as const } })),
  };
  return {
    animation: false,
    legend: { data: ['声量分', '币价', '现货 24h 成交额'], top: 0 },
    axisPointer: { link: [{ xAxisIndex: 'all' }] },
    tooltip: {
      trigger: 'axis', enterable: true, confine: true, axisPointer: { type: 'cross' },
      formatter: (params: unknown) => {
        const ps = params as { axisValue: string; seriesName: string; value: number | null; marker: string }[];
        const date = ps[0]?.axisValue ?? '';
        const seen = new Set<string>();
        const lines = ps.filter((p) => !seen.has(p.seriesName) && seen.add(p.seriesName)).map((p) =>
          `${p.marker}${p.seriesName}：${p.value == null ? empty : p.seriesName === '声量分' ? p.value : usd(p.value, empty)}`);
        const ev = (byDate.get(date) ?? []).map((e) => `<span style="color:${STAGE_COLOR[e.stage]}">●</span> ${STAGE_LABEL[e.stage]} · ${esc(e.exchange)}${e.pair ? ' · ' + esc(e.pair) : ''}${e.url ? ` · <a href="${esc(e.url)}" target="_blank" rel="noreferrer">公告</a>` : ''}`);
        return [`<b>${date}（UTC）</b>`, ...lines, ...(ev.length ? ['<b>上币节点</b>', ...ev] : [])].join('<br/>');
      },
    },
    grid: [{ left: 60, right: 70, top: 40, height: '48%' }, { left: 60, right: 70, top: '68%', height: '18%' }],
    xAxis: [
      { type: 'category', data: s.dates, gridIndex: 0, axisLabel: { show: false } },
      { type: 'category', data: s.dates, gridIndex: 1 },
    ],
    yAxis: [
      { type: 'value', name: '声量分', gridIndex: 0, position: 'left' },
      { type: 'value', name: '币价 (USD)', gridIndex: 0, position: 'right', scale: true },
      { type: 'value', name: '成交额', gridIndex: 1, axisLabel: { formatter: (v: number) => usd(v, empty) } },
    ],
    dataZoom: [{ type: 'inside', xAxisIndex: [0, 1] }, { type: 'slider', xAxisIndex: [0, 1], bottom: 4 }],
    series: [
      { name: '声量分', type: 'line', xAxisIndex: 0, yAxisIndex: 0, data: s.buzz, connectNulls: false, showSymbol: false, markLine },
      { name: '币价', type: 'line', xAxisIndex: 0, yAxisIndex: 1, data: s.price, connectNulls: false, showSymbol: false },
      { name: '现货 24h 成交额', type: 'bar', xAxisIndex: 1, yAxisIndex: 2, data: s.volume },
    ],
  };
}

export function LinkedChart({ series, cfg }: { series: SeriesVM; cfg: M6Config }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let disposed = false;
    let chart: { setOption: (o: unknown) => void; resize: () => void; dispose: () => void } | null = null;
    const onResize = () => chart?.resize();
    import('echarts').then((echarts) => {
      if (disposed || !ref.current) return;
      const c = echarts.init(ref.current);
      chart = c;
      c.setOption(buildChartOption(series, cfg));
      window.addEventListener('resize', onResize);
    });
    return () => { disposed = true; window.removeEventListener('resize', onResize); chart?.dispose(); };
  }, [series, cfg]);
  return (
    <div>
      <div ref={ref} style={{ width: '100%', height: 460 }} />
      <div style={{ fontSize: 12, color: '#666' }}>上币节点：{(Object.keys(cfg.labels.stage) as (keyof M6Config['labels']['stage'])[]).map((k) => <span key={k} style={{ marginRight: 12, color: cfg.stageColors[k] }}>┆ {cfg.labels.stage[k]}</span>)}</div>
    </div>
  );
}
