/**
 * Server-side loader for a tournament's Drive folder. One folder holds both the
 * photos and the videos; this splits them by mime type so the page can show
 * each in its own tab.
 *
 * Never throws — if a folder is unreachable the caller keeps whatever it had.
 */
import {
  fetchFileMedia,
  fetchFileThumbnail,
  listFolderMedia,
  readDriveConfig,
  type DriveFile,
} from "./client";

export type GalleryItem = { src: string; caption: string };

export type VideoItem = {
  /** Drive file id — the page builds the player and poster URLs from it. */
  id: string;
  title: string;
  /** "1:42", or empty while Drive is still processing the upload. */
  duration: string;
  /**
   * Width over height, so the card can be given the shape the clip actually is.
   * Everything here is filmed on a phone and most of it is portrait; pouring
   * that into a 16:9 box is what produces the black pillars either side.
   */
  aspect: number;
  /** Poster frame, through our own proxy — see `fetchFileThumbnail`. */
  poster: string;
  meta: string;
  /**
   * Whether a visitor can actually watch it. Photos come through our own proxy
   * so folder sharing is enough, but a video plays straight from Google in the
   * visitor's browser and needs "anyone with the link".
   */
  shared: boolean;
};

export type FolderMedia = { gallery: GalleryItem[]; videos: VideoItem[] };

/** How long a folder listing is served before we re-read it from Drive. */
const TTL_MS = 60_000;

const EMPTY: FolderMedia = { gallery: [], videos: [] };

const cache = new Map<string, { media: FolderMedia; fetchedAt: number }>();
const inFlight = new Map<string, Promise<FolderMedia>>();

const stripExtension = (name: string) => name.replace(/\.[a-z0-9]+$/i, "");

/**
 * Width over height. Falls back to 16:9 rather than guessing: an unknown shape
 * drawn wide is the layout we already had, while an unknown shape drawn tall
 * would be a new way to be wrong.
 */
function aspectOf(meta: DriveFile["videoMediaMetadata"]): number {
  const width = Number(meta?.width);
  const height = Number(meta?.height);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return 16 / 9;
  }
  return width / height;
}

