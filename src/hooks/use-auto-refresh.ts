import { useRouter } from "@tanstack/react-router";
import { useEffect } from "react";

/**
 * How often a live page re-asks for the sheet. The server answers from memory
 * and refreshes from Google behind the scenes (see `loadSheetData`), so asking
 * often costs the visitor nothing — a score entered in the sheet reaches an
 * open page within about this plus the server's 20s window.
 */
export const LIVE_REFRESH_MS = 30_000;

/**
 * Each tab picks its own offset, so screens opened together don't all ask in
 * the same second for the rest of the day.
 */
const JITTER = 0.25;

const withJitter = (intervalMs: number) =>
  Math.round(intervalMs * (1 + (Math.random() * 2 - 1) * JITTER));

const visible = () => typeof document === "undefined" || document.visibilityState === "visible";

/**
 * Silently re-runs the current route's loader on an interval, so pages backed
 * by the sheet stay in sync without a reload.
 *
 * A tab in the background doesn't ask at all — a phone in a pocket shouldn't
 * spend battery and data on scores nobody is looking at. When it comes back to
 * the front, or back online, it catches up at once instead of showing whatever
 * it had when it was put away.
 */
export function useAutoRefresh(intervalMs: number) {
  const router = useRouter();

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    let last = Date.now();

    const refresh = () => {
      last = Date.now();
      void router.invalidate();
    };
    const schedule = () => {
      clearTimeout(timer);
      timer = setTimeout(tick, withJitter(intervalMs));
    };
    const tick = () => {
      if (visible() && navigator.onLine !== false) refresh();
      schedule();
    };
    const catchUp = () => {
      if (!visible()) return;
      // Back after a while: refresh now. Back after a moment: the next tick will do.
      if (Date.now() - last > intervalMs / 2) refresh();
      schedule();
    };

    schedule();
    document.addEventListener("visibilitychange", catchUp);
    window.addEventListener("online", catchUp);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", catchUp);
      window.removeEventListener("online", catchUp);
    };
  }, [router, intervalMs]);
}
