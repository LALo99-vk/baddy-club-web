/**
 * Minimal read-only Google Sheets client.
 *
 * Deliberately dependency-free: it signs the service-account JWT with WebCrypto
 * rather than pulling in `googleapis`, so the same code runs on Node, Vercel's
 * runtime and Cloudflare Workers without changes.
 *
 * This module must only ever be imported from server code — it reads secrets.
 */
import type { SheetGrid } from "./parse";

declare const process: { env: Record<string, string | undefined> };

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SHEETS_API = "https://sheets.googleapis.com/v4/spreadsheets";
const SCOPE = "https://www.googleapis.com/auth/spreadsheets.readonly";

export type SheetsConfig = {
  spreadsheetId: string;
  clientEmail: string;
  privateKey: string;
};

/** Returns null when the sheet isn't configured, so callers can fall back. */
export function readSheetsConfig(): SheetsConfig | null {
  const spreadsheetId = process.env["GOOGLE_SHEETS_ID"]?.trim();
  const clientEmail = process.env["GOOGLE_SA_EMAIL"]?.trim();
  const rawKey = process.env["GOOGLE_SA_PRIVATE_KEY"];

  if (!spreadsheetId || !clientEmail || !rawKey) return null;

  return {
    spreadsheetId,
    clientEmail,
    // Env files store the PEM with literal "\n" sequences, and some dashboards
    // wrap the whole value in quotes. Normalise both.
    privateKey: rawKey
      .trim()
      .replace(/^["']|["']$/g, "")
      .replace(/\\n/g, "\n"),
  };
}

/* ------------------------------------------------------------------ *
 * JWT signing
 * ------------------------------------------------------------------ */

function base64Url(bytes: ArrayBuffer | string) {
  const binary = typeof bytes === "string" ? bytes : String.fromCharCode(...new Uint8Array(bytes));
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** PEM (PKCS#8) -> raw DER bytes. */
function pemToDer(pem: string): ArrayBuffer {
  const body = pem
    .replace(/-----BEGIN [^-]+-----/, "")
    .replace(/-----END [^-]+-----/, "")
    .replace(/\s+/g, "");
  const binary = atob(body);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

async function signJwt(config: SheetsConfig): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = base64Url(
    JSON.stringify({
      iss: config.clientEmail,
      scope: SCOPE,
      aud: TOKEN_URL,
      iat: now,
      exp: now + 3600,
    }),
  );

  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToDer(config.privateKey),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );

  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    new TextEncoder().encode(`${header}.${claims}`),
  );

  return `${header}.${claims}.${base64Url(signature)}`;
}

/* ------------------------------------------------------------------ *
 * Access token (cached until shortly before it expires)
 * ------------------------------------------------------------------ */

let tokenCache: { token: string; expiresAt: number } | null = null;

async function getAccessToken(config: SheetsConfig): Promise<string> {
  if (tokenCache && tokenCache.expiresAt > Date.now() + 60_000) {
    return tokenCache.token;
  }

  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: await signJwt(config),
    }),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(
      `Google rejected the service account (${response.status}). ` +
        `Check GOOGLE_SA_EMAIL and GOOGLE_SA_PRIVATE_KEY. ${detail.slice(0, 200)}`,
    );
  }

  const payload = (await response.json()) as { access_token: string; expires_in: number };
  tokenCache = {
    token: payload.access_token,
    expiresAt: Date.now() + payload.expires_in * 1000,
  };
  return payload.access_token;
}

/* ------------------------------------------------------------------ *
 * Reading the spreadsheet
 * ------------------------------------------------------------------ */

async function api<T>(url: string, token: string, config: SheetsConfig): Promise<T> {
  const response = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
  if (!response.ok) {
    const detail = await response.text();

    // By far the most common setup mistake, so name the exact fix.
    if (response.status === 403 && detail.includes("PERMISSION_DENIED")) {
      throw new Error(
        `Sheet not shared. Open the spreadsheet, click Share, and add ` +
          `${config.clientEmail} as a Viewer.`,
      );
    }
    if (response.status === 403 && detail.includes("has not been used in project")) {
      throw new Error(
        `The Google Sheets API is not enabled for this project. Enable it in the ` +
          `Cloud console, then retry. ${detail.slice(0, 200)}`,
      );
    }
    if (response.status === 404) {
      throw new Error(
        `No spreadsheet with id "${config.spreadsheetId}". Check GOOGLE_SHEETS_ID — ` +
          `it is the part of the URL between /d/ and /edit.`,
      );
    }
    throw new Error(`Sheets API error ${response.status}: ${detail.slice(0, 200)}`);
  }
  return (await response.json()) as T;
}

/**
 * Tab titles, remembered between reads.
 *
 * `values:batchGet` needs to be told which ranges to read, so every read used
 * to ask for the spreadsheet's metadata first purely to learn the tab names --
 * a round trip that measured slower than reading all thirteen tabs. Names only
 * change when somebody adds or renames a tab, so cache them; a forced refresh
 * (the Refresh button, /api/sheet-status?refresh=1) always looks again, and a
 * new tab otherwise shows up within the TTL below.
 */
const TITLES_TTL_MS = 5 * 60_000;

let titleCache: { spreadsheetId: string; titles: string[]; fetchedAt: number } | null = null;

async function fetchTabTitles(
  config: SheetsConfig,
  token: string,
  refresh: boolean,
): Promise<string[]> {
  const cached =
    titleCache?.spreadsheetId === config.spreadsheetId &&
    Date.now() - titleCache.fetchedAt < TITLES_TTL_MS
      ? titleCache.titles
      : null;
  if (!refresh && cached) return cached;

  const meta = await api<{ sheets?: { properties?: { title?: string } }[] }>(
    `${SHEETS_API}/${config.spreadsheetId}?fields=sheets.properties.title`,
    token,
    config,
  );

  const titles = (meta.sheets ?? [])
    .map((sheet) => sheet.properties?.title)
    .filter((title): title is string => Boolean(title));

  titleCache = { spreadsheetId: config.spreadsheetId, titles, fetchedAt: Date.now() };
  return titles;
}

/** Every tab in the spreadsheet, keyed by tab name. */
export async function fetchAllTabs(
  config: SheetsConfig,
  options?: { refreshTitles?: boolean },
): Promise<Record<string, SheetGrid>> {
  const token = await getAccessToken(config);

  const titles = await fetchTabTitles(config, token, options?.refreshTitles === true);

  if (titles.length === 0) return {};

  // One round trip for every tab. FORMATTED_VALUE keeps what the team sees,
  // so "4:00-6:00" and dates arrive as written rather than as serial numbers.
  const query = titles
    .map((title) => `ranges=${encodeURIComponent(`'${title.replace(/'/g, "''")}'`)}`)
    .join("&");

  const values = await api<{ valueRanges?: { values?: string[][] }[] }>(
    `${SHEETS_API}/${config.spreadsheetId}/values:batchGet?${query}` +
      `&majorDimension=ROWS&valueRenderOption=FORMATTED_VALUE`,
    token,
    config,
  );

  const tabs: Record<string, SheetGrid> = {};
  titles.forEach((title, index) => {
    tabs[title] = values.valueRanges?.[index]?.values ?? [];
  });
  return tabs;
}
