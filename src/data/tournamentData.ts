export type EventKey = 'mens-singles' | 'mens-doubles' | 'mixed-doubles' | 'womens-doubles';
export type MatchStatus = 'Upcoming' | 'Live' | 'Completed';
export type MatchStage = 'Pool' | 'Quarter-final' | 'Semi-final' | 'Final';

export interface TeamRow {
  teamId: string;
  event: EventKey;
  pool: string;
  playerNames: string[];
  displayName: string;
  order: number;
}

export interface MatchRow {
  matchId: string;
  event: EventKey;
  stage: MatchStage;
  pool: string | null;
  round: string;
  scheduledTime: string;
  court: string;
  teamA: string;
  teamB: string;
  scoreA: string | null;
  scoreB: string | null;
  status: MatchStatus;
  recordedWinner: string | null;
}

export interface GalleryRow {
  imageUrl: string;
  caption: string;
  displayOrder: number;
}

export const teams: TeamRow[] = [
  { teamId: 'ms-1', event: 'mens-singles', pool: 'A', playerNames: ['Arjun Rao'], displayName: 'Arjun Rao', order: 1 },
  { teamId: 'ms-2', event: 'mens-singles', pool: 'A', playerNames: ['Nikhil Menon'], displayName: 'Nikhil Menon', order: 2 },
  { teamId: 'ms-3', event: 'mens-singles', pool: 'A', playerNames: ['Rohan Shah'], displayName: 'Rohan Shah', order: 3 },
  { teamId: 'ms-4', event: 'mens-singles', pool: 'B', playerNames: ['Kabir Singh'], displayName: 'Kabir Singh', order: 4 },
  { teamId: 'ms-5', event: 'mens-singles', pool: 'B', playerNames: ['Aditya Paul'], displayName: 'Aditya Paul', order: 5 },
  { teamId: 'ms-6', event: 'mens-singles', pool: 'B', playerNames: ['Vivek Nair'], displayName: 'Vivek Nair', order: 6 },
  { teamId: 'md-1', event: 'mens-doubles', pool: 'A', playerNames: ['Aarav & Karan'], displayName: 'Aarav Mehta & Karan Rao', order: 1 },
  { teamId: 'md-2', event: 'mens-doubles', pool: 'A', playerNames: ['Dev & Rishi'], displayName: 'Dev Iyer & Rishi Shah', order: 2 },
  { teamId: 'md-3', event: 'mens-doubles', pool: 'A', playerNames: ['Siddharth & Neil'], displayName: 'Siddharth Jain & Neil Thomas', order: 3 },
  { teamId: 'md-4', event: 'mens-doubles', pool: 'B', playerNames: ['Manav & Yash'], displayName: 'Manav Kapur & Yash Bhat', order: 4 },
  { teamId: 'md-5', event: 'mens-doubles', pool: 'B', playerNames: ['Varun & Akash'], displayName: 'Varun Rao & Akash Das', order: 5 },
  { teamId: 'md-6', event: 'mens-doubles', pool: 'B', playerNames: ['Kunal & Omar'], displayName: 'Kunal Jain & Omar Khan', order: 6 },
  { teamId: 'mx-1', event: 'mixed-doubles', pool: 'A', playerNames: ['Ananya & Rohan'], displayName: 'Ananya Sen & Rohan Shah', order: 1 },
  { teamId: 'mx-2', event: 'mixed-doubles', pool: 'A', playerNames: ['Meera & Kabir'], displayName: 'Meera Nair & Kabir Singh', order: 2 },
  { teamId: 'mx-3', event: 'mixed-doubles', pool: 'A', playerNames: ['Diya & Arjun'], displayName: 'Diya Menon & Arjun Rao', order: 3 },
  { teamId: 'mx-4', event: 'mixed-doubles', pool: 'B', playerNames: ['Ishita & Nikhil'], displayName: 'Ishita Paul & Nikhil Menon', order: 4 },
  { teamId: 'mx-5', event: 'mixed-doubles', pool: 'B', playerNames: ['Tara & Dev'], displayName: 'Tara Kapoor & Dev Iyer', order: 5 },
  { teamId: 'mx-6', event: 'mixed-doubles', pool: 'B', playerNames: ['Rhea & Aditya'], displayName: 'Rhea Shah & Aditya Paul', order: 6 },
  { teamId: 'wd-1', event: 'womens-doubles', pool: 'A', playerNames: ['Aditi & Sneha'], displayName: 'Aditi Rao & Sneha Iyer', order: 1 },
  { teamId: 'wd-2', event: 'womens-doubles', pool: 'A', playerNames: ['Kavya & Pooja'], displayName: 'Kavya Menon & Pooja Nair', order: 2 },
  { teamId: 'wd-3', event: 'womens-doubles', pool: 'A', playerNames: ['Naina & Ritu'], displayName: 'Naina Shah & Ritu Das', order: 3 },
  { teamId: 'wd-4', event: 'womens-doubles', pool: 'B', playerNames: ['Ira & Maya'], displayName: 'Ira Paul & Maya Kapur', order: 4 },
  { teamId: 'wd-5', event: 'womens-doubles', pool: 'B', playerNames: ['Anvi & Tanya'], displayName: 'Anvi Bhat & Tanya Rao', order: 5 },
  { teamId: 'wd-6', event: 'womens-doubles', pool: 'B', playerNames: ['Neha & Zoya'], displayName: 'Neha Jain & Zoya Khan', order: 6 },
];

