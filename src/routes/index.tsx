import { createFileRoute, Link, useRouter } from '@tanstack/react-router';
import { useEffect } from 'react';
import { ArrowUpRight } from 'lucide-react';
import { EVENTS } from '@/data/event';

export const Route = createFileRoute('/')({ component: HomePage });

function HomePage() {
  const router = useRouter();
  // Fetch all four events in the background once the page has settled. Phones
  // have no hover to preload on, so without this the tap is what starts the
  // fetch. Once loaded, an event opens at once and refreshes behind the scenes.
  useEffect(() => {
    const preload = () => EVENTS.forEach((event) => void router.preloadRoute({ to: '/tournaments/$slug', params: { slug: event.slug } }).catch(() => {}));
    if ('requestIdleCallback' in window) {
      const id = window.requestIdleCallback(preload, { timeout: 2000 });
      return () => window.cancelIdleCallback(id);
    }
    const id = setTimeout(preload, 500);
    return () => clearTimeout(id);
  }, [router]);
  return <>
    <section className="hero" id="top">
      <div className="hero-copy"><p className="kicker"><span>Sun, 1 Nov · 8:30 AM</span> District Play Racquet Club, Koramangala</p><h1><span>The Baddy Club</span><em>× District Play Open</em></h1><p className="hero-subtitle">Round robin → Knockout stages</p></div>
    </section>
    <section className="tournaments section-shell" id="events"><div className="section-top"><div><p className="eyebrow">The draw</p><h2>Events</h2></div><span className="section-note">Four events<br />One open court</span></div><div className="event-list">{EVENTS.map((event, index) => <Link className="event-row" key={event.slug} to="/tournaments/$slug" params={{ slug: event.slug }}><span className="event-num">0{index + 1}</span><span className="event-name">{event.label}</span><ArrowUpRight className="event-arrow" size={21} /></Link>)}</div></section>
  </>;
}
