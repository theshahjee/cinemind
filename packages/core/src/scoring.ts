import { featuresOf, type TasteProfile } from "./profile.js";
import { clamp, predictFromModel, type RatingModel } from "./ratingModel.js";
import type { Explanation, Title } from "./types.js";
import { cosine } from "./vector.js";

/** Weights for S(u,m) = wc*C + wg*G + wp*P. Tuned offline against held-out ratings. */
export interface HybridWeights {
  content: number;
  features: number;
  personal: number;
}

export const DEFAULT_WEIGHTS: HybridWeights = { content: 0.4, features: 0.4, personal: 0.2 };

export interface ScoredTitle {
  title: Title;
  score: number;
  explanation: Explanation;
}

/** C: embedding similarity to the taste centroid, in [-1, 1]. Undefined if either side lacks a vector. */
export function contentScore(profile: TasteProfile, t: Title): number | undefined {
  if (!profile.centroid || !t.embedding) return undefined;
  return cosine(profile.centroid, t.embedding);
}

/**
 * How much each kind of feature counts. Decade and language are coarse and,
 * with few ratings, can drown out genre and director signals.
 */
export const FEATURE_KIND_WEIGHTS: Record<string, number> = {
  genre: 1,
  director: 1,
  cast: 0.7,
  keyword: 0.7,
  language: 0.4,
  decade: 0.3,
};

/** G: aggregated affinity over the title's features, squashed into (-1, 1). */
export function featureScore(profile: TasteProfile, t: Title): { score: number; matches: string[]; conflicts: string[] } {
  const hits: [string, number][] = [];
  let weightSum = 0;
  let total = 0;
  for (const f of featuresOf(t)) {
    const a = profile.affinities.get(f);
    if (a === undefined) continue;
    const w = FEATURE_KIND_WEIGHTS[f.slice(0, f.indexOf(":"))] ?? 1;
    hits.push([f, a]);
    total += w * a;
    weightSum += w * w;
  }
  if (hits.length === 0) return { score: 0, matches: [], conflicts: [] };
  const score = Math.tanh(total / Math.sqrt(weightSum));
  // Decades shape the score but read as noise in an explanation ("watch out: 2010s").
  const sorted = hits.filter(([f]) => !f.startsWith("decade:")).sort((a, b) => b[1] - a[1]);
  return {
    score,
    matches: sorted.filter(([, a]) => a > 0.1).slice(0, 4).map(([f]) => f),
    conflicts: sorted.filter(([, a]) => a < -0.1).reverse().slice(0, 3).map(([f]) => f),
  };
}

/** P: predicted rating relative to the user's mean, scaled into [-1, 1]. */
export function personalScore(model: RatingModel, t: Title): number {
  return clamp((predictFromModel(model, t) - model.meanRating) / 3, -1, 1);
}

export function scoreTitle(
  profile: TasteProfile,
  model: RatingModel,
  t: Title,
  weights: HybridWeights = DEFAULT_WEIGHTS,
): ScoredTitle {
  const c = contentScore(profile, t);
  const g = featureScore(profile, t);
  const p = personalScore(model, t);

  // When a title has no embedding, redistribute the content weight rather than scoring it as 0.
  const wc = c === undefined ? 0 : weights.content;
  const totalW = wc + weights.features + weights.personal || 1;
  const score = (wc * (c ?? 0) + weights.features * g.score + weights.personal * p) / totalW;

  return {
    title: t,
    score,
    explanation: {
      matches: g.matches,
      conflicts: g.conflicts,
      signals: { content: c ?? 0, features: g.score, personal: p },
    },
  };
}
