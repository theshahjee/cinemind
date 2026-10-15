import { mmrRerank } from "./diversity.js";
import { buildProfile, type ProfileOptions } from "./profile.js";
import { clamp, fitRatingModel } from "./ratingModel.js";
import { DEFAULT_WEIGHTS, scoreTitle, type HybridWeights, type ScoredTitle } from "./scoring.js";
import { tuneWeights } from "./tuning.js";
import type { Rating, Title } from "./types.js";

export interface RecommendInput {
  ratings: readonly Rating[];
  catalogue: ReadonlyMap<string, Title>;
  /** Titles to rank. Defaults to every catalogue title the user hasn't rated. */
  candidates?: readonly string[];
  k: number;
  now?: Date;
}

/** Common shape so the evaluation harness can compare approaches. */
export interface Recommender {
  name: string;
  recommend(input: RecommendInput): ScoredTitle[];
  /** Optional rating prediction, for RMSE/MAE. */
  predict?(input: Omit<RecommendInput, "k" | "candidates">, titleId: string): number;
}

function candidatePool(input: RecommendInput): Title[] {
  const rated = new Set(input.ratings.map((r) => r.titleId));
  const ids = input.candidates ?? [...input.catalogue.keys()];
  return ids.filter((id) => !rated.has(id)).flatMap((id) => input.catalogue.get(id) ?? []);
}

const emptyExplanation = { matches: [], conflicts: [], signals: { content: 0, features: 0, personal: 0 } };

/** Baseline: rank by Bayesian-averaged public rating. Ignores the user entirely. */
export const popularityRecommender: Recommender = {
  name: "popularity",
  recommend(input) {
    const pool = candidatePool(input);
    const rated = pool.filter((t) => t.imdbRating !== undefined);
    const globalMean = rated.length ? rated.reduce((s, t) => s + t.imdbRating!, 0) / rated.length : 6.5;
    const m = 5000; // votes needed before a title's own rating dominates the prior
    return pool
      .map((t) => {
        const v = t.numVotes ?? 0;
        const r = t.imdbRating ?? globalMean;
        return { title: t, score: (v / (v + m)) * r + (m / (v + m)) * globalMean, explanation: emptyExplanation };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, input.k);
  },
};

export interface HybridOptions extends ProfileOptions {
  /** Fixed weights, or "tuned" to grid-search them on the user's own older ratings. */
  weights?: HybridWeights | "tuned";
  /** MMR lambda. Set to 1 to disable diversity re-ranking. */
  diversity?: number;
}

export function createHybridRecommender(opts: HybridOptions = {}, name = "hybrid"): Recommender {
  const lambda = opts.diversity ?? 0.8;
  // Tuning is deterministic for a given rating history, so cache the last result.
  let cache: { key: readonly Rating[]; weights: HybridWeights } | undefined;
  const weightsFor = (ratings: readonly Rating[], catalogue: ReadonlyMap<string, Title>): HybridWeights => {
    if (opts.weights !== "tuned") return opts.weights ?? DEFAULT_WEIGHTS;
    if (cache?.key !== ratings) cache = { key: ratings, weights: tuneWeights(ratings, catalogue, opts).weights };
    return cache.weights;
  };
  return {
    name,
    recommend(input) {
      const profile = buildProfile(input.ratings, input.catalogue, { ...opts, now: input.now ?? opts.now });
      const model = fitRatingModel(input.ratings, input.catalogue);
      const weights = weightsFor(input.ratings, input.catalogue);
      const scored = candidatePool(input)
        .map((t) => scoreTitle(profile, model, t, weights))
        .sort((a, b) => b.score - a.score);
      if (lambda >= 1) return scored.slice(0, input.k);
      // Re-rank only the head of the list; MMR is O(k * n).
      return mmrRerank(scored.slice(0, Math.max(input.k * 5, 50)), input.k, lambda);
    },
    predict(input, titleId) {
      const model = fitRatingModel(input.ratings, input.catalogue);
      const t = input.catalogue.get(titleId);
      if (!t) return model.meanRating;
      const profile = buildProfile(input.ratings, input.catalogue, { ...opts, now: input.now ?? opts.now });
      const weights = weightsFor(input.ratings, input.catalogue);
      return clamp(model.meanRating + 3 * scoreTitle(profile, model, t, weights).score, 1, 10);
    },
  };
}

/** Content-only: feature affinities and embeddings, no rating-pattern model, no diversity. */
export const contentRecommender = createHybridRecommender(
  { weights: { content: 0.5, features: 0.5, personal: 0 }, diversity: 1 },
  "content",
);

/** Default hybrid: fixed weights plus MMR diversity re-ranking. */
export const hybridRecommender = createHybridRecommender();

/** Same scoring without diversity re-ranking, to show what variety costs or gains. */
export const hybridNoDiversityRecommender = createHybridRecommender({ diversity: 1 }, "hybrid (no MMR)");

/**
 * Experimental: weights grid-searched on the user's own older ratings. On the
 * synthetic benchmark this overfits the small validation slice and loses to the
 * fixed weights, so it is not the default.
 */
export const hybridTunedRecommender = createHybridRecommender({ weights: "tuned" }, "hybrid (tuned weights)");
