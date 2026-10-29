/**
 * Round-robin pools. Bright never had these: its parser reads every row of a
 * draw tab as a knockout round. Here one event tab holds both stages, so pool
 * rows are split off first, played out as a round robin, and only the
 * knockout rows go on to Bright's ladder parser.
 *
 * A knockout cell may name a pool place ("Winner Pool A", "Runner-up Pool B",
 * "A1"). Once that pool is complete the cell is swapped for the team's name
 * before the ladder is parsed, so the desk never copies qualifiers by hand.
 */
import type { BracketRound } from "@/data/bracket";
import { QUALIFIERS_PER_POOL } from "@/data/event";
import type { PoolMatch, PoolSummary, StandingRow } from "@/data/tournament";
import {
  buildColumnMap,
  courtLabelFrom,
  fillDown,
  normalizeHeader,
  normalizeStatus,
  splitCombinedScore,
  type ColumnMap,
  type ParseWarning,
  type SheetGrid,
} from "./parse";

/** "Pool A", "pool-b", "Group C" -> "A", "B", "C". */
export function poolOf(roundCell: string): string | null {
  const match = roundCell.trim().match(/^(?:pool|group)\s*[-:]?\s*([a-z0-9]{1,3})$/i);
  return match?.[1] ? match[1].toUpperCase() : null;
}

/** "Winner Pool A" / "1st Pool A" / "A1" -> place 1 of pool A; "Runner-up Pool B" / "B2" -> place 2 of B. */
export function parsePoolPlace(value: string): { pool: string; place: number } | null {
  const text = value.trim();
  const named = text.match(
    /^(winner|1st|first|top|runner[\s-]*up|2nd|second)\s*(?:of\s*)?(?:pool|group)\s*([a-z0-9]{1,3})$/i,
  );
  if (named?.[1] && named[2]) {
    const first = /^(winner|1st|first|top)$/i.test(named[1]);
    return { pool: named[2].toUpperCase(), place: first ? 1 : 2 };
  }
  // "A1" / "B2". W and L are left out: Bright reads "W1" and "L1" as the winner
  // or loser of match 1.
  const short = text.match(/^([a-km-vx-z])\s*([1-9])$/i);
  if (short?.[1] && short[2]) return { pool: short[1].toUpperCase(), place: Number(short[2]) };
  return null;
}

const cell = (row: string[], index: number | undefined) =>
  index === undefined ? "" : (row[index] ?? "").replace(/\s+/g, " ").trim();

const sameTeam = (a: string, b: string) => normalizeHeader(a) === normalizeHeader(b);

/** Splits an event tab into its pool rows and a grid of just the knockout rows (header kept). */
export function splitEventTab(grid: SheetGrid): { poolRows: { row: string[]; sheetRow: number; pool: string }[]; knockout: SheetGrid; columns: ColumnMap } {
  const header = grid[0] ?? [];
  const columns = buildColumnMap(header);
  const body = fillDown(grid.slice(1), [columns.timing, columns.day, columns.board]);
  const poolRows: { row: string[]; sheetRow: number; pool: string }[] = [];
  const knockout: SheetGrid = [header];
  body.forEach((row, index) => {
    const pool = poolOf(cell(row, columns.round));
    if (pool) poolRows.push({ row, sheetRow: index + 2, pool });
    else knockout.push(row);
  });
  return { poolRows, knockout, columns };
}

/** Sum of every game in a "21, 18, 21" cell. */
const gamePoints = (score: string | null) =>
  (score ?? "").split(/[,;]/).reduce((total, game) => total + (Number.parseInt(game, 10) || 0), 0);

