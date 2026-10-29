/**
 * Server-side loader: fetches the spreadsheet, translates it, and caches the
 * result. Never throws — if the sheet is unreachable the site keeps the last
 * good copy, then falls back to an honest empty state.
 *
 * The cache and refresh logic is Bright's. What differs is the shape of an
 * event tab: pool rows and knockout rows live together (see ./pools).
 *
 * Sheet layout
 *   Tournaments (optional) — one row per event: Slug, Sheet Tab, Visible, Gallery Folder.
 *     Without it, each event reads the tab named after its short label (MS, MD, XD, WD).
 *   One tab per event — Match No, Round, Team 1, Team 2, Score 1, Score 2, Court, Time,
 *     Winner, Status. Round is "Pool A", "Pool B", … for the round robin, then
 *     Round of 16 / Quarter-Finals / Semi-Finals / Final.
 */
import { EVENTS, type EventKey } from "@/data/event";
import type { EventData } from "@/data/tournament";
import { loadFolderMedia } from "@/lib/drive";
import { inBackground } from "@/lib/background";
import { fetchAllTabs, readSheetsConfig } from "./client";
import { normalizeHeader, parseMatchTab, parseTournamentsTab, type ParseWarning, type SheetGrid, type TournamentConfig } from "./parse";
import { buildPools, fillPoolPlaces, markPoolPlaceholders, splitEventTab } from "./pools";

declare const process: { env: Record<string, string | undefined> };

/** How old a copy can be before the next request starts a re-read in the background. */
const FRESH_MS = 20_000;
/** Past this a copy is too old to show even for a moment, and the request waits for the sheet. */
const MAX_STALE_MS = 15 * 60_000;
/** After a failed read, try again no sooner than this. */
const RETRY_MS = 15_000;
/** A read that hasn't finished by now is abandoned, so it can't block every refresh after it. */
const READ_TIMEOUT_MS = 15_000;

export type SheetSource = "sheet" | "cache" | "fallback";

export type SheetData = {
  events: EventData[];
  warnings: ParseWarning[];
  source: SheetSource;
  fetchedAt: number;
  /** Set when the latest read failed; the data above is then stale or empty. */
  error?: string;
};

/** "MD", "mens doubles", "mens-doubles" all name the same event. */
function eventForSlug(value: string): EventKey | undefined {
  const key = normalizeHeader(value);
  return EVENTS.find((e) => [normalizeHeader(e.slug), normalizeHeader(e.shortLabel), normalizeHeader(e.label)].includes(key))?.slug;
}

const findTab = (tabs: Record<string, SheetGrid>, name: string) =>
  Object.entries(tabs).find(([title]) => normalizeHeader(title) === normalizeHeader(name));

function buildEvent(slug: EventKey, tab: string, grid: SheetGrid, warnings: ParseWarning[]): EventData {
  const header = grid[0] ?? [];
  const { poolRows, knockout, columns } = splitEventTab(grid);
  const pools = buildPools(tab, poolRows, columns, header, warnings);

  let rounds: EventData["rounds"] = [];
  let courtLabel: string | undefined;
  if (knockout.length > 1) {
    const parsed = parseMatchTab(tab, fillPoolPlaces(knockout, columns, pools));
    warnings.push(...parsed.warnings);
    rounds = markPoolPlaceholders(parsed.rounds);
    courtLabel = parsed.courtLabel;
  }

  const final = rounds.find((r) => r.name === "Final")?.matches[0];
  const winningSide = final?.winner === "a" ? final.a : final?.winner === "b" ? final.b : null;
  const champion = winningSide?.players?.join(" & ") ?? null;

  return { slug, pools, rounds, courtLabel, champion, gallery: [] };
}

