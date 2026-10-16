import {
  buildProfile,
  hybridRecommender,
  type Rating,
  type ScoredTitle,
  type Title,
} from "@cinemind/core";
import type { Repository } from "./repo/types.js";

export interface RecommendOptions {
  k: number;
  /** Optional pre-filter, used by natural-language search. */
  filter?: (t: Title) => boolean;
}

/**
 * Ratings plus feedback, as the recommender sees them. A "like" or "dislike"
 * on a title the user hasn't rated becomes an inferred rating two points above
 * or below their mean. Explicit ratings always win.
 */
export async function effectiveRatings(repo: Repository, userId: string): Promise<{ ratings: Rating[]; inferred: Set<string> }> {
  const ratings = await repo.getRatings(userId);
  const explicit = new Set(ratings.map((r) => r.titleId));
  const mean = ratings.length ? ratings.reduce((s, r) => s + r.rating, 0) / ratings.length : 6.5;
  const inferred = new Map<string, Rating>();
  for (const f of await repo.getFeedback(userId)) {
    if (explicit.has(f.titleId)) continue;
    if (f.kind === "like") inferred.set(f.titleId, { titleId: f.titleId, rating: Math.min(10, Math.round(mean + 2)), ratedAt: f.createdAt });
    if (f.kind === "dislike") inferred.set(f.titleId, { titleId: f.titleId, rating: Math.max(1, Math.round(mean - 2)), ratedAt: f.createdAt });
  }
  return { ratings: [...ratings, ...inferred.values()], inferred: new Set(inferred.keys()) };
}

export async function recommend(repo: Repository, userId: string, opts: RecommendOptions): Promise<ScoredTitle[]> {
  const [catalogue, { ratings }, feedback, watchlist] = await Promise.all([
    repo.getCatalogue(),
    effectiveRatings(repo, userId),
    repo.getFeedback(userId),
    repo.getWatchlist(userId),
  ]);
  const hidden = new Set(feedback.filter((f) => f.kind === "not_interested").map((f) => f.titleId));
  const onWatchlist = new Set(watchlist.map((t) => t.id));
  const candidates = [...catalogue.values()]
    .filter((t) => !hidden.has(t.id) && !onWatchlist.has(t.id))
    .filter((t) => !opts.filter || opts.filter(t))
    .map((t) => t.id);
  return hybridRecommender.recommend({ ratings, catalogue, candidates, k: opts.k });
}

/** The watchlist, ranked by how well each title fits the user's taste. */
export async function rankedWatchlist(repo: Repository, userId: string): Promise<ScoredTitle[]> {
  const [catalogue, { ratings }, watchlist] = await Promise.all([repo.getCatalogue(), effectiveRatings(repo, userId), repo.getWatchlist(userId)]);
  return hybridRecommender.recommend({
    ratings,
    catalogue,
    candidates: watchlist.map((t) => t.id),
    k: watchlist.length,
  });
}

export interface TasteSummary {
  ratedCount: number;
  inferredCount: number;
  meanRating: number;
  histogram: number[];
  top: { feature: string; affinity: number; support: number }[];
  bottom: { feature: string; affinity: number; support: number }[];
}

/**
 * Taste analytics. `support` is how much rating evidence backs each affinity,
 * so the UI can show what was stated versus what the model inferred.
 */
export async function tasteSummary(repo: Repository, userId: string, limit = 15): Promise<TasteSummary> {
  const [catalogue, explicit, { ratings, inferred }] = await Promise.all([
    repo.getCatalogue(),
    repo.getRatings(userId),
    effectiveRatings(repo, userId),
  ]);
  const profile = buildProfile(ratings, catalogue);
  const rows = [...profile.affinities].map(([feature, affinity]) => ({
    feature,
    affinity,
    support: profile.support.get(feature) ?? 0,
  }));
  const histogram = Array.from({ length: 10 }, (_, i) => explicit.filter((r) => r.rating === i + 1).length);
  return {
    ratedCount: explicit.length,
    inferredCount: inferred.size,
    meanRating: explicit.length ? explicit.reduce((s, r) => s + r.rating, 0) / explicit.length : 0,
    histogram,
    top: rows.filter((r) => r.affinity > 0).sort((a, b) => b.affinity - a.affinity).slice(0, limit),
    bottom: rows.filter((r) => r.affinity < 0).sort((a, b) => a.affinity - b.affinity).slice(0, limit),
  };
}
