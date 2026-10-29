// What the server sends each page. Shared by the sheet loader and the routes.
import type { BracketRound } from '@/data/bracket';
import type { EventKey } from '@/data/event';

export type PoolMatchStatus = 'upcoming' | 'live' | 'completed' | 'cancelled' | 'noshow';

export type PoolMatch = {
  matchNumber: number;
  teamA: string;
  teamB: string;
  scoreA: string | null;
  scoreB: string | null;
  court: string;
  time: string;
  status: PoolMatchStatus;
  winner: 'a' | 'b' | null;
};

export type StandingRow = {
  team: string;
  played: number;
  won: number;
  lost: number;
  pointsFor: number;
  pointsAgainst: number;
  qualified: boolean;
};

export type PoolSummary = {
  pool: string;
  standings: StandingRow[];
  matches: PoolMatch[];
  played: number;
  total: number;
  complete: boolean;
};

export type GalleryPhoto = { src: string; caption: string };

export type EventData = {
  slug: EventKey;
  pools: PoolSummary[];
  rounds: BracketRound[];
  /** "Court", from the sheet's court column header; the ladder puts it before the number. */
  courtLabel?: string | undefined;
  champion: string | null;
  gallery: GalleryPhoto[];
};
