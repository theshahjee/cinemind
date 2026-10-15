import { ndcgAtK } from "./eval/metrics.js";
import { chronologicalSplit } from "./eval/split.js";
import { buildProfile, type ProfileOptions } from "./profile.js";
import { fitRatingModel } from "./ratingModel.js";
import { DEFAULT_WEIGHTS, scoreTitle, type HybridWeights } from "./scoring.js";
import { DEFAULT_SIGNALS } from "./signals.js";
import type { Rating, Title } from "./types.js";

const GRID = [0, 0.1, 0.2, 0.35, 0.5, 0.7, 1];

/**
 * Pick hybrid weights by grid search. The newest `validationFraction` of the
 * given ratings is held out and the remaining older ratings build the profile,
 * so tuning never sees anything newer than the data it is given.
 */
export function tuneWeights(
  ratings: readonly Rating[],
  catalogue: ReadonlyMap<string, Title>,
  opts: ProfileOptions & { validationFraction?: number; k?: number } = {},
): { weights: HybridWeights; ndcg: number } {
  const { train, test } = chronologicalSplit(ratings, 1 - (opts.validationFraction ?? 0.2));
  if (train.length < 20 || test.length < 5) return { weights: DEFAULT_WEIGHTS, ndcg: NaN };

  const k = opts.k ?? 10;
  const threshold = (opts.signals ?? DEFAULT_SIGNALS).strongPositive;
  const gains = new Map(test.map((r) => [r.titleId, Math.max(0, r.rating - threshold + 1)]));
  const profile = buildProfile(train, catalogue, { ...opts, now: test[0]!.ratedAt });
  const model = fitRatingModel(train, catalogue);
  const titles = test.flatMap((r) => catalogue.get(r.titleId) ?? []);

  let best = { weights: DEFAULT_WEIGHTS, ndcg: -1 };
  for (const content of GRID) {
    for (const features of GRID) {
      for (const personal of GRID) {
        if (content + features + personal === 0) continue;
        const weights = { content, features, personal };
        const ranked = titles
          .map((t) => ({ id: t.id, s: scoreTitle(profile, model, t, weights).score }))
          .sort((a, b) => b.s - a.s)
          .map((x) => x.id);
        const ndcg = ndcgAtK(ranked, gains, k);
        if (ndcg > best.ndcg + 1e-9) best = { weights, ndcg };
      }
    }
  }
  return best;
}
