import type { Rating, Title } from "./types.js";
import { DEFAULT_SIGNALS, ratingToSignal, recencyWeight, type SignalConfig } from "./signals.js";
import { addScaled } from "./vector.js";

export type FeatureKind = "genre" | "director" | "cast" | "keyword" | "language" | "decade";

export interface TasteProfile {
  /** Affinity per feature key ("genre:Drama"), roughly in [-1, 1]. */
  affinities: Map<string, number>;
  /** How much evidence backs each affinity (sum of weights). */
  support: Map<string, number>;
  /** Weighted embedding centroid: liked titles pull toward, disliked push away. */
  centroid?: number[];
  /** User's mean rating, used as the prior for rating prediction. */
  meanRating: number;
  ratedIds: Set<string>;
}

export interface ProfileOptions {
  signals?: SignalConfig;
  halfLifeDays?: number;
  /** Reference time for recency weighting. Defaults to the newest rating. */
  now?: Date;
  /** Bayesian shrinkage: features seen fewer times are pulled toward 0. */
  priorStrength?: number;
}

export function featuresOf(t: Title): string[] {
  const f: string[] = [];
  for (const g of t.genres) f.push(`genre:${g}`);
  for (const d of t.directors) f.push(`director:${d}`);
  for (const c of (t.cast ?? []).slice(0, 5)) f.push(`cast:${c}`);
  for (const k of t.keywords ?? []) f.push(`keyword:${k}`);
  if (t.language) f.push(`language:${t.language}`);
  if (t.year) f.push(`decade:${Math.floor(t.year / 10) * 10}s`);
  return f;
}

export function buildProfile(
  ratings: readonly Rating[],
  catalogue: ReadonlyMap<string, Title>,
  opts: ProfileOptions = {},
): TasteProfile {
  const signals = opts.signals ?? DEFAULT_SIGNALS;
  // Age is measured from the newest rating, not the wall clock: a break from
  // rating shouldn't make the whole profile fade.
  const now = opts.now ?? new Date(Math.max(0, ...ratings.map((r) => r.ratedAt.getTime())));
  const halfLife = opts.halfLifeDays ?? 730;
  const prior = opts.priorStrength ?? 2;

  const sum = new Map<string, number>();
  const weight = new Map<string, number>();
  let centroid: number[] | undefined;
  let centroidWeight = 0;
  const meanRating = ratings.length ? ratings.reduce((a, r) => a + r.rating, 0) / ratings.length : 6.5;

  for (const r of ratings) {
    const t = catalogue.get(r.titleId);
    if (!t) continue;
    const s = ratingToSignal(r.rating, signals, meanRating);
    const w = recencyWeight(r.ratedAt, now, halfLife);

    for (const f of featuresOf(t)) {
      sum.set(f, (sum.get(f) ?? 0) + s * w);
      weight.set(f, (weight.get(f) ?? 0) + w);
    }
    if (t.embedding) {
      centroid = addScaled(centroid ?? [], t.embedding, s * w);
      centroidWeight += Math.abs(s * w);
    }
  }

  const affinities = new Map<string, number>();
  for (const [f, s] of sum) affinities.set(f, s / ((weight.get(f) ?? 0) + prior));

  if (centroid && centroidWeight > 0) centroid = centroid.map((x) => x / centroidWeight);

  return {
    affinities,
    support: weight,
    centroid,
    meanRating,
    ratedIds: new Set(ratings.map((r) => r.titleId)),
  };
}
