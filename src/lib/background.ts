/**
 * Work that should finish after the response has gone out.
 *
 * The sheet is refreshed behind the visitor's back: they get the copy we
 * already have, and the new read lands for whoever asks next. On Node that is
 * just a promise nobody awaits. On Cloudflare Workers it is not — a request's
 * outstanding work is cancelled once its response is sent, unless it was
 * handed to `waitUntil`. `server.ts` puts each request's `waitUntil` here, so
 * code deep in the loader can reach it without threading it through.
 *
 * Nitro calls our entry with the request alone, no `ctx`; on Workers it hangs
 * `waitUntil` on the request object instead, so that is checked too.
 *
 * Server-only: imports `node:async_hooks`.
 */
import { AsyncLocalStorage } from "node:async_hooks";

type WaitUntil = (promise: Promise<unknown>) => void;

const storage = new AsyncLocalStorage<WaitUntil | undefined>();

type HasWaitUntil = { waitUntil?: unknown } | null | undefined;

const waitUntilOf = (owner: unknown): WaitUntil | undefined => {
  const fn = (owner as HasWaitUntil)?.waitUntil;
  return typeof fn === "function" ? (promise) => fn.call(owner, promise) : undefined;
};

/** Runs a request with its platform `waitUntil`, when it has one. */
export function runWithBackground<T>(request: Request, ctx: unknown, fn: () => T): T {
  return storage.run(waitUntilOf(ctx) ?? waitUntilOf(request), fn);
}

/** Lets `promise` outlive the response. Never throws, never rejects upward. */
export function inBackground(promise: Promise<unknown>) {
  const settled = promise.catch((error) => console.error("[background]", error));
  storage.getStore()?.(settled);
}
