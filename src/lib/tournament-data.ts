/**
 * Server functions. The handlers are stripped from the client bundle, so the
 * sheet credentials and the Google fetch never reach the browser. Each returns
 * only what its page draws.
 */
import { createServerFn } from "@tanstack/react-start";

import { isEventKey } from "@/data/event";
import { loadSheetData } from "@/lib/sheets";

/** One event's pools, knockout ladder, champion and photos. `event` is null until its tab is published. */
export const getEventPage = createServerFn({ method: "GET" })
  .validator((input: { slug: string; atLeast?: number }) => input)
  .handler(async ({ data: input }) => {
    if (!isEventKey(input.slug)) return null;
    const data = await loadSheetData({ atLeast: input.atLeast ?? 0 });
    return { event: data.events.find((e) => e.slug === input.slug) ?? null, fetchedAt: data.fetchedAt };
  });
