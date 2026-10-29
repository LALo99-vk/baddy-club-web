import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Outlet, Link, createRootRouteWithContext, useRouter, HeadContent, Scripts, type ErrorComponentProps } from "@tanstack/react-router";
import type { ReactNode } from "react";

import appCss from "../styles.css?url";

function NotFoundComponent() {
  return (
    <section className="page-message section-shell">
      <p className="eyebrow">404</p>
      <h1>Page not found.</h1>
      <p>The page you're looking for doesn't exist or has moved.</p>
      <Link to="/" className="primary-button">Go home</Link>
    </section>
  );
}

function ErrorComponent({ error, reset }: ErrorComponentProps) {
  console.error(error);
  const router = useRouter();
  return (
    <section className="page-message section-shell">
      <p className="eyebrow">Something went wrong</p>
      <h1>This page didn't load.</h1>
      <p>Try again, or head back home.</p>
      <button type="button" className="primary-button" onClick={() => { void router.invalidate(); reset(); }}>Try again</button>
    </section>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "The Baddy Club × District Play Open" },
      { name: "description", content: "The Baddy Club × District Play Open — Sunday, 1 November at District Play Racquet Club, Koramangala." },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      { rel: "stylesheet", href: "https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&family=Space+Grotesk:wght@400;500;600;700&display=swap" },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  return (
    <QueryClientProvider client={queryClient}>
      <main>
        <nav className="top-nav"><div className="nav-left"><Link className="brand" to="/"><img className="brand-logo" src="/logos.png" alt="The Baddy Club × District Play" /></Link><div className="powered-by"><span>Powered by</span><img src="/athletiq-stacked.png" alt="Athletiq" /></div></div></nav>
        <Outlet />
        <footer><div className="footer-brand">the <strong>baddy club</strong> × district play</div><p className="footer-tagline">Bring your partner. <em>Or come solo.</em></p><span>District Play Racquet Club, Koramangala</span><span>Sunday, 1 November · 8:30 AM onwards</span></footer>
      </main>
    </QueryClientProvider>
  );
}
