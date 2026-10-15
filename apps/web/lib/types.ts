export interface Title {
  id: string;
  title: string;
  type: string;
  year?: number;
  runtimeMinutes?: number;
  genres: string[];
  directors: string[];
  cast?: string[];
  imdbRating?: number;
  overview?: string;
  posterPath?: string;
}

export interface Explanation {
  matches: string[];
  conflicts: string[];
  signals: { content: number; features: number; personal: number };
}

export interface Recommendation {
  title: Title;
  score: number;
  explanation: Explanation;
}

export interface LibraryEntry {
  title: Title;
  rating?: number;
  ratedAt?: string;
  onWatchlist: boolean;
}

export interface Taste {
  ratedCount: number;
  inferredCount: number;
  meanRating: number;
  histogram: number[];
  top: { feature: string; affinity: number; support: number }[];
  bottom: { feature: string; affinity: number; support: number }[];
}

export interface AskResult {
  constraints: {
    includeGenres: string[];
    excludeGenres: string[];
    types: string[];
    maxRuntimeMinutes?: number;
    minYear?: number;
    maxYear?: number;
    softPreferences: string[];
  };
  parsedBy: string;
  note?: string;
  results: Recommendation[];
}
