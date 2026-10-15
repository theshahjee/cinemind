export type TitleType = "movie" | "tvSeries" | "tvMiniSeries" | "tvMovie" | "tvEpisode" | "short" | "other";

/** Catalogue entry. Fields beyond `id` and `title` are optional because metadata coverage varies. */
export interface Title {
  /** IMDb `tt` identifier. Used as the primary key across the system. */
  id: string;
  title: string;
  type: TitleType;
  year?: number;
  runtimeMinutes?: number;
  genres: string[];
  directors: string[];
  cast?: string[];
  keywords?: string[];
  language?: string;
  /** Public IMDb average rating, 0-10. */
  imdbRating?: number;
  numVotes?: number;
  overview?: string;
  /** TMDB poster path, e.g. "/abc.jpg". */
  posterPath?: string;
  /** Plot/theme embedding, if one has been computed. */
  embedding?: number[];
}

export interface Rating {
  titleId: string;
  /** User's own rating, 1-10. */
  rating: number;
  ratedAt: Date;
}

export interface Recommendation {
  titleId: string;
  score: number;
  explanation: Explanation;
}

export interface Explanation {
  /** Feature values that pushed the score up, strongest first. */
  matches: string[];
  /** Feature values the user tends to dislike that this title carries. */
  conflicts: string[];
  /** Per-signal contributions, before weighting. */
  signals: { content: number; features: number; personal: number };
}