function readPoolMatch(
  tab: string,
  entry: { row: string[]; sheetRow: number },
  columns: ColumnMap,
  courtLabel: string | undefined,
  fallbackNumber: number,
  warnings: ParseWarning[],
): PoolMatch | null {
  const { row, sheetRow } = entry;
  const teamA = cell(row, columns.team1);
  const teamB = cell(row, columns.team2);
  if (!teamA || !teamB) {
    warnings.push({ tab, row: sheetRow, message: "Pool match needs both teams." });
    return null;
  }

  let scoreA = cell(row, columns.score1) || null;
  let scoreB = cell(row, columns.score2) || null;
  if (!scoreA && !scoreB) {
    const combined = splitCombinedScore(cell(row, columns.score));
    if (combined) [scoreA, scoreB] = combined;
  }

  const winnerCell = cell(row, columns.winner);
  let winner: PoolMatch["winner"] = null;
  if (winnerCell) {
    if (winnerCell === "1" || normalizeHeader(winnerCell) === "team1" || sameTeam(winnerCell, teamA)) winner = "a";
    else if (winnerCell === "2" || normalizeHeader(winnerCell) === "team2" || sameTeam(winnerCell, teamB)) winner = "b";
    else warnings.push({ tab, row: sheetRow, message: `Winner "${winnerCell}" doesn't match either team.` });
  }

  // As on Bright, a recorded winner settles the match even if Status still says Live.
  const status = winner ? "completed" : (normalizeStatus(cell(row, columns.status)) ?? "upcoming");
  if (status === "completed" && !winner) {
    warnings.push({ tab, row: sheetRow, message: "Marked completed but has no winner, so it doesn't count yet." });
  }

  const number = Number.parseInt(cell(row, columns.matchNo), 10);
  const courtCell = cell(row, columns.board);
  const court = courtCell && /^\d+$/.test(courtCell) && courtLabel ? `${courtLabel} ${courtCell}` : courtCell;
  const time = [cell(row, columns.day), cell(row, columns.timing)].filter(Boolean).join(" · ");

  return {
    matchNumber: Number.isFinite(number) ? number : fallbackNumber,
    teamA,
    teamB,
    scoreA,
    scoreB,
    court,
    time,
    status,
    winner: status === "completed" ? winner : null,
  };
}

const diff = (row: StandingRow) => row.pointsFor - row.pointsAgainst;

/**
 * Wins, then head-to-head when exactly two teams share a win count, then points
 * difference, then points scored. A three-way tie goes straight to points
 * difference, since head-to-head is circular there.
 * Not confirmed by the organiser yet — see the project notes before relying on it.
 */
function rank(rows: StandingRow[], matches: PoolMatch[], order: string[]): StandingRow[] {
  const sorted = [...rows].sort(
    (a, b) => b.won - a.won || diff(b) - diff(a) || b.pointsFor - a.pointsFor || order.indexOf(a.team) - order.indexOf(b.team),
  );
  for (let i = 0; i < sorted.length - 1; i++) {
    const first = sorted[i];
    const second = sorted[i + 1];
    if (!first || !second || first.won !== second.won) continue;
    if (sorted.filter((row) => row.won === first.won).length !== 2) continue;
    const meeting = matches.find(
      (m) => m.status === "completed" && [m.teamA, m.teamB].some((t) => sameTeam(t, first.team)) && [m.teamA, m.teamB].some((t) => sameTeam(t, second.team)),
    );
    const winner = meeting ? (meeting.winner === "a" ? meeting.teamA : meeting.teamB) : null;
    if (winner && sameTeam(winner, second.team)) [sorted[i], sorted[i + 1]] = [second, first];
  }
  return sorted;
}

