'use client';
import { useEffect, useMemo, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation.js';
import { defaultDate, defaultM5Config, type M5Config } from '../config.js';
import { createRankingsClient, type Fetcher, type RankingsVM, type TrackVM } from './api-client.js';
import { ErrorBoundary } from './ErrorBoundary.js';
import { Sparkline } from './Sparkline.js';

type Track = TrackVM;
type Load<T> = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ok'; data: T };

const fmt = (n: number) => n.toLocaleString('zh-CN', { maximumFractionDigits: 1 });

function Delta({ d }: { d: number | null }) {
  if (d === null) return <span style={{ color: '#999' }}>新</span>;
  if (d === 0) return <span style={{ color: '#999' }}>–</span>;
  return <span style={{ color: d > 0 ? '#16a34a' : '#dc2626' }}>{d > 0 ? `↑${d}` : `↓${-d}`}</span>;
}

function RankingsInner({ apiBase, cfg, fetcher }: { apiBase: string; cfg: M5Config; fetcher?: Fetcher }) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [tracks, setTracks] = useState<Load<Track[]>>({ status: 'loading' });
  const [data, setData] = useState<Load<RankingsVM>>({ status: 'loading' });
  const maxDate = defaultDate(cfg);
  const L = cfg.labels;
  const client = useMemo(() => createRankingsClient(apiBase, fetcher), [apiBase, fetcher]);

  useEffect(() => {
    client.tracks()
      .then((t) => setTracks({ status: 'ok', data: t }))
      .catch((e: Error) => setTracks({ status: 'error', message: e.message }));
  }, [client]);

  const all = tracks.status === 'ok' ? tracks.data : [];
  const parents = all.filter((t) => t.parentId === null);
  const subsOf = (pid: number) => all.filter((t) => t.parentId === pid);
  const qTrack = Number(sp.get('track'));
  const track = all.some((t) => t.id === qTrack && t.parentId !== null) ? qTrack : (parents[0] ? subsOf(parents[0].id)[0]?.id : undefined);
  const window = cfg.windows.includes(Number(sp.get('window'))) ? Number(sp.get('window')) : cfg.defaultWindow;
  const date = sp.get('date') ?? maxDate;
  const activeParent = all.find((t) => t.id === track)?.parentId ?? parents[0]?.id;

  const setQuery = (patch: Record<string, string | number>) => {
    const q = new URLSearchParams(sp.toString());
    Object.entries(patch).forEach(([k, v]) => q.set(k, String(v)));
    router.replace(`${pathname}?${q.toString()}`);
  };

  useEffect(() => {
    if (track === undefined) return;
    setData({ status: 'loading' });
    client.rankings({ track, window, date })
      .then((d) => setData({ status: 'ok', data: d }))
      .catch((e: Error) => setData({ status: 'error', message: e.message }));
  }, [client, track, window, date]);

  const btn = (active: boolean) => ({ padding: '4px 12px', borderRadius: 6, border: '1px solid #ddd', background: active ? '#111' : '#fff', color: active ? '#fff' : '#111', cursor: 'pointer' });

  const table = useMemo(() => {
    if (data.status === 'loading') return <p>加载中…</p>;
    if (data.status === 'error') return <p style={{ color: '#dc2626' }}>加载失败：{data.message}</p>;
    const d = data.data;
    return (
      <>
        <p style={{ color: '#666', fontSize: 13 }}>统计区间（UTC）：{d.from} ~ {d.date}，共 {d.window} 天；按调整后声量分求和排名，仅限「{d.trackName}」赛道内。</p>
        {d.rows.length === 0 ? <p>{L.noData}</p> : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr style={{ textAlign: 'left', borderBottom: '1px solid #eee' }}><th>排名</th><th>变化</th><th>项目</th><th>声量分</th><th>每日走势</th></tr></thead>
            <tbody>{d.rows.map((it) => (
              <tr key={it.projectId} style={{ borderBottom: '1px solid #f3f3f3' }}>
                <td>{it.rank}</td><td><Delta d={it.rankDelta} /></td>
                <td><a href={it.detailHref} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  {it.logoUrl ? <img src={it.logoUrl} alt="" width={20} height={20} style={{ borderRadius: 4 }} /> : <span style={{ width: 20 }} />}
                  {it.name} <span style={{ color: '#999' }}>{it.symbol}</span></a>
                  {it.partial && <span title={`窗口内 ${it.coveredDays}/${d.window} 天有数据`} style={{ marginLeft: 6, fontSize: 11, padding: '0 6px', background: '#fef3c7', borderRadius: 4 }}>{L.partialData} {it.coveredDays}/{d.window}</span>}
                </td>
                <td>{fmt(it.score)}</td><td><Sparkline data={it.daily} emptyLabel={L.noData} /></td>
              </tr>))}</tbody>
          </table>)}
        {d.noData.length > 0 && <p style={{ color: '#999', fontSize: 13 }}>{L.noData}（不参与排名）：{d.noData.map((p, i) => <span key={p.projectId}>{i > 0 && '、'}<a href={p.detailHref}>{p.name} {p.symbol}</a></span>)}</p>}
      </>
    );
  }, [data, L, cfg]);

  if (tracks.status === 'loading') return <p>加载赛道…</p>;
  if (tracks.status === 'error') return <p style={{ color: '#dc2626' }}>赛道加载失败：{tracks.message}</p>;
  if (!parents.length) return <p>{L.noData}</p>;

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }} role="tablist">
        {parents.map((p) => <button key={p.id} role="tab" style={btn(p.id === activeParent)} onClick={() => { const s = subsOf(p.id)[0]; if (s) setQuery({ track: s.id }); }}>{p.name}</button>)}
      </div>
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'center', marginBottom: 12 }}>
        <label>细分赛道 <select value={track ?? ''} onChange={(e) => setQuery({ track: e.target.value })}>
          {activeParent && subsOf(activeParent).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select></label>
        <span>窗口 {cfg.windows.map((w) => <button key={w} style={btn(w === window)} onClick={() => setQuery({ window: String(w) })}>{w} 天</button>)}</span>
        <label>截止日（UTC） <input type="date" value={date} max={maxDate} onChange={(e) => e.target.value && setQuery({ date: e.target.value })} /></label>
      </div>
      {table}
    </div>
  );
}

/** /rankings page body. Wrap in <Suspense> in the host page (uses useSearchParams). */
export function RankingsPage({ apiBase, config = defaultM5Config, fetcher }: { apiBase: string; config?: M5Config; fetcher?: Fetcher }) {
  return (
    <ErrorBoundary label="声量排行榜">
      <h1>声量排行榜</h1>
      <RankingsInner apiBase={apiBase} cfg={config} fetcher={fetcher} />
    </ErrorBoundary>
  );
}
