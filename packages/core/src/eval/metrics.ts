export function precisionAtK(ranked: readonly string[], relevant: ReadonlySet<string>, k: number): number {
  if (k <= 0) return 0;
  const top = ranked.slice(0, k);
  return top.filter((id) => relevant.has(id)).length / k;
}

export function recallAtK(ranked: readonly string[], relevant: ReadonlySet<string>, k: number): number {
  if (relevant.size === 0) return 0;
  return ranked.slice(0, k).filter((id) => relevant.has(id)).length / relevant.size;
}

/**
 * NDCG@K with graded relevance. `gains` maps a title to its gain (for example
 * rating - threshold); missing titles have gain 0.
 */
export function ndcgAtK(ranked: readonly string[], gains: ReadonlyMap<string, number>, k: number): number {
  const dcg = ranked.slice(0, k).reduce((s, id, i) => s + ((2 ** (gains.get(id) ?? 0) - 1) / Math.log2(i + 2)), 0);
  const ideal = [...gains.values()]
    .filter((g) => g > 0)
    .sort((a, b) => b - a)
    .slice(0, k)
    .reduce((s, g, i) => s + (2 ** g - 1) / Math.log2(i + 2), 0);
  return ideal === 0 ? 0 : dcg / ideal;
}

export function rmse(pairs: readonly [predicted: number, actual: number][]): number {
  if (pairs.length === 0) return NaN;
  return Math.sqrt(pairs.reduce((s, [p, a]) => s + (p - a) ** 2, 0) / pairs.length);
}

export function mae(pairs: readonly [predicted: number, actual: number][]): number {
  if (pairs.length === 0) return NaN;
  return pairs.reduce((s, [p, a]) => s + Math.abs(p - a), 0) / pairs.length;
}

/** Share of the candidate pool that appears in at least one recommendation list. */
export function catalogueCoverage(lists: readonly (readonly string[])[], poolSize: number): number {
  if (poolSize === 0) return 0;
  return new Set(lists.flat()).size / poolSize;
}
