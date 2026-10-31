'use client';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { buzzCells } from './buzz-cells.js';
import { createProjectClient, NotFoundError, type Fetcher, type PostVM, type ProjectClient, type ProjectVM, type SeriesVM } from './api-client.js';
import { createContext, useContext } from 'react';
import { defaultM6Config, type M6Config } from '../config.js';
import { ErrorBoundary } from './ErrorBoundary.js';
import { LinkedChart } from './LinkedChart.js';
import { num as fnum, usd as fusd, utcTime } from './format.js';

const Cfg = createContext<M6Config>(defaultM6Config);
const useCfg = () => useContext(Cfg);
/** config-bound formatters */
function useFmt() { const c = useCfg(); const E = c.labels.noData; return { E, usd: (n: number | null | undefined) => fusd(n, E), num: (n: number | null | undefined) => fnum(n, E), time: (iso: string) => utcTime(iso, c.displayTzOffsetHours) }; }

type Load<T> = { status: 'loading' } | { status: 'error'; message: string; notFound?: boolean } | { status: 'ok'; data: T };
/** fn must be stable (useCallback); the effect re-runs when it changes */
function useLoad<T>(fn: () => Promise<T>): Load<T> {
  const [s, set] = useState<Load<T>>({ status: 'loading' });
  useEffect(() => {
    let live = true;
    set({ status: 'loading' });
    fn().then((data) => live && set({ status: 'ok', data }))
      .catch((e: Error) => live && set({ status: 'error', message: e.message, notFound: e instanceof NotFoundError }));
    return () => { live = false; };
  }, [fn]);
  return s;
}

const card = { border: '1px solid #eee', borderRadius: 10, padding: 16, marginBottom: 16, background: '#fff' } as const;
function Section({ title, children }: { title: string; children: ReactNode }) {
  return <section style={card}><h2 style={{ fontSize: 16, marginTop: 0 }}>{title}</h2><ErrorBoundary label={title}>{children}</ErrorBoundary></section>;
}
const Empty = () => <p style={{ color: '#999' }}>{useCfg().labels.noData}</p>;
const Row = ({ k, v }: { k: string; v: ReactNode }) => <div style={{ display: 'flex', gap: 12, padding: '2px 0' }}><span style={{ color: '#666', minWidth: 120 }}>{k}</span><span>{v}</span></div>;
function RangeToggle({ value, onChange }: { value: string; onChange: (r: string) => void }) {
  const cfg = useCfg();
  const rangeLabel = (r: string) => `近 ${cfg.ranges[r]} 天`;
  return (
  <div style={{ marginBottom: 8 }}>{Object.keys(cfg.ranges).map((r) => <button key={r} onClick={() => onChange(r)} style={{ marginRight: 6, fontWeight: r === value ? 700 : 400 }}>{rangeLabel(r)}</button>)}</div>
  );
}

