import { createFileRoute, Link, notFound } from '@tanstack/react-router';
import { Fragment, useEffect, useState } from 'react';
import { ArrowLeft, ArrowUpRight, Camera, ChevronDown, Trophy, X } from 'lucide-react';
import { EVENTS, QUALIFIERS_PER_POOL, eventInfo, isEventKey, type EventInfo } from '@/data/event';
import type { EventData, GalleryPhoto, PoolSummary } from '@/data/tournament';
import { getEventPage } from '@/lib/tournament-data';
import { freshness } from '@/lib/freshness';
import { LIVE_REFRESH_MS, useAutoRefresh } from '@/hooks/use-auto-refresh';
import { StatusPill } from '@/components/MatchViews';
import { Bracket } from '@/components/bracket';
import { RefreshButton } from '@/components/RefreshButton';

export const Route = createFileRoute('/tournaments/$slug')({
  loader: async ({ params }) => {
    if (!isEventKey(params.slug)) throw notFound();
    const data = await getEventPage({ data: { slug: params.slug, atLeast: freshness() } });
    if (!data) throw notFound();
    return data;
  },
  head: ({ params }) => {
    const label = eventInfo(params.slug)?.label ?? 'Event';
    return { meta: [{ title: `${label} | The Baddy Club × District Play Open` }, { name: 'description', content: `${label} pools, knockout draw and champion at The Baddy Club × District Play Open.` }] };
  },
  component: TournamentPage,
  // The router's default is to sit on the old page for a full second before
  // showing anything, which on a slow phone reads as the home page freezing.
  // The event's name and prize are known without the sheet, so show those at once.
  pendingMs: 100,
  pendingMinMs: 200,
  pendingComponent: EventPending,
});

function EventPending() {
  const info = eventInfo(Route.useParams().slug);
  if (!info) return null;
  return <>
    <section className="t-intro section-shell">
      <Link to="/" hash="events" className="back-link"><ArrowLeft size={16} /> All events</Link>
      <p className="eyebrow">Event {info.shortLabel}</p>
      <h1>{info.label}<span>.</span></h1>
      <div className="t-meta"><p className="t-prize">Prize <strong>{info.prize}</strong></p></div>
    </section>
    <section className="t-content section-shell"><div className="empty-state">Loading the draw…</div></section>
  </>;
}

const TABS = ['Pools', 'Knockouts', 'Winners', 'Gallery'] as const;
type Tab = (typeof TABS)[number];

function PoolMatches({ summary }: { summary: PoolSummary }) {
  return <div className="pool-matches">{summary.matches.map((m) => <div className={`pool-match ${m.status === 'live' ? 'pool-match-live' : ''}`} key={m.matchNumber}>
    <div className="pool-match-teams"><span className={m.winner === 'a' ? 'winner' : ''}>{m.teamA}</span><span className={m.winner === 'b' ? 'winner' : ''}>{m.teamB}</span></div>
    <div className="pool-match-score"><span>{m.scoreA ?? '–'}</span><span>{m.scoreB ?? '–'}</span></div>
    <div className="pool-match-meta"><span>{[m.time, m.court].filter(Boolean).join(' · ')}</span><StatusPill status={m.status} /></div>
  </div>)}</div>;
}

function PoolStandings({ summary, isDoubles }: { summary: PoolSummary; isDoubles: boolean }) {
  const { pool, standings } = summary;
  return <table className="standings">
    <thead><tr><th scope="col">#</th><th scope="col" className="standings-team">{isDoubles ? 'Team' : 'Player'}</th><th scope="col">P</th><th scope="col">W</th><th scope="col">L</th><th scope="col">+/−</th></tr></thead>
    <tbody>{standings.map((row, index) => {
      const diff = row.pointsFor - row.pointsAgainst;
      return <tr key={row.team} className={row.qualified ? 'qualified' : ''}>
        <td className="standings-rank">{row.qualified ? `${pool}${index + 1}` : index + 1}</td>
        <td className="standings-team">{row.team}{row.qualified && <span className="q-badge">Q</span>}</td>
        <td>{row.played}</td><td>{row.won}</td><td>{row.lost}</td><td>{row.played ? (diff > 0 ? `+${diff}` : diff) : '–'}</td>
      </tr>;
    })}</tbody>
  </table>;
}

