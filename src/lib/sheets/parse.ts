/**
 * Turns raw Google Sheet rows into the exact shapes the bracket UI already
 * renders. Deliberately forgiving: the business team should be able to reorder
 * columns, merge cells, add their own working columns and make the odd typo
 * without the site breaking. Anything it can't understand becomes a warning,
 * never an exception.
 */
import type {
  BracketMatch,
  BracketRound,
  BracketSlot,
  Group,
  MatchStatus,
  ParticipantKind,
} from "@/data/bracket";

/** A tab straight from the Sheets API: row 0 is the header. */
export type SheetGrid = string[][];

export type ParseWarning = { tab: string; row: number | null; message: string };

/* ------------------------------------------------------------------ *
 * Header matching
 * ------------------------------------------------------------------ */

/** "Team / Player 1" -> "teamplayer1", so spacing and punctuation don't matter. */
export function normalizeHeader(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

type MatchField =
  | "matchNo"
  | "round"
  | "group1"
  | "team1"
  | "group2"
  | "team2"
  | "score1"
  | "score2"
  | "score"
  | "board"
  | "timing"
  | "day"
  | "winner"
  | "status";

const MATCH_HEADERS: Record<MatchField, string[]> = {
  matchNo: ["matchno", "matchnumber", "match", "matchid", "no", "sno", "slno", "srno", "s", "id"],
  round: ["round", "stage", "roundname"],
  group1: ["team1house", "group1", "house1", "team1group", "side1group", "groupa", "housea"],
  team1: ["team1", "teamplayer1", "player1", "side1", "teama", "participant1", "playera"],
  group2: ["team2house", "group2", "house2", "team2group", "side2group", "groupb", "houseb"],
  team2: ["team2", "teamplayer2", "player2", "side2", "teamb", "participant2", "playerb"],
  score1: ["score1", "scorea", "points1", "team1score", "player1score"],
  score2: ["score2", "scoreb", "points2", "team2score", "player2score"],
  // A single column holding both, e.g. "21-14".
  score: ["score", "scores", "finalscore", "points", "scoreline"],
  board: [
    "board",
    "boardnumber",
    "boardno",
    "boardnum",
    "court",
    "courtnumber",
    "table",
    "tablenumber",
    "pitch",
    "lane",
    "ground",
    "venue",
  ],
  timing: ["timing", "time", "slot", "matchtime"],
  day: ["day", "date", "matchday"],
  winner: ["winner", "won", "result", "winningteam", "winnerteam"],
  status: ["status", "state", "live", "matchstatus"],
};

export type ColumnMap = Partial<Record<MatchField, number>>;

/**
 * Maps each known field to its column index. Unrecognised columns are ignored,
 * so the team can keep their own scratch columns in the sheet.
 */
export function buildColumnMap(header: string[]): ColumnMap {
  const map: ColumnMap = {};
  header.forEach((raw, index) => {
    const key = normalizeHeader(raw ?? "");
    if (!key) return;
    for (const [field, aliases] of Object.entries(MATCH_HEADERS) as [MatchField, string[]][]) {
      if (map[field] === undefined && aliases.includes(key)) {
        map[field] = index;
        return;
      }
    }
  });
  // The live carrom sheet heads its match-number column with "$", which
  // normalises to nothing. Fall back to column A when it looks numeric.
  if (map.matchNo === undefined && map.round !== undefined && map.round > 0) {
    map.matchNo = 0;
  }
  return map;
}

/**
 * The word the sheet chose for where a match is played — "Board number" gives
 * "Board", "Court No" gives "Court". Chess plays on boards, badminton on
 * courts; carrying the team's own word through beats guessing.
 */
export function courtLabelFrom(header: string): string | undefined {
  const first = header
    .trim()
    .split(/[^A-Za-z]+/)
    .filter(Boolean)[0];
  if (!first) return undefined;
  return first.charAt(0).toUpperCase() + first.slice(1).toLowerCase();
}

const cell = (row: string[], index: number | undefined) =>
  index === undefined ? "" : (row[index] ?? "").trim();

/* ------------------------------------------------------------------ *
 * Merged cells
 * ------------------------------------------------------------------ */

/**
 * A merged cell only reports its value on the first row it covers; every other
 * row comes back empty. The business team merges Timing and DAY across a block
 * of matches, so carry the last seen value downwards.
 */
export function fillDown(rows: SheetGrid, columns: (number | undefined)[]): SheetGrid {
  const last = new Map<number, string>();
  return rows.map((row) => {
    const copy = row.slice();
    for (const index of columns) {
      if (index === undefined) continue;
      const value = (copy[index] ?? "").trim();
      if (value) last.set(index, value);
      else if (last.has(index)) copy[index] = last.get(index) as string;
    }
    return copy;
  });
}

/* ------------------------------------------------------------------ *
 * Participants
 * ------------------------------------------------------------------ */

/** "Nihar Shah (RR) & RR-Guest Player (RR)" -> ["Nihar Shah", "RR-Guest Player"] */
export function splitPlayers(value: string): string[] {
  return value
    .split(/\s*(?:&|\+|\/|\band\b)\s*/i)
    .map((part) => part.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

/**
 * A row with no real opponent. The chess draw seeds 83 players, so 45 of them
 * sit out the first round against one of these.
 */
const BYE_CELLS = ["bye", "byes", "walkover", "wo", "noopponent", "none"];

export const isByeCell = (value: string) => BYE_CELLS.includes(normalizeHeader(value));

/**
 * Pulls a trailing "(RR)" house tag off a name. Used only as a fallback for
 * rows written before the Group columns existed.
 */
export function extractGroupTag(name: string): { name: string; group?: string } {
  const match = name.match(/\(([A-Za-z]{1,4})\)\s*$/);
  if (!match?.[1]) return { name: name.trim() };
  return { name: name.slice(0, match.index).trim(), group: match[1].toUpperCase() };
}

/* ------------------------------------------------------------------ *
 * Rounds
 * ------------------------------------------------------------------ */

const ROUND_ALIASES: { canonical: string; order: number; keys: string[] }[] = [
  { canonical: "Round 1", order: 1, keys: ["round1", "r1", "roundone", "preliminary", "prelims"] },
  {
    canonical: "Round 2",
    order: 2,
    keys: ["round2", "r2", "roundtwo"],
  },
  { canonical: "Round 3", order: 3, keys: ["round3", "r3", "roundthree"] },
  { canonical: "Round 4", order: 4, keys: ["round4", "r4", "roundfour"] },
  { canonical: "Round 5", order: 5, keys: ["round5", "r5", "roundfive"] },
  // Baddy: Men's Doubles sends 26 teams through, so its knockout opens with a Round of 32.
  { canonical: "Round of 32", order: 5.25, keys: ["roundof32", "r32", "last32"] },
  // Baddy: a 16-team knockout after the pools is called the Round of 16.
  {
    canonical: "Round of 16",
    order: 5.5,
    keys: ["roundof16", "r16", "last16", "prequarterfinals", "prequarters", "pqf"],
  },
  {
    canonical: "Quarter-Finals",
    order: 6,
    keys: ["quarterfinals", "quarterfinal", "quarters", "quarter", "qf"],
  },
  { canonical: "Semi-Finals", order: 7, keys: ["semifinals", "semifinal", "semis", "semi", "sf"] },
  { canonical: "Final", order: 8, keys: ["final", "finals", "grandfinal", "f"] },
  // Played off the ladder, so it sorts last rather than feeding anything.
  {
    canonical: "Third Place",
    order: 9,
    keys: [
      "thirdplace",
      "thirdplacematch",
      "thirdplaceplayoff",
      "3rdplace",
      "3rdplacematch",
      "bronze",
      "bronzematch",
      "playoff",
    ],
  },
];

export function normalizeRound(value: string) {
  const key = normalizeHeader(value);
  return ROUND_ALIASES.find((round) => round.keys.includes(key));
}

/* ------------------------------------------------------------------ *
 * Progression references
 * ------------------------------------------------------------------ */

/** Which side of an earlier match feeds this slot. */
export type SlotRef = { match: number; take: "winner" | "loser" };

/**
 * "Winner Match 1" / "Winner of M1" / "W1" -> the winner of match 1;
 * "Loser of Match 126" / "L126" -> its loser, which is how a third-place
 * play-off names its two entrants.
 */
export function parseSlotRef(value: string): SlotRef | null {
  const match = value
    .trim()
    .match(/^(w(?:inner)?|l(?:oser)?)\.?\s*(?:of\s*)?(?:match|m)?\s*#?\s*(\d+)$/i);
  if (!match?.[1] || !match[2]) return null;
  return {
    match: Number(match[2]),
    take: match[1].toLowerCase().startsWith("l") ? "loser" : "winner",
  };
}

function parseScore(value: string): number | string | null {
  if (!value) return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : value;
}

/**
 * Splits a single "21-14" / "21 - 14" / "21/14" cell into the two sides.
 * Returns null when the cell isn't a scoreline, so "2" or "Won" fall through.
 */
export function splitCombinedScore(value: string): [string, string] | null {
  const match = value.trim().match(/^(\S+)\s*[-–/:]\s*(\S+)$/);
  if (!match?.[1] || !match[2]) return null;
  return [match[1], match[2]];
}

export function normalizeStatus(value: string): MatchStatus | null {
  const key = normalizeHeader(value);
  if (!key) return null;
  if (["live", "inprogress", "ongoing", "playing", "started"].includes(key)) return "live";
  if (["completed", "complete", "done", "final", "finished", "played"].includes(key)) {
    return "completed";
  }
  if (["upcoming", "scheduled", "notstarted", "pending", "yettostart"].includes(key)) {
    return "upcoming";
  }
  // Called off before anyone played. The desk needs this because the only way
  // to record it until now was to empty the row, which broke the ladder.
  if (
    [
      "cancelled",
      "canceled",
      "cancel",
      "matchcancelled",
      "matchcanceled",
      "calledoff",
      "abandoned",
      "notplayed",
      "scratched",
      "void",
    ].includes(key)
  ) {
    return "cancelled";
  }
  // Somebody didn't turn up. Put whoever did in the Winner column and they go
  // through on a walkover; leave it empty and the tie simply stops here.
  if (
    [
      "noshow",
      "noshows",
      "noshowed",
      "didnotshow",
      "didntshow",
      "playerdidnotshow",
      "playersdidnotshow",
      "absent",
      "dns",
      "walkover",
      "wo",
      "forfeit",
      "forfeited",
    ].includes(key)
  ) {
    return "noshow";
  }
  return null;
}

/** True for a fixture that was never played out, however it is labelled. */
export const isStoppedStatus = (status: MatchStatus) =>
  status === "cancelled" || status === "noshow";

/* ------------------------------------------------------------------ *
 * Match rows
 * ------------------------------------------------------------------ */

type RawSide = {
  players: string[];
  group?: string | undefined;
  /** Set when the cell said "Winner Match 3" rather than naming anyone. */
  fromMatch?: number | undefined;
  /** Which half of that match feeds this slot. */
  take: "winner" | "loser";
  /** The cell said "Bye": nobody is coming, the other side goes through. */
  isBye: boolean;
  score: number | string | null;
};

type RawMatch = {
  matchNumber: number;
  round: string;
  roundOrder: number;
  sides: [RawSide, RawSide];
  board: string;
  day: string;
  timing: string;
  winnerCell: string;
  statusCell: string;
};

function readSide(row: string[], columns: ColumnMap, side: 1 | 2): RawSide {
  const raw = cell(row, side === 1 ? columns.team1 : columns.team2);
  const explicitGroup = cell(row, side === 1 ? columns.group1 : columns.group2);

  // Prefer the per-side columns; fall back to a single "21-14" column.
  const own = cell(row, side === 1 ? columns.score1 : columns.score2);
  const combined = own ? null : splitCombinedScore(cell(row, columns.score));
  const score = parseScore(own || (combined ? (side === 1 ? combined[0] : combined[1]) : ""));

  if (isByeCell(raw)) {
    return { players: [], take: "winner", isBye: true, score };
  }

  const ref = parseSlotRef(raw);
  if (ref !== null) {
    return { players: [], fromMatch: ref.match, take: ref.take, isBye: false, score };
  }

  const parts = splitPlayers(raw);
  const tagged = parts.map(extractGroupTag);
  const group =
    explicitGroup.toUpperCase() || tagged.find((entry) => entry.group)?.group || undefined;

  return {
    players: tagged.map((entry) => entry.name).filter(Boolean),
    group,
    take: "winner",
    isBye: false,
    score,
  };
}

/**
 * Reads one tournament tab into ordered rounds, resolving "Winner Match N"
 * references to the actual winners once those matches have a result.
 */
export function parseMatchTab(
  tab: string,
  grid: SheetGrid,
): { rounds: BracketRound[]; warnings: ParseWarning[]; courtLabel?: string | undefined } {
  const warnings: ParseWarning[] = [];
  const header = grid[0];
  if (!header) {
    warnings.push({ tab, row: null, message: "Tab is empty — no header row found." });
    return { rounds: [], warnings };
  }

  const columns = buildColumnMap(header);
  const courtLabel =
    columns.board === undefined ? undefined : courtLabelFrom(header[columns.board] ?? "");

  for (const required of ["round", "team1", "team2"] as const) {
    if (columns[required] === undefined) {
      warnings.push({
        tab,
        row: 1,
        message: `Missing a "${required}" column. Found: ${header.filter(Boolean).join(", ")}`,
      });
      return { rounds: [], warnings };
    }
  }

  const body = fillDown(grid.slice(1), [columns.timing, columns.day, columns.board]);

  const raw: RawMatch[] = [];
  body.forEach((row, index) => {
    const sheetRow = index + 2; // 1-indexed, and row 1 is the header
    const roundCell = cell(row, columns.round);
    const team1 = cell(row, columns.team1);
    const team2 = cell(row, columns.team2);

    // Entirely blank spacer rows are normal in a working sheet.
    if (!roundCell && !team1 && !team2) return;

    const round = normalizeRound(roundCell);
    if (!round) {
      warnings.push({
        tab,
        row: sheetRow,
        message: `Unrecognised round "${roundCell}". Use Round 1, Round 2, Quarter-Finals, Semi-Finals or Final.`,
      });
      return;
    }

    const matchNumber = Number(cell(row, columns.matchNo));
    if (!Number.isFinite(matchNumber) || matchNumber <= 0) {
      warnings.push({
        tab,
        row: sheetRow,
        message: `Missing or invalid match number "${cell(row, columns.matchNo)}".`,
      });
      return;
    }

    raw.push({
      matchNumber,
      round: round.canonical,
      roundOrder: round.order,
      sides: [readSide(row, columns, 1), readSide(row, columns, 2)],
      board: cell(row, columns.board),
      day: cell(row, columns.day),
      timing: cell(row, columns.timing),
      winnerCell: cell(row, columns.winner),
      statusCell: cell(row, columns.status),
    });
  });

  const byNumber = new Map(raw.map((match) => [match.matchNumber, match]));

  const duplicates = raw.length - byNumber.size;
  if (duplicates > 0) {
    warnings.push({
      tab,
      row: null,
      message: `${duplicates} duplicate match number(s) — later rows overwrote earlier ones.`,
    });
  }

  /** Just the names typed into this row — nothing followed back up the ladder. */
  function namedKeys(players: string[]): string[] {
    const keys = players.map((player) => normalizeHeader(player)).filter(Boolean);
    if (keys.length > 1) keys.push(normalizeHeader(players.join("")));
    return keys;
  }

  /**
   * Every way a side might legitimately be named in the Winner column.
   *
   * A slot reading "Winner of Match 20" has no names of its own, so matching on
   * this row alone can never succeed — the desk types the player who actually
   * won and the site insists neither side is called that. Follow the reference
   * to whoever is standing in the slot and match against them too.
   */
  function sideKeys(side: RawSide): string[] {
    const players = side.players.length ? side.players : (resolve(side, new Set())?.players ?? []);
    const keys = namedKeys(players);
    if (side.group) keys.push(normalizeHeader(side.group));
    return keys;
  }

  /** The Winner cell, cleaned every way a participant cell would be. */
  function winnerCandidates(value: string): Set<string> {
    // The Winner column is usually pasted from the Team column, so it may still
    // carry the "(RR)" tags — clean it exactly like a participant cell.
    const cleaned = splitPlayers(value)
      .map((player) => extractGroupTag(player).name)
      .filter(Boolean);
    return new Set(
      [
        normalizeHeader(value),
        normalizeHeader(cleaned.join("")),
        ...cleaned.map(normalizeHeader),
      ].filter(Boolean),
    );
  }

  const winnerCache = new Map<number, 0 | 1 | null>();
  /** Matches already complained about, so clearing the cache can't double up. */
  const warned = new Set<number>();
  /**
   * The linking and inference passes below both ask for winners while the
   * ladder is still half-built, and a match they are about to fix would report
   * itself broken on the way past. Stay quiet until they have finished.
   */
  let reportUnmatchedWinners = false;

  /** Which side won, or null while undecided. Memoised so warnings fire once. */
  function winnerOf(match: RawMatch): 0 | 1 | null {
    const cached = winnerCache.get(match.matchNumber);
    if (cached !== undefined) return cached;
    winnerCache.set(match.matchNumber, null); // breaks any circular lookup

    const result = computeWinner(match);
    winnerCache.set(match.matchNumber, result);
    return result;
  }

  function computeWinner(match: RawMatch): 0 | 1 | null {
    // Nobody records a result for a bye, so without this the player sitting the
    // round out never advances and every slot downstream of them stays "TBD".
    if (match.sides[0].isBye !== match.sides[1].isBye) {
      return match.sides[0].isBye ? 1 : 0;
    }

    // A filled Winner is the definitive signal, even if Status still says Live.
    // People mark a match live when it starts and rarely go back to change it;
    // letting a stale Status hide a recorded winner would stall the whole ladder.
    const value = match.winnerCell.trim();
    if (!value) return null;

    if (value === "1" || normalizeHeader(value) === "team1") return 0;
    if (value === "2" || normalizeHeader(value) === "team2") return 1;

    const candidates = winnerCandidates(value);

    for (const index of [0, 1] as const) {
      if (sideKeys(match.sides[index]).some((key) => candidates.has(key))) return index;
    }

    if (reportUnmatchedWinners && !warned.has(match.matchNumber)) {
      warned.add(match.matchNumber);
      warnings.push({
        tab,
        row: null,
        message: `Match ${match.matchNumber}: winner "${value}" doesn't match either side.`,
      });
    }
    return null;
  }

  /**
   * Links a side back to the match its players just won.
   *
   * The team fills the next round in either of two ways: "Winner of Match 3",
   * or the winners' names typed straight in once the match is played. The
   * second kind carries no reference, so without this the earlier match is left
   * hanging off the ladder with nothing flowing out of it.
   */
  function linkNamedWinners() {
    // Every match a given pairing has won, by round.
    const wins = new Map<string, { matchNumber: number; roundOrder: number }[]>();
    const keyOf = (players: string[]) =>
      players.map(normalizeHeader).filter(Boolean).sort().join("|");

    for (const match of raw) {
      const index = winnerOf(match);
      if (index === null) continue;
      const winner = match.sides[index];
      if (!winner.players.length) continue;
      const key = keyOf(winner.players);
      if (!key) continue;
      const list = wins.get(key) ?? [];
      list.push({ matchNumber: match.matchNumber, roundOrder: match.roundOrder });
      wins.set(key, list);
    }

    for (const match of raw) {
      for (const side of match.sides) {
        if (side.fromMatch !== undefined || !side.players.length) continue;
        const candidates = wins.get(keyOf(side.players));
        if (!candidates) continue;
        // The most recent win before this round — in a knockout a pairing's
        // matches form a chain, so that is the one that put them here.
        const feeder = candidates
          .filter((c) => c.roundOrder < match.roundOrder && c.matchNumber !== match.matchNumber)
          .sort((a, b) => b.roundOrder - a.roundOrder)[0];
        if (feeder) side.fromMatch = feeder.matchNumber;
      }
    }
  }

  /**
   * Every route back from `start` that arrives at somebody the Winner cell
   * could be naming, as the list of matches they'd have had to win to get here.
   *
   * Stops at the first row that names them outright: past that point the sheet
   * is telling us where they came from, not who they beat.
   */
  function routesTo(
    start: number,
    candidates: Set<string>,
    seen: Set<number>,
    path: number[],
    out: number[][],
  ) {
    if (seen.has(start)) return;
    seen.add(start);
    const match = byNumber.get(start);
    if (!match) return;

    const here = [...path, start];
    // Only names actually typed into this row count as finding the player;
    // matching a resolved occupant would report a hit at every level and the
    // chain of wins would be meaningless.
    if (match.sides.some((side) => namedKeys(side.players).some((key) => candidates.has(key)))) {
      out.push(here);
      return;
    }
    for (const side of match.sides) {
      if (side.fromMatch === undefined || side.take !== "winner") continue;
      routesTo(side.fromMatch, candidates, seen, here, out);
    }
  }

  /**
   * The Winner column names somebody who is on neither side, because the slot
   * they came through still reads "Winner of Match N" and nobody has typed that
   * earlier result yet. The desk records the semi-final before going back to
   * tidy up the quarter — or never goes back at all.
   *
   * A knockout gives us the answer: there is exactly one route to any slot, so
   * if the name appears once in the matches feeding it, every result along that
   * route follows. Fill those in as if the desk had typed them.
   */
  function inferFeederResults() {
    for (const match of raw) {
      const value = match.winnerCell.trim();
      if (!value) continue;
      if (value === "1" || value === "2") continue;

      const candidates = winnerCandidates(value);
      if (!candidates.size) continue;
      // Already answerable from the row itself — nothing to work out.
      if (match.sides.some((side) => sideKeys(side).some((key) => candidates.has(key)))) continue;

      const routes: number[][] = [];
      const seen = new Set<number>([match.matchNumber]);
      for (const side of match.sides) {
        if (side.players.length || side.fromMatch === undefined || side.take !== "winner") continue;
        routesTo(side.fromMatch, candidates, seen, [], routes);
      }

      // No route means a typo, and more than one means the name is entered
      // twice in the draw. Neither is safe to guess at, so leave both to the
      // "doesn't match either side" warning.
      if (routes.length !== 1) continue;

      for (const number of routes[0] as number[]) {
        const feeder = byNumber.get(number);
        // Never overwrite a result somebody actually recorded: this only ever
        // fills gaps, so an explicit entry always wins.
        if (feeder && !feeder.winnerCell.trim()) feeder.winnerCell = value;
      }
    }
  }

  linkNamedWinners();
  inferFeederResults();
  // Both passes add links and results that earlier lookups couldn't see, so the
  // memoised answers are now stale. Recomputed from here on, with warnings on:
  // whatever still doesn't match is a genuine problem in the sheet.
  winnerCache.clear();
  reportUnmatchedWinners = true;

  /** Follows a "Winner/Loser Match N" chain to whoever actually holds the slot. */
  function resolve(
    side: RawSide,
    seen: Set<number>,
  ): { players: string[]; group?: string | undefined; viaBye?: boolean } | null {
    if (side.players.length > 0) return { players: side.players, group: side.group };
    if (side.fromMatch === undefined) return null;
    if (seen.has(side.fromMatch)) return null; // guards a circular reference
    seen.add(side.fromMatch);

    const feeder = byNumber.get(side.fromMatch);
    if (!feeder) {
      warnings.push({
        tab,
        row: null,
        message:
          `A row points at "${side.take === "loser" ? "Loser" : "Winner"} Match ${side.fromMatch}", ` +
          `but no match ${side.fromMatch} exists.`,
      });
      return null;
    }
    const index = winnerOf(feeder);
    if (index === null) return null;
    // The loser is simply the side that didn't win, which is what a
    // third-place play-off is waiting on.
    const wanted = side.take === "loser" ? (index === 0 ? 1 : 0) : index;
    const resolved = resolve(feeder.sides[wanted], seen);
    if (!resolved) return null;
    // Only the hop we just took counts: a player who took a bye in round 1 and
    // then won round 2 is in round 3 on merit.
    return { ...resolved, viaBye: feeder.sides[0].isBye || feeder.sides[1].isBye };
  }

  function toSlot(side: RawSide): BracketSlot {
    const resolved = resolve(side, new Set());
    const label = side.take === "loser" ? "Loser" : "Winner";
    // resolve() stops as soon as it has names, so a player typed straight into
    // the next round never reports how they got there. Check the feeder here.
    const feeder = side.fromMatch === undefined ? undefined : byNumber.get(side.fromMatch);
    const viaBye = resolved?.viaBye || feeder?.sides.some((s) => s.isBye) || undefined;
    return {
      players: resolved?.players.length ? resolved.players : null,
      group: resolved?.group,
      bye: side.isBye || undefined,
      viaBye,
      source: side.isBye
        ? "Bye"
        : side.fromMatch !== undefined
          ? `${label} · M${side.fromMatch}`
          : undefined,
      // Only a winner feeds the next round, so only that draws a connector —
      // a third-place play-off would otherwise trail a line across the Final.
      fromMatch: side.take === "winner" ? side.fromMatch : undefined,
      score: side.score,
    };
  }

  const ordered = [...byNumber.values()].sort(
    (a, b) => a.roundOrder - b.roundOrder || a.matchNumber - b.matchNumber,
  );

  const rounds: BracketRound[] = [];
  for (const item of ordered) {
    const winnerIndex = winnerOf(item);
    const explicit = normalizeStatus(item.statusCell);
    // Cancelled and no-show outrank a recorded winner, because that pairing is
    // a walkover and the card should say so rather than reading as a played
    // match. The winner itself still stands, so they advance either way.
    // Otherwise: winner wins, then an explicit Status, then upcoming.
    const status: MatchStatus =
      explicit && isStoppedStatus(explicit)
        ? explicit
        : winnerIndex !== null
          ? "completed"
          : (explicit ?? "upcoming");

    const time = [item.day, item.timing].filter(Boolean).join(" · ");

    const match: BracketMatch = {
      id: `${tab}-m${item.matchNumber}`,
      matchNumber: item.matchNumber,
      status,
      time,
      court: item.board || undefined,
      a: toSlot(item.sides[0]),
      b: toSlot(item.sides[1]),
      winner: winnerIndex === null ? null : winnerIndex === 0 ? "a" : "b",
    };

    let round = rounds.find((entry) => entry.name === item.round);
    if (!round) {
      round = { name: item.round, matches: [] };
      rounds.push(round);
    }
    round.matches.push(match);
  }

  return { rounds, warnings, ...(courtLabel ? { courtLabel } : {}) };
}

/* ------------------------------------------------------------------ *
 * Groups tab
 * ------------------------------------------------------------------ */

const DEFAULT_GROUP_COLOR = "#6B7280";

export function parseGroupsTab(grid: SheetGrid): { groups: Group[]; warnings: ParseWarning[] } {
  const warnings: ParseWarning[] = [];
  const header = grid[0];
  if (!header) return { groups: [], warnings };

  const index = { code: -1, name: -1, color: -1 };
  header.forEach((raw, i) => {
    const key = normalizeHeader(raw ?? "");
    if (["code", "group", "groupcode", "short", "tag"].includes(key)) index.code = i;
    else if (["name", "groupname", "team", "teamname", "house"].includes(key)) index.name = i;
    else if (["color", "colour", "hex"].includes(key)) index.color = i;
  });

  if (index.code === -1 || index.name === -1) {
    warnings.push({
      tab: "Groups",
      row: 1,
      message: 'Needs at least "Code" and "Name" columns.',
    });
    return { groups: [], warnings };
  }

  const groups: Group[] = [];
  grid.slice(1).forEach((row) => {
    const code = (row[index.code] ?? "").trim().toUpperCase();
    const name = (row[index.name] ?? "").trim();
    if (!code || !name) return;
    const color = index.color === -1 ? "" : (row[index.color] ?? "").trim();
    groups.push({
      code,
      name,
      color: /^#[0-9a-f]{3,8}$/i.test(color) ? color : DEFAULT_GROUP_COLOR,
    });
  });

  return { groups, warnings };
}

/* ------------------------------------------------------------------ *
 * Tournaments tab — the control panel
 * ------------------------------------------------------------------ */

export type TournamentConfig = {
  slug: string;
  /** Empty for a medals-only event — see `isNoDraw`. */
  sheetTab: string;
  visible: boolean;
  sport?: string;
  name?: string;
  participants?: ParticipantKind;
  dates?: string;
  day?: string;
  time?: string;
  venue?: string;
  venueNote?: string;
  format?: string;
  tagline?: string;
  about?: string;
  /** Drive folder link or ID the gallery photos are pulled from. */
  galleryFolder?: string;
};

const CONFIG_HEADERS: Record<string, string[]> = {
  slug: ["slug", "id", "key"],
  sport: ["sport", "sportname"],
  name: ["tournamentname", "name", "title", "tournament"],
  sheetTab: ["sheettab", "tab", "tabname", "matchestab", "matchtab", "bracket tab"],
  participants: ["participants", "participanttype", "type", "kind"],
  dates: ["dates", "date", "daterange"],
  day: ["days", "day"],
  time: ["time", "times", "timing"],
  venue: ["venue", "location"],
  venueNote: ["venuenote", "venuedetail", "address", "note"],
  format: ["format", "structure"],
  tagline: ["tagline", "subtitle", "strapline"],
  about: ["about", "description", "summary", "intro"],
  visible: ["visible", "published", "show", "publish"],
  galleryFolder: [
    "galleryfolder",
    "gallery",
    "photos",
    "photosfolder",
    "drivefolder",
    "photodrive",
  ],
};

/**
 * Accepts either a bare folder ID or a full Drive URL
 * (e.g. https://drive.google.com/drive/folders/<id>) and returns the ID.
 */
function extractDriveFolderId(value: string): string | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const match = trimmed.match(/\/folders\/([a-zA-Z0-9_-]+)/);
  if (match) return match[1];
  // A bare ID: Drive IDs are alphanumeric plus - and _, no slashes or spaces.
  if (/^[a-zA-Z0-9_-]+$/.test(trimmed)) return trimmed;
  return undefined;
}

function normalizeParticipants(value: string): ParticipantKind | undefined {
  const key = normalizeHeader(value);
  if (["team", "teams", "teamsport", "squad"].includes(key)) return "team";
  if (["doubles", "double", "pairs", "pair"].includes(key)) return "doubles";
  if (["singles", "single", "individual", "solo"].includes(key)) return "singles";
  return undefined;
}

/**
 * "None" in the Sheet Tab column: an event played off the sheet, with no draw
 * to show — darts, where the desk only ever had the podium. A blank cell still
 * means "the tab named after the sport", so this has to be said out loud.
 */
function isNoDraw(value: string) {
  return (
    ["none", "nodraw", "medalsonly", "na"].includes(normalizeHeader(value)) || value.trim() === "-"
  );
}

/** Anything other than an explicit "no" counts as visible. */
function isVisible(value: string) {
  const key = normalizeHeader(value);
  if (!key) return true;
  return !["no", "false", "hidden", "hide", "draft", "0", "off"].includes(key);
}

export function parseTournamentsTab(grid: SheetGrid): {
  configs: TournamentConfig[];
  warnings: ParseWarning[];
} {
  const warnings: ParseWarning[] = [];
  const header = grid[0];
  if (!header) return { configs: [], warnings };

  const index: Record<string, number> = {};
  header.forEach((raw, i) => {
    const key = normalizeHeader(raw ?? "");
    if (!key) return;
    for (const [field, aliases] of Object.entries(CONFIG_HEADERS)) {
      if (index[field] === undefined && aliases.includes(key)) {
        index[field] = i;
        return;
      }
    }
  });

  if (index["slug"] === undefined) {
    warnings.push({
      tab: "Tournaments",
      row: 1,
      message: 'Needs a "Slug" column (e.g. carrom) naming each tournament.',
    });
    return { configs: [], warnings };
  }

  const read = (row: string[], field: string) => {
    const i = index[field];
    return i === undefined ? "" : (row[i] ?? "").trim();
  };

  const configs: TournamentConfig[] = [];
  grid.slice(1).forEach((row, i) => {
    const slug = read(row, "slug").toLowerCase();
    if (!slug) return;

    const participantsRaw = read(row, "participants");
    const participants = normalizeParticipants(participantsRaw);
    if (participantsRaw && !participants) {
      warnings.push({
        tab: "Tournaments",
        row: i + 2,
        message: `Participants "${participantsRaw}" not understood — use Team, Singles or Doubles.`,
      });
    }

    const optional = (field: string) => {
      const value = read(row, field);
      return value ? value : undefined;
    };

    const galleryFolderRaw = read(row, "galleryFolder");
    const galleryFolder = galleryFolderRaw ? extractDriveFolderId(galleryFolderRaw) : undefined;
    if (galleryFolderRaw && !galleryFolder) {
      warnings.push({
        tab: "Tournaments",
        row: i + 2,
        message: `Gallery folder "${galleryFolderRaw}" isn't a Drive folder link or ID.`,
      });
    }

    configs.push({
      slug,
      // Falls back to a tab named after the sport, then the slug itself.
      sheetTab: isNoDraw(read(row, "sheetTab"))
        ? ""
        : read(row, "sheetTab") || read(row, "sport") || slug,
      visible: isVisible(read(row, "visible")),
      ...(optional("sport") ? { sport: optional("sport") as string } : {}),
      ...(optional("name") ? { name: optional("name") as string } : {}),
      ...(participants ? { participants } : {}),
      ...(optional("dates") ? { dates: optional("dates") as string } : {}),
      ...(optional("day") ? { day: optional("day") as string } : {}),
      ...(optional("time") ? { time: optional("time") as string } : {}),
      ...(optional("venue") ? { venue: optional("venue") as string } : {}),
      ...(optional("venueNote") ? { venueNote: optional("venueNote") as string } : {}),
      ...(optional("format") ? { format: optional("format") as string } : {}),
      ...(optional("tagline") ? { tagline: optional("tagline") as string } : {}),
      ...(optional("about") ? { about: optional("about") as string } : {}),
      ...(galleryFolder ? { galleryFolder } : {}),
    });
  });

  return { configs, warnings };
}