function Fundamentals({ p }: { p: ProjectVM }) {
  const E = useCfg().labels.noData;
  const f = p.fundamentals;
  return (<>
    <h3 style={{ fontSize: 14 }}>代币分配（Cap Table）</h3>
    {f.capTable.length ? <table><tbody>{f.capTable.map((c) => <tr key={c.holder}><td>{c.holder}</td><td>{c.pct}%</td><td style={{ color: '#888' }}>{c.note ?? ''}</td></tr>)}</tbody></table> : <Empty />}
    <h3 style={{ fontSize: 14 }}>团队背景</h3>
    {f.team.length ? <ul>{f.team.map((t) => <li key={t.name}>{t.url ? <a href={t.url} target="_blank" rel="noreferrer">{t.name}</a> : t.name} · {t.role}{t.bio ? ` · ${t.bio}` : ''}</li>)}</ul> : <Empty />}
    <h3 style={{ fontSize: 14 }}>龙哥团队评级</h3>
    {f.rating ? <p><b style={{ fontSize: 20 }}>{f.rating.grade}</b> <span style={{ color: '#888' }}>评级日期 {f.rating.ratedAt ?? E}</span></p> : <Empty />}
  </>);
}
function Operations({ p }: { p: ProjectVM }) {
  const { E: NO_DATA, usd, num } = useFmt();
  const { userCount: u, revenue: r } = p.fundamentals;
  return (<>
    <Row k="赛道" v={p.track ? `${p.track.parent ? p.track.parent.name + ' / ' : ''}${p.track.name}` : NO_DATA} />
    <Row k="用户量" v={u ? `${num(u.value)}（截至 ${u.asOf}，来源 ${u.source ?? NO_DATA}）` : NO_DATA} />
    <Row k="收入" v={r ? `${usd(r.valueUsd)}${r.period ? ' / ' + r.period : ''}（截至 ${r.asOf}，来源 ${r.source ?? NO_DATA}）` : NO_DATA} />
  </>);
}
function Buzz({ p }: { p: ProjectVM }) {
  const { E: NO_DATA, num } = useFmt();
  const b = p.buzzBreakdown;
  if (!b) return <Empty />;
  return (<div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
    {buzzCells(b, NO_DATA, num).map(([k, v]) =>
      <div key={k}><div style={{ color: '#666', fontSize: 12 }}>{k}</div><div style={{ fontSize: 20 }}>{v}</div></div>)}
    <div style={{ width: '100%', color: '#999', fontSize: 12 }}>数据日 {b.date}（UTC）</div>
  </div>);
}
function Volume({ p }: { p: ProjectVM }) {
  const { E: NO_DATA, usd } = useFmt();
  const v = p.volume;
  if (!v) return <Empty />;
  return (<>
    <Row k="现货 24h 成交额" v={usd(v.spotVolumeUsd24h)} />
    <Row k="同日同赛道排名" v={v.rankInTrack ? `#${v.rankInTrack}（${v.date} UTC，${p.track?.name ?? NO_DATA}，按现货 24h 成交额）` : NO_DATA} />
    {v.byExchange.length ? <table style={{ marginTop: 8 }}><thead><tr><th align="left">交易所</th><th align="right">成交额</th></tr></thead>
      <tbody>{v.byExchange.map((e) => <tr key={e.exchange}><td>{e.exchange}</td><td align="right">{usd(e.volumeUsd)}</td></tr>)}</tbody></table> : <Empty />}
  </>);
}
function Chart({ client, id }: { client: ProjectClient; id: number }) {
  const cfg = useCfg();
  const [range, setRange] = useState<string>(cfg.defaultSeriesRange);
  const s = useLoad<SeriesVM>(useCallback(() => client.series(id, range), [client, id, range]));
  return (<>
    <RangeToggle value={range} onChange={setRange} />
    {s.status === 'loading' ? <p>加载中…</p> : s.status === 'error' ? <p style={{ color: '#dc2626' }}>加载失败：{s.message}</p>
      : s.data.dates.length === 0 || [s.data.buzz, s.data.price, s.data.volume].every((a) => a.every((x) => x == null)) ? <Empty /> : <LinkedChart series={s.data} cfg={cfg} />}
  </>);
}
function Posts({ client, id }: { client: ProjectClient; id: number }) {
  const cfg = useCfg();
  const { num, time } = useFmt();
  const [range, setRange] = useState<string>(cfg.defaultPostsRange);
  const [items, setItems] = useState<PostVM[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [state, setState] = useState<'loading' | 'idle' | 'error'>('loading');
  const [err, setErr] = useState('');
  const load = useCallback((reset: boolean, c: string | null) => {
    setState('loading');
    client.posts(id, range, reset ? null : c).then((pg) => { setItems((x) => (reset ? pg.items : [...x, ...pg.items])); setCursor(pg.nextCursor); setState('idle'); })
      .catch((e: Error) => { setErr(e.message); setState('error'); });
  }, [client, id, range]);
  useEffect(() => { setItems([]); load(true, null); }, [load]);
  return (<>
    <RangeToggle value={range} onChange={setRange} />
    {items.length === 0 && state === 'idle' && <Empty />}
    <ul style={{ listStyle: 'none', padding: 0 }}>{items.map((p) => (
      <li key={p.id} style={{ borderBottom: '1px solid #f3f3f3', padding: '6px 0' }}>
        <b>{p.authorName}</b> <span style={{ color: '#888' }}>@{p.handle} · {p.kolTier} 级{p.tags.length ? ' · ' + p.tags.join('/') : ''}</span>
        <div style={{ fontSize: 13 }}>{time(p.postedAt)} · 浏览 {num(p.views)} · 收藏 {num(p.bookmarks)} · <a href={p.url} target="_blank" rel="noreferrer">查看原帖 ↗</a></div>
      </li>))}</ul>
    {state === 'loading' && <p>加载中…</p>}
    {state === 'error' && <p style={{ color: '#dc2626' }}>加载失败：{err} <button onClick={() => load(items.length === 0, cursor)}>重试</button></p>}
    {state === 'idle' && cursor && <button onClick={() => load(false, cursor)}>加载更多</button>}
  </>);
}

function ProjectInner({ id, client }: { id: number; client: ProjectClient }) {
  const d = useLoad<ProjectVM>(useCallback(() => client.detail(id), [client, id]));
  const { E: NO_DATA, usd } = useFmt();
  if (d.status === 'loading') return <p>加载中…</p>;
  if (d.status === 'error') return <p style={{ color: '#dc2626' }}>{d.notFound ? '项目不存在' : `加载失败：${d.message}`}</p>;
  const p = d.data;
  return (<>
    <header style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
      {p.logoUrl && <img src={p.logoUrl} alt="" width={48} height={48} style={{ borderRadius: 8 }} />}
      <div><h1 style={{ margin: 0 }}>{p.name} <span style={{ color: '#888', fontSize: 18 }}>{p.symbol}</span></h1>
        <div style={{ fontSize: 13, color: '#666' }}>
          最新币价 {usd(p.latestPriceUsd)}{p.latestPriceDate ? `（${p.latestPriceDate} UTC）` : ''} · {p.contracts.map((c) => `${c.chain}: ${c.address.slice(0, 6)}…${c.address.slice(-4)}`).join('，') || '合约 ' + NO_DATA}
          {(['website', 'x', 'docs'] as const).map((k) => p.links[k] && <a key={k} href={p.links[k]!} target="_blank" rel="noreferrer" style={{ marginLeft: 8 }}>{{ website: '官网', x: 'X', docs: '文档' }[k]}</a>)}
        </div></div>
    </header>
    <Section title="基本面（PD-01）"><Fundamentals p={p} /></Section>
    <Section title="运营数据（PD-02）"><Operations p={p} /></Section>
    <Section title="声量拆解（PD-03）"><Buzz p={p} /></Section>
    <Section title="成交额（PD-04）"><Volume p={p} /></Section>
    <Section title="声量 · 成交额 · 币价联动图（PD-05）"><Chart client={client} id={id} /></Section>
    <Section title="KOL 发帖记录（PD-03）"><Posts client={client} id={id} /></Section>
  </>);
}

export function ProjectPage({ id, apiBase, config = defaultM6Config, fetcher }: { id: number; apiBase: string; config?: M6Config; fetcher?: Fetcher }) {
  const client = useMemo(() => createProjectClient(apiBase, fetcher), [apiBase, fetcher]);
  return <Cfg.Provider value={config}><ErrorBoundary label="项目详情页"><ProjectInner id={id} client={client} /></ErrorBoundary></Cfg.Provider>;
}
