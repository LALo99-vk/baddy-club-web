/**
 * Splitting a draw into readable brackets.
 *
 * A knockout draw is not really one tree — the top quarter never meets the
 * bottom quarter until the quarter-finals, so a big draw is several complete
 * brackets that join at the end. Chess opens with 32 simultaneous matches,
 * which is a wall; split into four sections it is four readable brackets of
 * eight. Small tournaments come out as a single section and render exactly as
 * they always have.
 */
import type { BracketMatch, BracketRound, BracketSlot } from "@/data/bracket";

/** Above this a column of cards stops reading as a bracket. */
const MAX_COLUMN = 12;
/** What each section's biggest column should come in under. */
const TARGET_COLUMN = 16;
/** How many ways a draw may be cut, fewest first. */
const SECTION_COUNTS = [2, 4, 8];

export const isByeMatch = (match: BracketMatch) => Boolean(match.a.bye || match.b.bye);

export const slotLabel = (slot: BracketSlot) =>
  slot.players?.length ? slot.players.join(" & ") : slot.bye ? "Bye" : (slot.source ?? "");

export const searchText = (match: BracketMatch) =>
  [
    `m${match.matchNumber}`,
    slotLabel(match.a),
    slotLabel(match.b),
    match.a.group ?? "",
    match.b.group ?? "",
    match.court ?? "",
    match.time,
  ]
    .join(" ")
    .toLowerCase();

export type Section = { name: string; rounds: BracketRound[]; endsInChampion: boolean };

/**
 * Every match that feeds into this one, however far back, following the
 * sheet's own "Winner Match N" references.
 */
function ancestorsOf(match: BracketMatch, byNumber: Map<number, BracketMatch>): Set<number> {
  const found = new Set<number>([match.matchNumber]);
  const queue = [match];
  while (queue.length) {
    const current = queue.pop() as BracketMatch;
    for (const feeder of [current.a.fromMatch, current.b.fromMatch]) {
      if (feeder === undefined || found.has(feeder)) continue;
      const parent = byNumber.get(feeder);
      if (!parent) continue;
      found.add(feeder);
      queue.push(parent);
    }
  }
  return found;
}

/** Keeps only the named matches, dropping rounds left with nothing in them. */
const restrict = (rounds: BracketRound[], keep: Set<number>): BracketRound[] =>
  rounds
    .map((round) => ({
      ...round,
      matches: round.matches.filter((match) => keep.has(match.matchNumber)),
    }))
    .filter((round) => round.matches.length > 0);

const widestColumn = (rounds: BracketRound[]) =>
  rounds.reduce((max, round) => Math.max(max, round.matches.length), 0);

/** Halves and quarters of a draw have names people already know. */
function sectionName(count: number, index: number) {
  if (count === 2) return index === 0 ? "Top half" : "Bottom half";
  if (count === 4) return `Quarter ${index + 1}`;
  return `Section ${index + 1}`;
}

/** Cuts the draw at the round where `count` matches meet. */
function cutInto(rounds: BracketRound[], count: number): Section[] | null {
  const splitAt = rounds.findIndex((round) => round.matches.length === count);
  if (splitAt <= 0) return null;

  const byNumber = new Map(
    rounds.flatMap((round) => round.matches.map((match) => [match.matchNumber, match] as const)),
  );
  // The converging round belongs to both: it is the endpoint of its section
  // and the opening column of the closing bracket, exactly as a printed draw
  // sheet repeats it.
  const feeding = rounds.slice(0, splitAt + 1);
  // The closing bracket opens one round earlier than the split, so it shows the
  // quarter-finals feeding the semis rather than starting cold on two matches.
  const closing = rounds.slice(Math.max(0, splitAt - 1));

  const sections = (rounds[splitAt] as BracketRound).matches.map((match, i) => ({
    name: sectionName(count, i),
    rounds: restrict(feeding, ancestorsOf(match, byNumber)),
    endsInChampion: false,
  }));

  return [...sections, { name: "Finals", rounds: closing, endsInChampion: true }];
}

export function buildSections(rounds: BracketRound[]): Section[] {
  const whole: Section[] = [{ name: "Bracket", rounds, endsInChampion: true }];
  if (!rounds.length || widestColumn(rounds) <= MAX_COLUMN) return whole;

  // Byes are rarely spread evenly through a draw — chess bunches all 45 of them
  // at the end of round 1 — so a quarter of the matches is not a quarter of the
  // cards. Measure each cut rather than assuming it divides evenly, and take
  // the fewest sections that actually reads.
  let fallback: Section[] | null = null;
  for (const count of SECTION_COUNTS) {
    const candidate = cutInto(rounds, count);
    if (!candidate || !showsEveryMatch(rounds, candidate)) continue;
    fallback = candidate;
    if (Math.max(...candidate.map((section) => widestColumn(section.rounds))) <= TARGET_COLUMN) {
      return candidate;
    }
  }

  return fallback ?? whole;
}

/**
 * Sections are found by following each match back to the ones feeding it, so a
 * match nothing points at would simply vanish. Rather than quietly hide a
 * fixture, fall back to showing the draw whole — a long bracket is a far
 * smaller problem than a missing match.
 */
function showsEveryMatch(rounds: BracketRound[], sections: Section[]): boolean {
  const shown = new Set(
    sections.flatMap((section) =>
      section.rounds.flatMap((round) => round.matches.map((match) => match.matchNumber)),
    ),
  );
  return rounds.every((round) => round.matches.every((match) => shown.has(match.matchNumber)));
}
