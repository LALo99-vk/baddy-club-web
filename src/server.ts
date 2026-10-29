import "./lib/error-capture";

import { fetchFileMedia, fetchFileThumbnail, loadPhoto, readDriveConfig } from "./lib/drive";
import { consumeLastCapturedError } from "./lib/error-capture";
import { renderErrorPage } from "./lib/error-page";
import { loadSheetData } from "./lib/sheets";
import { runWithBackground } from "./lib/background";

type ServerEntry = {
  fetch: (request: Request, env: unknown, ctx: unknown) => Promise<Response> | Response;
};

let serverEntryPromise: Promise<ServerEntry> | undefined;

async function getServerEntry(): Promise<ServerEntry> {
  if (!serverEntryPromise) {
    serverEntryPromise = import("@tanstack/react-start/server-entry").then(
      (m) => (m.default ?? m) as ServerEntry,
    );
  }
  return serverEntryPromise;
}

// h3 swallows in-handler throws into a normal 500 Response with body
// {"unhandled":true,"message":"HTTPError"} — try/catch alone never fires for those.
async function normalizeCatastrophicSsrResponse(response: Response): Promise<Response> {
  if (response.status < 500) return response;
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) return response;

  const body = await response.clone().text();
  if (!isH3SwallowedErrorBody(body)) return response;

  console.error(consumeLastCapturedError() ?? new Error(`h3 swallowed SSR error: ${body}`));
  return new Response(renderErrorPage(), {
    status: 500,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

function isH3SwallowedErrorBody(body: string): boolean {
  try {
    const payload = JSON.parse(body) as { unhandled?: unknown; message?: unknown };
    return payload.unhandled === true && payload.message === "HTTPError";
  } catch {
    return false;
  }
}

/** Forced refreshes are throttled so the button can't be used to spam Google. */
const FORCE_REFRESH_GAP_MS = 5_000;
let lastForcedRefresh = 0;

const summarise = (data: Awaited<ReturnType<typeof loadSheetData>>) => ({
  events: data.events,
  source: data.source,
  fetchedAt: data.fetchedAt,
});

const json = (body: unknown, cacheControl: string, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": cacheControl },
  });

/**
 * Plain HTTP endpoints for the tournament data.
 *
 * Kept separate from the app's server functions on purpose: these are cacheable
 * GETs, so a CDN can absorb polling traffic instead of every viewer costing us
 * a server invocation and, eventually, a Google API call.
 *
 * Returns null for anything that isn't one of ours, so the app handles it.
 */
async function handleApi(request: Request): Promise<Response | null> {
  const { pathname } = new URL(request.url);
  if (!pathname.startsWith("/api/")) return null;

  if (request.method !== "GET") {
    return json({ error: "Method not allowed" }, "no-store", 405);
  }

  if (pathname === "/api/refresh") {
    // What the Refresh button calls: re-read the sheet now and say when. The
    // page then reloads its own (small) data, asking for at least this fresh.
    // Same throttle as below, so it can't be used to hammer Google.
    const now = Date.now();
    if (now - lastForcedRefresh < FORCE_REFRESH_GAP_MS) {
      const data = await loadSheetData();
      return json({ fetchedAt: data.fetchedAt, throttled: true }, "no-store");
    }
    lastForcedRefresh = now;
    const data = await loadSheetData({ force: true });
    return json({ fetchedAt: data.fetchedAt, error: data.error ?? null }, "no-store");
  }

  if (pathname === "/api/tournaments") {
    // ?refresh=1 skips the cache and re-reads the sheet — this is what the
    // Refresh button calls, so an edit shows up immediately instead of waiting
    // out the TTL. Throttled so it can't be used to hammer Google's quota.
    const forced = new URL(request.url).searchParams.get("refresh") === "1";
    if (forced) {
      const now = Date.now();
      if (now - lastForcedRefresh < FORCE_REFRESH_GAP_MS) {
        const data = await loadSheetData();
        return json({ ...summarise(data), throttled: true }, "no-store");
      }
      lastForcedRefresh = now;
      const data = await loadSheetData({ force: true });
      return json({ ...summarise(data), refreshed: true }, "no-store");
    }

    const data = await loadSheetData();
    // Served from the edge briefly, then refreshed in the background while the
    // stale copy keeps answering — viewers never wait on Google.
    return json(summarise(data), "public, max-age=0, s-maxage=10, stale-while-revalidate=60");
  }

  if (pathname.startsWith("/api/drive-image/")) {
    const fileId = pathname.slice("/api/drive-image/".length);
    // Drive file IDs are alphanumeric plus - and _ — reject anything else
    // before it reaches the Drive API URL.
    if (!/^[a-zA-Z0-9_-]+$/.test(fileId)) {
      return json({ error: "Invalid file id" }, "no-store", 400);
    }

    const config = readDriveConfig();
    if (!config) return json({ error: "Drive not configured" }, "no-store", 404);

    try {
      const { bytes, contentType } = await loadPhoto(fileId);
      return new Response(bytes, {
        status: 200,
        headers: {
          "content-type": contentType,
          // File IDs are stable even when a photo is renamed, so this is safe
          // to cache hard — a CDN can serve it without hitting Drive again.
          "cache-control": "public, max-age=31536000, immutable",
        },
      });
    } catch {
      // No tile-sized copy yet — Drive is most likely still processing a fresh
      // upload. Send the original, but only briefly, so the browser picks up
      // the small one once it exists.
    }

    try {
      const { body, contentType } = await fetchFileMedia(config, fileId);
      return new Response(body, {
        status: 200,
        headers: { "content-type": contentType, "cache-control": "public, max-age=300" },
      });
    } catch (error) {
      console.error("[drive] image proxy failed:", error);
      return json({ error: "Image not found" }, "no-store", 404);
    }
  }

  if (pathname.startsWith("/api/drive-thumb/")) {
    const fileId = pathname.slice("/api/drive-thumb/".length);
    if (!/^[a-zA-Z0-9_-]+$/.test(fileId)) {
      return json({ error: "Invalid file id" }, "no-store", 400);
    }

    const config = readDriveConfig();
    if (!config) return json({ error: "Drive not configured" }, "no-store", 404);

    try {
      const { body, contentType } = await fetchFileThumbnail(config, fileId);
      return new Response(body, {
        status: 200,
        headers: {
          "content-type": contentType,
          "cache-control": "public, max-age=31536000, immutable",
        },
      });
    } catch (error) {
      console.error("[drive] thumbnail proxy failed:", error);
      // Drive hasn't finished processing a fresh upload yet, most likely. Say
      // so briefly rather than caching a miss for a year.
      return json({ error: "Thumbnail not available" }, "no-store", 404);
    }
  }

  if (pathname === "/api/sheet-status") {
    const data = await loadSheetData();
    return json(
      {
        source: data.source,
        fetchedAt: new Date(data.fetchedAt).toISOString(),
        error: data.error ?? null,
        warnings: data.warnings,
        events: data.events.map((e) => ({
          slug: e.slug,
          pools: e.pools.map((p) => `${p.pool}: ${p.played}/${p.total}${p.complete ? " complete" : ""}`),
          knockoutMatches: e.rounds.reduce((sum, round) => sum + round.matches.length, 0),
          champion: e.champion,
          photos: e.gallery.length,
        })),
      },
      // Diagnostics must never be stale — that is the whole point of them.
      "no-store",
    );
  }

  return json({ error: "Not found" }, "no-store", 404);
}

/* ------------------------------------------------------------------ *
 * Compression
 * ------------------------------------------------------------------ */

/**
 * Nothing between us and the visitor compresses: the load balancer passes
 * bodies through untouched and there is no CDN in front of it, so a tournament
 * page went over the wire as a quarter-megabyte of uncompressed JSON. Gzip cuts
 * the sheet payload by about 8x.
 *
 * `CompressionStream` is a transform, so a streamed SSR response keeps
 * streaming -- we are not buffering the page to compress it.
 */
const COMPRESSIBLE =
  /^(?:text\/|application\/(?:json|javascript|xml|manifest\+json)|image\/svg\+xml)/i;

/** Below this, the gzip header costs more than the saving. */
const MIN_COMPRESS_BYTES = 1024;

function wantsGzip(request: Request): boolean {
  return /\bgzip\b/i.test(request.headers.get("accept-encoding") ?? "");
}

/**
 * Where we run. On Cloudflare Workers the edge compresses for us — with brotli,
 * better than our gzip — and always tells the worker "accept-encoding: gzip, br"
 * whatever the browser actually sent, so compressing here would only cost CPU
 * and take brotli away. The gzip below is for a bare Node server, as at InMobi.
 */
const onWorkers = typeof navigator !== "undefined" && navigator.userAgent === "Cloudflare-Workers";

function compress(request: Request, response: Response): Response {
  if (onWorkers) return response;

  // Tell caches the body varies by encoding whether or not we compress this
  // one, so a client that can't take gzip is never handed a gzipped copy.
  const headers = new Headers(response.headers);
  const vary = headers.get("vary");
  if (!vary) headers.set("vary", "accept-encoding");
  else if (!/\baccept-encoding\b/i.test(vary)) headers.set("vary", `${vary}, accept-encoding`);

  const unchanged = () =>
    new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });

  if (typeof CompressionStream === "undefined") return unchanged();
  if (!wantsGzip(request)) return unchanged();
  if (!response.body) return unchanged();
  if (response.headers.has("content-encoding")) return unchanged();
  if (!COMPRESSIBLE.test(response.headers.get("content-type") ?? "")) return unchanged();

  // Only when the length is known and small — a streamed response has none,
  // and those are the big ones we most want compressed.
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > 0 && declared < MIN_COMPRESS_BYTES)
    return unchanged();

  headers.set("content-encoding", "gzip");
  // The compressed body is a different length, and we don't know it up front.
  headers.delete("content-length");

  return new Response(response.body.pipeThrough(new CompressionStream("gzip")), {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

/**
 * Read the sheet as soon as a long-running server starts, so the first visitor
 * after a deploy gets a page from memory rather than waiting ~1.5s on Google.
 * Workers forbid I/O outside a request, and an isolate is short-lived anyway;
 * there the edge-cache snapshot does this job instead.
 */
if (!onWorkers) void loadSheetData().catch(() => {});

export default {
  fetch(request: Request, env: unknown, ctx: unknown) {
    // Hands the platform's waitUntil to the sheet loader, so a background
    // refresh survives the response on Workers.
    return runWithBackground(request, ctx, async () => {
      try {
        const api = await handleApi(request);
        if (api) return compress(request, api);

        const handler = await getServerEntry();
        const response = await handler.fetch(request, env, ctx);
        return compress(request, await normalizeCatastrophicSsrResponse(response));
      } catch (error) {
        console.error(error);
        return new Response(renderErrorPage(), {
          status: 500,
          headers: { "content-type": "text/html; charset=utf-8" },
        });
      }
    });
  },
};
