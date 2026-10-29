// Types the knockout ladder (src/components/bracket.tsx, shared with the Bright site) is written against.

export type MatchStatus = 'upcoming' | 'live' | 'completed' | 'cancelled' | 'noshow';

/** How participants are shown in the bracket. */
export type ParticipantKind = 'team' | 'singles' | 'doubles';

export type BracketSlot = {
  /** The player (singles) or both players (doubles). `null` until the feeding match has been decided. */
  players: string[] | null;
  /** Bright's house code. This tournament has no houses, so it stays unset. */
  group?: string | undefined;
  /** Shown while `players` is null, e.g. "Winner Pool A" or "Winner Match 7". */
  source?: string | undefined;
  /** Match number this slot is fed by, when the sheet said "Winner Match 3". */
  fromMatch?: number | undefined;
  /** This side is a bye: the sheet left no opponent here. */
  bye?: boolean | undefined;
  /** The player reached this slot on a bye rather than by winning. */
  viaBye?: boolean | undefined;
  score?: number | string | null | undefined;
};

export type BracketMatch = {
  id: string;
  matchNumber: number;
  status: MatchStatus;
  time: string;
  court?: string | undefined;
  a: BracketSlot;
  b: BracketSlot;
  winner?: 'a' | 'b' | null | undefined;
};

export type BracketRound = {
  name: string;
  matches: BracketMatch[];
};

/** One of Bright's houses. Kept so the shared sheet parser type-checks; this tournament has none. */
export type Group = { code: string; name: string; color: string };

/** Bright colours slots by house. There are no houses here, so nothing is ever found. */
export function getGroup(_code: string | undefined | null): Group | undefined {
  return undefined;
}