/** Every pool on the tab, its matches in sheet order and its standings. */
export function buildPools(
  tab: string,
  poolRows: { row: string[]; sheetRow: number; pool: string }[],
  columns: ColumnMap,
  header: string[],
  warnings: ParseWarning[],
): PoolSummary[] {
  const courtLabel = columns.board === undefined ? undefined : courtLabelFrom(header[columns.board] ?? "");
  const byPool = new Map<string, PoolMatch[]>();
  poolRows.forEach((entry, index) => {
    const match = readPoolMatch(tab, entry, columns, courtLabel, index + 1, warnings);
    if (!match) return;
    byPool.set(entry.pool, [...(byPool.get(entry.pool) ?? []), match]);
  });

  return [...byPool.entries()]
    .sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }))
    .map(([pool, matches]) => {
      // Teams in the order they first appear, spelt as the sheet first spells them.
      const teams: string[] = [];
      for (const m of matches) for (const t of [m.teamA, m.teamB]) if (!teams.some((known) => sameTeam(known, t))) teams.push(t);

      const rows = teams.map((team): StandingRow => {
        const row: StandingRow = { team, played: 0, won: 0, lost: 0, pointsFor: 0, pointsAgainst: 0, qualified: false };
        for (const m of matches) {
          if (m.status !== "completed" || !m.winner) continue;
          const side = sameTeam(m.teamA, team) ? "a" : sameTeam(m.teamB, team) ? "b" : null;
          if (!side) continue;
          row.played += 1;
          if (m.winner === side) row.won += 1;
          else row.lost += 1;
          row.pointsFor += gamePoints(side === "a" ? m.scoreA : m.scoreB);
          row.pointsAgainst += gamePoints(side === "a" ? m.scoreB : m.scoreA);
        }
        return row;
      });

      const total = (teams.length * (teams.length - 1)) / 2;
      if (matches.length !== total) {
        warnings.push({ tab, row: null, message: `Pool ${pool} has ${teams.length} teams but ${matches.length} matches; a full round robin needs ${total}.` });
      }
      // Cancelled and no-show matches count as settled so a pool can still finish.
      const settled = matches.filter((m) => m.status === "completed" || m.status === "cancelled" || m.status === "noshow").length;
      const complete = total > 0 && settled >= total;
      const standings = rank(rows, matches, teams).map((row, i) => ({ ...row, qualified: complete && i < QUALIFIERS_PER_POOL }));
      return { pool, standings, matches, played: matches.filter((m) => m.status === "completed").length, total, complete };
    });
}

/** Swaps pool-place cells in the knockout rows for the qualifier, once that pool is complete. */
export function fillPoolPlaces(knockout: SheetGrid, columns: ColumnMap, pools: PoolSummary[]): SheetGrid {
  const resolve = (value: string) => {
    const place = parsePoolPlace(value);
    if (!place) return value;
    const pool = pools.find((p) => p.pool === place.pool);
    if (!pool?.complete) return value;
    return pool.standings[place.place - 1]?.team ?? value;
  };
  return knockout.map((row, index) => {
    if (index === 0) return row;
    const copy = [...row];
    for (const col of [columns.team1, columns.team2, columns.winner]) {
      if (col !== undefined && copy[col]) copy[col] = resolve(copy[col] ?? "");
    }
    return copy;
  });
}

/** Spelt out for the page, however the sheet wrote it: "A1" -> "Winner Pool A", "B2" -> "Runner-up Pool B". */
export function poolPlaceLabel({ pool, place }: { pool: string; place: number }): string {
  if (place === 1) return `Winner Pool ${pool}`;
  if (place === 2) return `Runner-up Pool ${pool}`;
  return `Pool ${pool} · #${place}`;
}

/**
 * Bright's parser reads an unresolved "Winner Pool A" as a player's name. Turn
 * those back into waiting slots so the ladder shows them in italics, not bold.
 */
export function markPoolPlaceholders(rounds: BracketRound[]): BracketRound[] {
  return rounds.map((round) => ({
    ...round,
    matches: round.matches.map((match) => {
      const fix = (slot: typeof match.a) => {
        const only = slot.players?.length === 1 ? slot.players[0] : undefined;
        const place = only ? parsePoolPlace(only) : null;
        return place ? { ...slot, players: null, source: poolPlaceLabel(place) } : slot;
      };
      return { ...match, a: fix(match.a), b: fix(match.b) };
    }),
  }));
}
