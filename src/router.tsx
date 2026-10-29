import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";

export const getRouter = () => {
  const queryClient = new QueryClient();

  const router = createRouter({
    routeTree,
    context: { queryClient },
    scrollRestoration: true,
    // Start a page's loader when its link is hovered or touched, not when it is
    // clicked, so the data is usually there by the time the finger lifts.
    defaultPreload: "intent",
    // At 0 a preloaded page was stale on arrival and the click fetched it all
    // over again. 20s matches the server's own freshness window; nothing newer
    // exists before then. useAutoRefresh invalidates outright, so live scores
    // still land on their own.
    defaultPreloadStaleTime: 20_000,
  });

  return router;
};
