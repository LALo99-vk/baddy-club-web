/**
 * The newest sheet read this browser knows about. The Refresh button records
 * it; loaders pass it to the server so whichever instance answers can't hand
 * back an older copy than the one the button just fetched.
 */
let atLeast = 0;

export const requireFresh = (fetchedAt: number) => {
  atLeast = Math.max(atLeast, fetchedAt);
};

export const freshness = () => atLeast;
