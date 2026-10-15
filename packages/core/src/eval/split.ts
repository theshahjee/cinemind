import type { Rating } from "../types.js";

/**
 * Chronological split: the oldest `trainFraction` of ratings train the model,
 * the newest are held out. A random split would let future taste leak into training.
 */
export function chronologicalSplit(ratings: readonly Rating[], trainFraction = 0.8): { train: Rating[]; test: Rating[] } {
  const sorted = [...ratings].sort((a, b) => a.ratedAt.getTime() - b.ratedAt.getTime());
  const cut = Math.floor(sorted.length * trainFraction);
  return { train: sorted.slice(0, cut), test: sorted.slice(cut) };
}
