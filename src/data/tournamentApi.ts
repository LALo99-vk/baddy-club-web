import { eventMeta, gallery, matches, teams, type EventKey, type GalleryRow, type MatchRow, type TeamRow } from '@/data/tournamentData';

export interface TournamentDataSource {
  getTeams(): TeamRow[];
  getMatches(): MatchRow[];
  getGallery(): GalleryRow[];
}

export const localTournamentData: TournamentDataSource = {
  getTeams: () => teams,
  getMatches: () => matches,
  getGallery: () => gallery,
};

export const getEventTeams = (event: EventKey): TeamRow[] =>
  localTournamentData.getTeams().filter((team) => team.event === event).sort((a, b) => a.order - b.order);

export const getEventMatches = (event: EventKey): MatchRow[] =>
  localTournamentData.getMatches().filter((match) => match.event === event);

export const getPlayerMatches = (query: string): MatchRow[] => {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) return [];
  return localTournamentData.getMatches().filter((match) => `${match.teamA} ${match.teamB}`.toLowerCase().includes(normalizedQuery));
};

export { eventMeta };