/** 102000 -> "1:42". Empty when Drive hasn't reported a duration yet. */
function formatDuration(millis: string | undefined): string {
  const total = Number(millis);
  if (!Number.isFinite(total) || total <= 0) return "";
  const seconds = Math.round(total / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

/**
 * Drive serves a thumbnail only for a file anyone with the link can open;
 * everything else ends up at a sign-in page instead. So ask for the thumbnail
 * as a visitor's browser would and see whether an actual image comes back.
 *
 * Note the redirect: this endpoint always bounces to Google's image host, for
 * public and private files alike, so the redirect itself says nothing. Only
 * what it lands on does.
 */
async function probeSharing(id: string): Promise<boolean> {
  try {
    const response = await fetch(`https://drive.google.com/thumbnail?id=${id}&sz=w320`);
    const isImage =
      response.ok && (response.headers.get("content-type") ?? "").startsWith("image/");
    await response.body?.cancel();
    return isImage;
  } catch {
    return false;
  }
}

/**
 * Remembered per file, because the folder listing above is re-read every minute
 * and this probe costs a round trip to Google for every video in the event --
 * on the critical path of every page, since the sheet read waits on it.
 *
 * The two lifetimes are deliberately different. A file that is shared stays
 * shared, so that answer keeps. A file that is not is usually one somebody is
 * in the middle of fixing, so re-check those often enough that the video
 * appears a few minutes after the desk ticks the box, not an hour later.
 */
const SHARED_TTL_MS = 30 * 60_000;
const UNSHARED_TTL_MS = 5 * 60_000;

const sharingCache = new Map<string, { shared: boolean; checkedAt: number }>();

async function isPubliclyViewable(id: string): Promise<boolean> {
  const known = sharingCache.get(id);
  if (known) {
    const ttl = known.shared ? SHARED_TTL_MS : UNSHARED_TTL_MS;
    if (Date.now() - known.checkedAt < ttl) return known.shared;
  }

  const shared = await probeSharing(id);
  sharingCache.set(id, { shared, checkedAt: Date.now() });
  return shared;
}

function split(files: DriveFile[]): FolderMedia {
  const gallery: GalleryItem[] = [];
  const videos: VideoItem[] = [];

  for (const file of files) {
    const title = stripExtension(file.name);
    if (file.mimeType.startsWith("video/")) {
      videos.push({
        id: file.id,
        title,
        duration: formatDuration(file.videoMediaMetadata?.durationMillis),
        aspect: aspectOf(file.videoMediaMetadata),
        poster: `/api/drive-thumb/${file.id}`,
        meta: "",
        shared: false, // filled in below
      });
    } else if (file.mimeType.startsWith("image/")) {
      // Photos are proxied through us, so the folder only ever needs sharing
      // with the reader account. Videos are different — see the page.
      gallery.push({ src: `/api/drive-image/${file.id}`, caption: title });
    }
  }

  return { gallery, videos };
}

/* ------------------------------------------------------------------ *
 * Photos: resized once, then served from memory
 * ------------------------------------------------------------------ */

/**
 * Wide enough for a gallery tile on a high-density screen. Phone originals are
 * 1-1.5 MB and took 7-12 s each to come through Drive; at this width Drive hands
 * back roughly a fifth of that.
 */
const PHOTO_WIDTH = 1000;

/** The task has 1 GB; at ~250 KB a photo this still holds a few hundred. */
const PHOTO_CACHE_BYTES = 80 * 1024 * 1024;

/** Concurrent Drive fetches when warming a folder, so a big drop can't flood it. */
const WARM_CONCURRENCY = 4;

export type Photo = { bytes: ArrayBuffer; contentType: string };

// Map order doubles as recency: a hit is moved to the end, eviction takes the front.
const photoCache = new Map<string, Photo>();
let photoCacheBytes = 0;
const photoInFlight = new Map<string, Promise<Photo>>();

function rememberPhoto(id: string, photo: Photo) {
  photoCache.set(id, photo);
  photoCacheBytes += photo.bytes.byteLength;
  for (const [oldId, old] of photoCache) {
    if (photoCacheBytes <= PHOTO_CACHE_BYTES) break;
    photoCache.delete(oldId);
    photoCacheBytes -= old.bytes.byteLength;
  }
}

/**
 * A gallery photo at tile size. The first request for a file goes to Drive;
 * every visitor after that is served from memory. Throws when Drive has no
 * thumbnail yet (an upload still processing) — the caller falls back to the
 * original rather than caching the miss.
 */
export async function loadPhoto(id: string): Promise<Photo> {
  const cached = photoCache.get(id);
  if (cached) {
    photoCache.delete(id);
    photoCache.set(id, cached);
    return cached;
  }

  const existing = photoInFlight.get(id);
  if (existing) return existing;

  const promise = (async () => {
    const config = readDriveConfig();
    if (!config) throw new Error("Drive not configured");
    const { body, contentType } = await fetchFileThumbnail(config, id, PHOTO_WIDTH);
    const photo = { bytes: await new Response(body).arrayBuffer(), contentType };
    rememberPhoto(id, photo);
    return photo;
  })().finally(() => {
    photoInFlight.delete(id);
  });
  photoInFlight.set(id, promise);
  return promise;
}

/**
 * Fetches a folder's new photos in the background as soon as they're listed,
 * so not even the first visitor waits on Drive. Failures are left for the next
 * listing (a minute later) to retry.
 */
function warmPhotos(ids: string[]) {
  const queue = ids.filter((id) => !photoCache.has(id) && !photoInFlight.has(id));
  const worker = async () => {
    for (let id = queue.shift(); id; id = queue.shift()) {
      await loadPhoto(id).catch(() => {});
    }
  };
  for (let i = 0; i < Math.min(WARM_CONCURRENCY, queue.length); i++) void worker();
}

async function readFolder(folderId: string): Promise<FolderMedia> {
  const config = readDriveConfig();
  if (!config) return cache.get(folderId)?.media ?? EMPTY;

  try {
    const files = await listFolderMedia(config, folderId);
    warmPhotos(files.filter((f) => f.mimeType.startsWith("image/")).map((f) => f.id));
    const media = split(files);
    const videos = await Promise.all(
      media.videos.map(async (video) => ({
        ...video,
        shared: await isPubliclyViewable(video.id),
      })),
    );
    const withSharing = { ...media, videos };
    cache.set(folderId, { media: withSharing, fetchedAt: Date.now() });
    return withSharing;
  } catch (error) {
    console.error(`[drive] folder ${folderId} read failed:`, error);
    // Prefer the last good copy over dropping photos during the event.
    return cache.get(folderId)?.media ?? EMPTY;
  }
}

/** Cached per-folder read; concurrent callers for the same folder share one request. */
export async function loadFolderMedia(
  folderId: string,
  options?: { force?: boolean },
): Promise<FolderMedia> {
  const cached = cache.get(folderId);
  if (!options?.force && cached && Date.now() - cached.fetchedAt < TTL_MS) {
    return cached.media;
  }

  const existing = inFlight.get(folderId);
  if (existing) return existing;

  const promise = readFolder(folderId).finally(() => {
    inFlight.delete(folderId);
  });
  inFlight.set(folderId, promise);
  return promise;
}

export { fetchFileMedia, fetchFileThumbnail, readDriveConfig };
