import type { Rating, Title } from "@cinemind/core";

export type FeedbackKind = "like" | "dislike" | "not_interested" | "save";

export interface Feedback {
  titleId: string;
  kind: FeedbackKind;
  createdAt: Date;
}

export interface LibraryEntry {
  title: Title;
  rating?: number;
  ratedAt?: Date;
  onWatchlist: boolean;
}

export interface LibraryQuery {
  search?: string;
  genre?: string;
  type?: string;
  minRating?: number;
  limit?: number;
  offset?: number;
}

/**
 * Storage boundary. The API talks only to this interface, so tests and the
 * no-database demo mode can use the in-memory version.
 */
export interface Repository {
  upsertTitles(titles: readonly Title[]): Promise<void>;
  upsertRatings(userId: string, ratings: readonly Rating[], source: "imdb_csv" | "manual"): Promise<void>;
  deleteRating(userId: string, titleId: string): Promise<boolean>;
  getRatings(userId: string): Promise<Rating[]>;
  getTitle(id: string): Promise<Title | undefined>;
  getCatalogue(): Promise<Map<string, Title>>;
  getLibrary(userId: string, q: LibraryQuery): Promise<{ total: number; items: LibraryEntry[] }>;
  setWatchlist(userId: string, titleId: string, on: boolean): Promise<void>;
  getWatchlist(userId: string): Promise<Title[]>;
  addFeedback(userId: string, titleId: string, kind: FeedbackKind): Promise<void>;
  getFeedback(userId: string): Promise<Feedback[]>;
  /** Single-user mode: the owner account, created on first use. */
  getOwnerId(): Promise<string>;
}