// Pools stack as one list rather than cards, so eight pools stay readable. Matches show by default; points open on demand.
function PoolsView({ pools, isDoubles }: { pools: PoolSummary[]; isDoubles: boolean }) {
  const [openPools, setOpenPools] = useState<Set<string>>(new Set());
  if (!pools.length) return <div className="empty-state">The pools appear here once the draw is made.</div>;
  const toggle = (pool: string) => setOpenPools((current) => { const next = new Set(current); if (next.has(pool)) next.delete(pool); else next.add(pool); return next; });
  return <>
    <p className="pools-note">Top {QUALIFIERS_PER_POOL} from each pool go through to the knockouts.</p>
    {pools.length > 3 && <nav className="pool-jump" aria-label="Jump to pool">{pools.map(({ pool }) => <a key={pool} href={`#pool-${pool}`} onClick={(e) => { e.preventDefault(); document.getElementById(`pool-${pool}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }}>{pool}</a>)}</nav>}
    <div className="pool-list">{pools.map((summary) => {
      const { pool, standings, played, total, complete } = summary;
      const open = openPools.has(pool);
      const qualifiers = standings.filter((row) => row.qualified);
      return <section key={pool} id={`pool-${pool}`} className="pool-group">
        <div className="pool-group-head"><span className="pool-name">Pool {pool}</span><small>{complete ? 'Complete' : `${played} of ${total} played`}</small><button type="button" className="pool-toggle" aria-expanded={open} onClick={() => toggle(pool)}>Points <ChevronDown size={14} /></button></div>
        {qualifiers.length > 0 && <p className="pool-qualifiers">Through: {qualifiers.map((row, i) => <span key={row.team}><b>{pool}{i + 1}</b> {row.team}</span>)}</p>}
        {open && <PoolStandings summary={summary} isDoubles={isDoubles} />}
        <PoolMatches summary={summary} />
      </section>;
    })}</div>
  </>;
}

function KnockoutView({ event, info }: { event: EventData; info: EventInfo }) {
  if (!event.rounds.length) return <div className="empty-state">The knockout draw appears here once the pools are done.</div>;
  return <Bracket rounds={event.rounds} kind={info.kind} courtLabel={event.courtLabel} title={info.label} />;
}

// One plaque per event: ink, gold trim, the names engraved. Doubles partners each get a line.
function WinnersView({ champion, info }: { champion: string | null; info: EventInfo }) {
  const players = champion ? champion.split(' & ') : [];
  return <>
    <div className={`champion-card ${champion ? '' : 'is-pending'}`}>
      <div className="champion-trophy"><Trophy size={28} strokeWidth={1.6} /></div>
      <p className="champion-label">{champion ? `${info.label} champion${players.length > 1 ? 's' : ''}` : `${info.label} · Champion`}</p>
      <h3 className="champion-name">{players.length
        ? players.map((player, i) => <Fragment key={player}>{i > 0 && <span className="champion-amp">&amp;</span>}<span className="champion-player">{player}</span></Fragment>)
        : 'To be decided'}</h3>
      {!champion && <><div className="champion-rule" /><p className="champion-foot">Decided at the final</p></>}
    </div>
    {!champion && <p className="podium-note">Results appear here as soon as the final is played.</p>}
  </>;
}

function GalleryView({ photos }: { photos: GalleryPhoto[] }) {
  const [open, setOpen] = useState<number | null>(null);
  useEffect(() => {
    if (open === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(null);
      if (e.key === 'ArrowRight') setOpen((i) => (i === null ? i : (i + 1) % photos.length));
      if (e.key === 'ArrowLeft') setOpen((i) => (i === null ? i : (i - 1 + photos.length) % photos.length));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, photos.length]);
  if (!photos.length) return <div className="gallery-empty"><Camera size={24} /><h3>Photos are on their way</h3><p>Check back after match day.</p></div>;
  const current = open === null ? null : photos[open];
  return <>
    <div className="gallery-grid">{photos.map((photo, index) => <button type="button" className="gallery-item" key={photo.src} onClick={() => setOpen(index)}><img src={photo.src} alt={photo.caption} loading="lazy" decoding="async" /></button>)}</div>
    {current && <div className="lightbox" role="dialog" aria-modal="true" aria-label={current.caption || 'Photo'} onClick={() => setOpen(null)}>
      <button type="button" className="lightbox-close" aria-label="Close" onClick={() => setOpen(null)}><X size={22} /></button>
      <figure onClick={(e) => e.stopPropagation()}><img src={current.src} alt={current.caption} />{current.caption && <figcaption>{current.caption}</figcaption>}</figure>
    </div>}
  </>;
}

function TournamentPage() {
  const { slug } = Route.useParams();
  // Keyed by event so switching events starts back on the Pools tab.
  return <EventPage key={slug} />;
}

function EventPage() {
  const { event, fetchedAt } = Route.useLoaderData();
  const { slug } = Route.useParams();
  useAutoRefresh(LIVE_REFRESH_MS);
  const [tab, setTab] = useState<Tab>('Pools');
  const info = eventInfo(slug);
  if (!info) return null;
  const empty: EventData = { slug: info.slug, pools: [], rounds: [], champion: null, gallery: [] };
  const data = event ?? empty;
  return <>
    <section className="t-intro section-shell">
      <Link to="/" hash="events" className="back-link"><ArrowLeft size={16} /> All events</Link>
      <p className="eyebrow">Event {info.shortLabel}</p>
      <h1>{info.label}<span>.</span></h1>
      <div className="t-meta"><p className="t-prize">Prize <strong>{info.prize}</strong></p><RefreshButton fetchedAt={fetchedAt} /></div>
    </section>
    <div className="tabs-bar"><div className="tabs section-shell" role="tablist" aria-label="Event sections">{TABS.map((item) => <button className={tab === item ? 'tab-active' : ''} key={item} onClick={() => setTab(item)} role="tab" aria-selected={tab === item}>{item}</button>)}</div></div>
    <section className="t-content section-shell">
      {tab === 'Pools' && <PoolsView pools={data.pools} isDoubles={info.kind === 'doubles'} />}
      {tab === 'Knockouts' && <KnockoutView event={data} info={info} />}
      {tab === 'Winners' && <WinnersView champion={data.champion} info={info} />}
      {tab === 'Gallery' && <GalleryView photos={data.gallery} />}
    </section>
    <section className="t-more section-shell"><p className="eyebrow">Other events</p><div className="t-more-links">{EVENTS.filter((e) => e.slug !== slug).map((e) => <Link key={e.slug} to="/tournaments/$slug" params={{ slug: e.slug }}>{e.label} <ArrowUpRight size={16} /></Link>)}</div></section>
  </>;
}
