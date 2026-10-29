import { useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { RefreshCw } from "lucide-react";
import { requireFresh } from "@/lib/freshness";
import { cn } from "@/lib/utils";

/**
 * Pulls the latest sheet data on demand, as at InMobi: the desk edits the sheet
 * and presses this rather than waiting for the next automatic update.
 */
export function RefreshButton({ fetchedAt, className }: { fetchedAt: number; className?: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  // A fixed time zone, so the server's render and the browser's agree.
  const updated = new Date(fetchedAt).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata" });

  async function refresh() {
    if (busy) return;
    setBusy(true);
    try {
      const response = await fetch("/api/refresh", { cache: "no-store" });
      const body = (await response.json()) as { fetchedAt?: number };
      if (body.fetchedAt) requireFresh(body.fetchedAt);
      await router.invalidate();
    } catch {
      // Leave what's on screen: a failed refresh must never blank the bracket.
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className={cn("flex shrink-0 items-center gap-2 text-xs", className)}>
      <button type="button" onClick={refresh} disabled={busy} className="inline-flex items-center gap-1.5 rounded border border-border px-2.5 py-1 font-medium transition-colors hover:border-spot hover:text-spot disabled:cursor-not-allowed disabled:opacity-60">
        <RefreshCw className={cn("size-3", busy && "animate-spin")} aria-hidden/>
        {busy ? "Updating" : "Refresh"}
      </button>
      <span className="whitespace-nowrap text-muted-foreground">Updated {updated}</span>
    </span>
  );
}
