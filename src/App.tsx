import { useMemo, useState } from 'react';
import { ArrowDown, ArrowUpRight, CircleDot, Search, Trophy } from 'lucide-react';
import { eventMeta, getEventMatches, getEventTeams, getPlayerMatches } from '@/data/tournamentApi';
import type { EventKey, MatchRow } from '@/data/tournamentData';

const eventOrder: EventKey[] = ['mens-singles', 'mens-doubles', 'mixed-doubles', 'womens-doubles'];
type EventTab = 'Matches' | 'Pools' | 'Knockouts' | 'Winners';

function StatusPill({ status }: { status: MatchRow['status'] }) {
  return <span className={`status status-${status.toLowerCase()}`}>{status === 'Live' && <CircleDot size={11} />}{status}</span>;
}

function MatchRowView({ match }: { match: MatchRow }) {
  return (
    <article className={`match-row ${match.status === 'Live' ? 'match-live' : ''}`}>
      <div className="match-time"><strong>{match.scheduledTime}</strong><span>{match.court}</span></div>
      <div className="match-stage"><span>{match.round}</span><small>{match.stage === 'Pool' ? `Pool ${match.pool}` : 'Knockout stage'}</small></div>
      <div className="match-teams"><div className={match.recordedWinner === match.teamA ? 'winner' : ''}>{match.teamA}</div><div className={match.recordedWinner === match.teamB ? 'winner' : ''}>{match.teamB}</div></div>
      <div className="match-score">{match.scoreA && <div>{match.scoreA}</div>}{match.scoreB && <div>{match.scoreB}</div>}{!match.scoreA && <span>—</span>}</div>
      <StatusPill status={match.status} />
    </article>
  );
}

function PoolView({ event }: { event: EventKey }) {
  const eventTeams = getEventTeams(event);
  const eventMatches = getEventMatches(event).filter((match) => match.stage === 'Pool');
  const pools = [...new Set(eventTeams.map((team) => team.pool))];
  return <div className="pool-grid">{pools.map((pool) => {
    const poolTeams = eventTeams.filter((team) => team.pool === pool);
    return <div className="pool-card" key={pool}><div className="pool-heading"><span>Pool {pool}</span><small>{poolTeams.length} teams</small></div><div className="pool-teams">{poolTeams.map((team, index) => <div className="pool-team" key={team.teamId}><span>{String(index + 1).padStart(2, '0')}</span>{team.displayName}<b>—</b></div>)}</div><div className="pool-result"><span>Pool matches</span><strong>{eventMatches.filter((match) => match.pool === pool).length} recorded</strong></div></div>;
  })}</div>;
}

function KnockoutView({ event }: { event: EventKey }) {
  const knockoutMatches = getEventMatches(event).filter((match) => match.stage !== 'Pool');
  const rounds = ['Semi-final', 'Final'];
  return <div className="bracket">{rounds.map((round) => <div className="bracket-round" key={round}><div className="bracket-label">{round}</div>{knockoutMatches.filter((match) => match.stage === round).map((match) => <div className="bracket-match" key={match.matchId}><div><span>{match.teamA}</span><span>{match.teamB}</span></div><div className="bracket-score"><span>{match.scoreA ?? '—'}</span><span>{match.scoreB ?? '—'}</span></div><small>{match.scheduledTime} · {match.court}</small></div>)}</div>)}</div>;
}

function WinnersView({ event }: { event: EventKey }) {
  const final = getEventMatches(event).find((match) => match.stage === 'Final');
  const winner = final?.recordedWinner;
  return <div className="winners-state"><div className="winner-mark"><Trophy size={28} strokeWidth={1.5} /></div><div><span>{winner ? 'Champion' : 'Final results pending'}</span><h3>{winner ?? 'The best is yet to be decided.'}</h3><p>{winner ? 'Recorded winner' : 'Results will appear here once the final has been played.'}</p></div></div>;
}

function EventDetail({ event }: { event: EventKey }) {
  const [tab, setTab] = useState<EventTab>('Matches');
  const meta = eventMeta[event];
  const eventMatches = getEventMatches(event);
  return <div className="event-detail"><div className="event-detail-head"><div><span className="eyebrow">Event {meta.shortLabel}</span><h3>{meta.label}</h3></div><span className="prize-note">Prize pool <strong>{meta.prize}</strong></span></div><div className="tabs" role="tablist">{(['Matches', 'Pools', 'Knockouts', 'Winners'] as EventTab[]).map((item) => <button className={tab === item ? 'tab-active' : ''} key={item} onClick={() => setTab(item)} role="tab" aria-selected={tab === item}>{item}</button>)}</div>{tab === 'Matches' && <div className="matches-list">{eventMatches.map((match) => <MatchRowView key={match.matchId} match={match} />)}</div>}{tab === 'Pools' && <PoolView event={event} />}{tab === 'Knockouts' && <KnockoutView event={event} />}{tab === 'Winners' && <WinnersView event={event} />}</div>;
}