export function buildFromTabs(tabs: Record<string, SheetGrid>): { events: EventData[]; warnings: ParseWarning[]; configs: Map<EventKey, TournamentConfig> } {
  const warnings: ParseWarning[] = [];
  const configs = new Map<EventKey, TournamentConfig>();

  const tournamentsTab = findTab(tabs, "Tournaments");
  if (tournamentsTab) {
    const parsed = parseTournamentsTab(tournamentsTab[1]);
    warnings.push(...parsed.warnings);
    for (const config of parsed.configs) {
      const slug = eventForSlug(config.slug);
      if (slug) configs.set(slug, config);
      else warnings.push({ tab: "Tournaments", row: null, message: `Slug "${config.slug}" isn't one of MS, MD, XD, WD.` });
    }
  }

  const events: EventData[] = [];
  for (const info of EVENTS) {
    const config = configs.get(info.slug);
    if (config && !config.visible) continue;
    const found = findTab(tabs, config?.sheetTab || info.shortLabel);
    if (!found || found[1].length < 2) continue;
    events.push(buildEvent(info.slug, found[0], found[1], warnings));
  }
  return { events, warnings, configs };
}

async function attachGalleries(events: EventData[], configs: Map<EventKey, TournamentConfig>): Promise<EventData[]> {
  return Promise.all(
    events.map(async (event) => {
      const folderId = configs.get(event.slug)?.galleryFolder;
      if (!folderId) return event;
      const { gallery } = await loadFolderMedia(folderId);
      return { ...event, gallery };
    }),
  );
}

/* ------------------------------------------------------------------ *
 * Cache
 * ------------------------------------------------------------------ */

let cache: SheetData | null = null;
let inFlight: Promise<SheetData> | null = null;
let lastFailure = 0;

const emptyData = (error?: string): SheetData => ({
  events: [],
  warnings: [],
  source: "fallback",
  fetchedAt: Date.now(),
  ...(error ? { error } : {}),
});

async function readSheet(force = false): Promise<SheetData> {
  const config = readSheetsConfig();
  if (!config) {
    return emptyData("Sheet not configured — set GOOGLE_SHEETS_ID, GOOGLE_SA_EMAIL and GOOGLE_SA_PRIVATE_KEY.");
  }

  try {
    let tabs = await fetchAllTabs(config, { refreshTitles: force });
    let built = buildFromTabs(tabs);

    // Tab names are remembered for a few minutes. A published event pointing at
    // a tab we never fetched means the desk has just added it, so look again.
    const missing = EVENTS.some((info) => {
      const entry = built.configs.get(info.slug);
      return entry?.visible && entry.sheetTab && !findTab(tabs, entry.sheetTab);
    });
    if (missing && !force) {
      tabs = await fetchAllTabs(config, { refreshTitles: true });
      built = buildFromTabs(tabs);
    }

    const events = await attachGalleries(built.events, built.configs);
    const fresh: SheetData = { events, warnings: built.warnings, source: "sheet", fetchedAt: Date.now() };
    cache = fresh;
    return fresh;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[sheets] read failed:", message);
    lastFailure = Date.now();
    if (cache) return { ...cache, source: "cache", error: message };
    return emptyData(message);
  }
}

/** One read at a time; everyone who asks meanwhile shares it. */
function refresh(force = false): Promise<SheetData> {
  if (inFlight) return inFlight;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<SheetData>((resolve) => {
    timer = setTimeout(() => {
      console.error(`[sheets] read took over ${READ_TIMEOUT_MS / 1000}s; abandoned`);
      lastFailure = Date.now();
      resolve(cache ? { ...cache, source: "cache", error: "Sheet read timed out" } : emptyData("Sheet read timed out"));
    }, READ_TIMEOUT_MS);
  });
  inFlight = Promise.race([readSheet(force), timeout]).finally(() => {
    clearTimeout(timer);
    inFlight = null;
  });
  return inFlight;
}

/**
 * Cached read, stale-while-revalidate. A visitor only waits on Google when
 * there is nothing to show at all; a stale copy is served while a re-read runs
 * behind it.
 */
export async function loadSheetData(options?: { force?: boolean; atLeast?: number }): Promise<SheetData> {
  if (options?.force) return refresh(true);

  // The Refresh button just forced a read; don't answer with anything older.
  const atLeast = options?.atLeast ?? 0;
  if (atLeast > 0 && (!cache || cache.fetchedAt < atLeast)) return refresh();

  const age = cache ? Date.now() - cache.fetchedAt : Infinity;
  if (cache && age < FRESH_MS) return cache;
  if (cache && age < MAX_STALE_MS) {
    if (Date.now() - lastFailure >= RETRY_MS) inBackground(refresh());
    return cache;
  }
  return refresh();
}
