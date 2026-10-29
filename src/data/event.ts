// Fixed facts about the tournament. Live data (draws, scores, photos) comes from the sheet via src/lib/sheets.

export type EventKey = 'mens-singles' | 'mens-doubles' | 'mixed-doubles' | 'womens-doubles';

export type EventInfo = {
  slug: EventKey;
  label: string;
  shortLabel: string;
  prize: string;
  kind: 'singles' | 'doubles';
};

/** In the order the home page lists them. */
export const EVENTS: EventInfo[] = [
  { slug: 'mens-singles', label: "Men's Singles", shortLabel: 'MS', prize: '₹4K + shoes', kind: 'singles' },
  { slug: 'mens-doubles', label: "Men's Doubles", shortLabel: 'MD', prize: '₹6K + shoes', kind: 'doubles' },
  { slug: 'mixed-doubles', label: 'Mixed Doubles', shortLabel: 'XD', prize: '₹5K + kitbag', kind: 'doubles' },
  { slug: 'womens-doubles', label: "Women's Doubles", shortLabel: 'WD', prize: '₹5K + rackets', kind: 'doubles' },
];

/** The poster lists prizes biggest first. */
export const PRIZE_ORDER: EventKey[] = ['mens-doubles', 'mens-singles', 'mixed-doubles', 'womens-doubles'];

export const eventInfo = (slug: string): EventInfo | undefined => EVENTS.find((e) => e.slug === slug);

export const isEventKey = (slug: string | undefined): slug is EventKey => EVENTS.some((e) => e.slug === slug);

/** How many from each pool go through to the knockouts. */
export const QUALIFIERS_PER_POOL = 2;