function App() {
  const [selectedEvent, setSelectedEvent] = useState<EventKey>('mens-singles');
  const [searchQuery, setSearchQuery] = useState('');
  const [showAllSearch, setShowAllSearch] = useState(false);
  const searchResults = useMemo(() => getPlayerMatches(searchQuery), [searchQuery]);
  const visibleSearchResults = showAllSearch ? searchResults : searchResults.slice(0, 3);

  const scrollTo = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' });

  return <main>
    <nav className="top-nav"><a className="brand" href="#top" aria-label="The Baddy Club home"><span className="brand-badge">the<br /><b>baddy</b><br />club</span><span className="brand-x">×</span><span className="brand-district">district<br /><b>play</b></span></a><div className="nav-links"><a href="#events">Tournaments</a><a href="#search">Find a match</a></div><button className="nav-cta" onClick={() => scrollTo('events')}>Explore <ArrowUpRight size={15} /></button></nav>
    <section className="hero" id="top">
      <div className="hero-copy"><p className="kicker"><span>Sun, 1 Nov · 8:30 AM</span> District Play Racquet Club, Koramangala</p><h1><span>The Baddy Club</span><em>× District Play Open</em></h1><p className="hero-subtitle">Round robin → Knockout stages</p><div className="hero-actions"><button className="primary-button" onClick={() => scrollTo('events')}>View the draw <ArrowDown size={17} /></button><button className="secondary-button" onClick={() => scrollTo('search')}>Find my matches <Search size={15} /></button></div></div>
    </section>
    <section className="intro section-shell"><div className="section-index">[ 01 ]</div><div className="intro-copy"><p className="eyebrow">The open</p><h2>Built for the rally.<br /><i>Made for the club.</i></h2><p>The Baddy Club × District Play Open is a one-day celebration of competitive badminton in Bengaluru. Four formats, a round robin start, and everything to play for.</p></div><div className="intro-aside"><span>01—11—26</span><strong>Koramangala<br />Bengaluru</strong><small>Bring your partner.<br />Or come solo.</small></div></section>
    <section className="tournaments section-shell" id="events"><div className="section-top"><div><p className="eyebrow">The draw</p><h2>Tournaments</h2></div><span className="section-note">Four events<br />One open court</span></div><div className="event-list">{eventOrder.map((event, index) => <button className={`event-row ${selectedEvent === event ? 'event-selected' : ''}`} key={event} onClick={() => setSelectedEvent(event)}><span className="event-num">0{index + 1}</span><span className="event-name">{eventMeta[event].label}</span><span className="event-prize">{eventMeta[event].prize}</span><ArrowUpRight className="event-arrow" size={21} /></button>)}</div><EventDetail event={selectedEvent} /></section>
    <section className="search-section section-shell" id="search"><div className="search-heading"><p className="eyebrow">Your match day</p><h2>Find your matches.</h2><p>Search by player name to see every fixture across the open.</p></div><div className="search-box"><Search size={20} /><input aria-label="Find your matches by player name" placeholder="Search player name" value={searchQuery} onChange={(event) => { setSearchQuery(event.target.value); setShowAllSearch(false); }} /><span>{searchQuery ? `${searchResults.length} found` : 'Across 4 events'}</span></div>{searchQuery && <div className="search-results">{visibleSearchResults.map((match) => <MatchRowView key={match.matchId} match={match} />)}{searchResults.length === 0 && <div className="empty-state">No matches found for “{searchQuery}”. Try a first or last name.</div>}{searchResults.length > 3 && !showAllSearch && <button className="text-button" onClick={() => setShowAllSearch(true)}>Show all {searchResults.length} matches <ArrowUpRight size={15} /></button>}</div>}</section>
    <section className="closing-banner"><div className="closing-mark">B<span>×</span>D</div><p>See you on court.</p><strong>01.11.26</strong></section>
    <footer><div className="footer-brand">the <strong>baddy club</strong> × district play</div><span>District Play Racquet Club, Koramangala</span><span>Sunday, 1 November · 8:30 AM onwards</span></footer>
  </main>;
}

export default App;