const match = (row: MatchRow): MatchRow => row;

export const matches: MatchRow[] = [
  match({ matchId: 'ms-01', event: 'mens-singles', stage: 'Pool', pool: 'A', round: 'Pool A · Match 1', scheduledTime: '08:30 AM', court: 'Court 01', teamA: 'Arjun Rao', teamB: 'Nikhil Menon', scoreA: '21', scoreB: '17', status: 'Completed', recordedWinner: 'Arjun Rao' }),
  match({ matchId: 'ms-02', event: 'mens-singles', stage: 'Pool', pool: 'A', round: 'Pool A · Match 2', scheduledTime: '09:05 AM', court: 'Court 01', teamA: 'Rohan Shah', teamB: 'Nikhil Menon', scoreA: null, scoreB: null, status: 'Upcoming', recordedWinner: null }),
  match({ matchId: 'ms-03', event: 'mens-singles', stage: 'Pool', pool: 'B', round: 'Pool B · Match 1', scheduledTime: '08:30 AM', court: 'Court 02', teamA: 'Kabir Singh', teamB: 'Aditya Paul', scoreA: '18', scoreB: '21', status: 'Completed', recordedWinner: 'Aditya Paul' }),
  match({ matchId: 'ms-04', event: 'mens-singles', stage: 'Semi-final', pool: null, round: 'Semi-final 1', scheduledTime: '11:10 AM', court: 'Court 01', teamA: 'Arjun Rao', teamB: 'Pool B Winner', scoreA: null, scoreB: null, status: 'Upcoming', recordedWinner: null }),
  match({ matchId: 'ms-05', event: 'mens-singles', stage: 'Final', pool: null, round: 'Final', scheduledTime: '12:40 PM', court: 'Court 01', teamA: 'TBD', teamB: 'TBD', scoreA: null, scoreB: null, status: 'Upcoming', recordedWinner: null }),
  match({ matchId: 'md-01', event: 'mens-doubles', stage: 'Pool', pool: 'A', round: 'Pool A · Match 1', scheduledTime: '08:45 AM', court: 'Court 03', teamA: 'Aarav Mehta & Karan Rao', teamB: 'Dev Iyer & Rishi Shah', scoreA: '21–19', scoreB: null, status: 'Completed', recordedWinner: 'Aarav Mehta & Karan Rao' }),
  match({ matchId: 'md-02', event: 'mens-doubles', stage: 'Pool', pool: 'B', round: 'Pool B · Match 1', scheduledTime: '09:20 AM', court: 'Court 03', teamA: 'Manav Kapur & Yash Bhat', teamB: 'Varun Rao & Akash Das', scoreA: null, scoreB: null, status: 'Live', recordedWinner: null }),
  match({ matchId: 'md-03', event: 'mens-doubles', stage: 'Semi-final', pool: null, round: 'Semi-final 1', scheduledTime: '11:30 AM', court: 'Court 02', teamA: 'Aarav Mehta & Karan Rao', teamB: 'TBD', scoreA: null, scoreB: null, status: 'Upcoming', recordedWinner: null }),
  match({ matchId: 'md-04', event: 'mens-doubles', stage: 'Final', pool: null, round: 'Final', scheduledTime: '01:00 PM', court: 'Court 01', teamA: 'TBD', teamB: 'TBD', scoreA: null, scoreB: null, status: 'Upcoming', recordedWinner: null }),
  match({ matchId: 'mx-01', event: 'mixed-doubles', stage: 'Pool', pool: 'A', round: 'Pool A · Match 1', scheduledTime: '09:00 AM', court: 'Court 04', teamA: 'Ananya Sen & Rohan Shah', teamB: 'Meera Nair & Kabir Singh', scoreA: '21–16', scoreB: null, status: 'Completed', recordedWinner: 'Ananya Sen & Rohan Shah' }),
  match({ matchId: 'mx-02', event: 'mixed-doubles', stage: 'Pool', pool: 'B', round: 'Pool B · Match 1', scheduledTime: '09:35 AM', court: 'Court 04', teamA: 'Ishita Paul & Nikhil Menon', teamB: 'Tara Kapoor & Dev Iyer', scoreA: null, scoreB: null, status: 'Upcoming', recordedWinner: null }),
  match({ matchId: 'mx-03', event: 'mixed-doubles', stage: 'Final', pool: null, round: 'Final', scheduledTime: '01:20 PM', court: 'Court 01', teamA: 'TBD', teamB: 'TBD', scoreA: null, scoreB: null, status: 'Upcoming', recordedWinner: null }),
  match({ matchId: 'wd-01', event: 'womens-doubles', stage: 'Pool', pool: 'A', round: 'Pool A · Match 1', scheduledTime: '09:15 AM', court: 'Court 02', teamA: 'Aditi Rao & Sneha Iyer', teamB: 'Kavya Menon & Pooja Nair', scoreA: '21–18', scoreB: null, status: 'Completed', recordedWinner: 'Aditi Rao & Sneha Iyer' }),
  match({ matchId: 'wd-02', event: 'womens-doubles', stage: 'Pool', pool: 'B', round: 'Pool B · Match 1', scheduledTime: '09:50 AM', court: 'Court 02', teamA: 'Ira Paul & Maya Kapur', teamB: 'Anvi Bhat & Tanya Rao', scoreA: null, scoreB: null, status: 'Upcoming', recordedWinner: null }),
  match({ matchId: 'wd-03', event: 'womens-doubles', stage: 'Semi-final', pool: null, round: 'Semi-final 1', scheduledTime: '11:50 AM', court: 'Court 03', teamA: 'Aditi Rao & Sneha Iyer', teamB: 'TBD', scoreA: null, scoreB: null, status: 'Upcoming', recordedWinner: null }),
  match({ matchId: 'wd-04', event: 'womens-doubles', stage: 'Final', pool: null, round: 'Final', scheduledTime: '01:40 PM', court: 'Court 01', teamA: 'TBD', teamB: 'TBD', scoreA: null, scoreB: null, status: 'Upcoming', recordedWinner: null }),
];

export const gallery: GalleryRow[] = [];

export const eventMeta: Record<EventKey, { label: string; shortLabel: string; prize: string }> = {
  'mens-singles': { label: "Men's Singles", shortLabel: 'MS', prize: '₹4K + shoes' },
  'mens-doubles': { label: "Men's Doubles", shortLabel: 'MD', prize: '₹6K + shoes' },
  'mixed-doubles': { label: 'Mixed Doubles', shortLabel: 'XD', prize: '₹5K + kitbag' },
  'womens-doubles': { label: "Women's Doubles", shortLabel: 'WD', prize: '₹5K + rackets' },
};
