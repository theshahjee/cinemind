import type { Rating, Title } from "./types.js";

/**
 * Linear model of how the user's rating relates to the public IMDb rating:
 * userRating ~ intercept + slope * imdbRating. Captures habits such as
 * "rates everything a point below consensus" or "ignores consensus entirely".
 */
export interface RatingModel {
  intercept: number;
  slope: number;
  /** Number of ratings the fit used. Below ~10 the model falls back to the mean. */
  n: number;
  meanRating: number;
}

export function fitRatingModel(ratings: readonly Rating[], catalogue: ReadonlyMap<string, Title>): RatingModel {
  const pairs: [number, number][] = [];
  for (const r of ratings) {
    const x = catalogue.get(r.titleId)?.imdbRating;
    if (x !== undefined) pairs.push([x, r.rating]);
  }
  const meanRating = ratings.length ? ratings.reduce((s, r) => s + r.rating, 0) / ratings.length : 6.5;
  if (pairs.length < 10) return { intercept: meanRating, slope: 0, n: pairs.length, meanRating };

  const mx = pairs.reduce((s, p) => s + p[0], 0) / pairs.length;
  const my = pairs.reduce((s, p) => s + p[1], 0) / pairs.length;
  let cov = 0;
  let varX = 0;
  for (const [x, y] of pairs) {
    cov += (x - mx) * (y - my);
    varX += (x - mx) ** 2;
  }
  const slope = varX === 0 ? 0 : cov / varX;
  return { intercept: my - slope * mx, slope, n: pairs.length, meanRating };
}

export function predictFromModel(model: RatingModel, title: Title): number {
  if (title.imdbRating === undefined) return model.meanRating;
  return clamp(model.intercept + model.slope * title.imdbRating, 1, 10);
}

export function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x));
}
