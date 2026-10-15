import { intraListDiversity } from "../diversity.js";
import type { Recommender } from "../recommenders.js";
import { DEFAULT_SIGNALS } from "../signals.js";
import type { Rating, Title } from "../types.js";
import { catalogueCoverage, mae, ndcgAtK, precisionAtK, recallAtK, rmse } from "./metrics.js";
import { chronologicalSplit } from "./split.js";

export interface EvalResult {
  name: string;
  k: number;
  precision: number;
  recall: number;
  ndcg: number;
  rmse: number;
  mae: number;
  coverage: number;
  diversity: number;
  /** NDCG measured only on test titles whose director never appeared in training. */
  coldStartNdcg: number;
}

export interface EvalOptions {
  k?: number;
  trainFraction?: number;
  /** Ratings at or above this count as relevant. */
  relevantThreshold?: number;
}

/**
 * Train on the oldest ratings, then ask each model to rank the held-out titles.
 * The question is "does it put the titles you went on to love first?". Ranking
 * against titles the user never rated would mostly measure what they happened
 * to watch, not what they liked.
 *
 * Coverage and diversity are measured on a separate top-K list drawn from every
 * title not rated in training, because that is the list a user would actually see.
 */
export function evaluate(
  recommenders: readonly Recommender[],
  ratings: readonly Rating[],
  catalogue: ReadonlyMap<string, Title>,
  opts: EvalOptions = {},
): EvalResult[] {
  const k = opts.k ?? 10;
  const threshold = opts.relevantThreshold ?? DEFAULT_SIGNALS.strongPositive;
  const { train, test } = chronologicalSplit(ratings, opts.trainFraction);
  const now = test[0]?.ratedAt ?? new Date();

  const testIds = test.map((r) => r.titleId);
  const relevant = new Set(test.filter((r) => r.rating >= threshold).map((r) => r.titleId));
  const gains = new Map(test.map((r) => [r.titleId, Math.max(0, r.rating - threshold + 1)]));

  const trainDirectors = new Set(train.flatMap((r) => catalogue.get(r.titleId)?.directors ?? []));
  const coldIds = testIds.filter((id) => !(catalogue.get(id)?.directors ?? []).some((d) => trainDirectors.has(d)));
  const coldGains = new Map([...gains].filter(([id]) => coldIds.includes(id)));

  const trainIds = new Set(train.map((r) => r.titleId));
  const openPool = [...catalogue.keys()].filter((id) => !trainIds.has(id));

  return recommenders.map((rec) => {
    const base = { ratings: train, catalogue, now };
    const ranked = rec.recommend({ ...base, candidates: testIds, k }).map((s) => s.title.id);
    const coldRanked = coldIds.length ? rec.recommend({ ...base, candidates: coldIds, k }).map((s) => s.title.id) : [];
    const shown = rec.recommend({ ...base, candidates: openPool, k });

    const pairs: [number, number][] = rec.predict ? test.map((r) => [rec.predict!(base, r.titleId), r.rating]) : [];

    return {
      name: rec.name,
      k,
      precision: precisionAtK(ranked, relevant, k),
      recall: recallAtK(ranked, relevant, k),
      ndcg: ndcgAtK(ranked, gains, k),
      rmse: rmse(pairs),
      mae: mae(pairs),
      coverage: catalogueCoverage([shown.map((s) => s.title.id)], openPool.length),
      diversity: intraListDiversity(shown.map((s) => s.title)),
      coldStartNdcg: coldIds.length ? ndcgAtK(coldRanked, coldGains, k) : NaN,
    };
  });
}

/** Average results from several runs (for example, several synthetic seeds), model by model. */
export function averageResults(runs: readonly EvalResult[][]): EvalResult[] {
  const first = runs[0] ?? [];
  return first.map((r, i) => {
    const rows = runs.map((run) => run[i]!);
    const avg = (key: keyof Omit<EvalResult, "name" | "k">) => {
      const vals = rows.map((x) => x[key]).filter((v) => !Number.isNaN(v));
      return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : NaN;
    };
    return {
      name: r.name,
      k: r.k,
      precision: avg("precision"),
      recall: avg("recall"),
      ndcg: avg("ndcg"),
      rmse: avg("rmse"),
      mae: avg("mae"),
      coverage: avg("coverage"),
      diversity: avg("diversity"),
      coldStartNdcg: avg("coldStartNdcg"),
    };
  });
}

export function formatResults(results: readonly EvalResult[]): string {
  const f = (x: number) => (Number.isNaN(x) ? "n/a" : x.toFixed(3));
  const k = results[0]?.k ?? 10;
  const head = `| Model | P@${k} | R@${k} | NDCG@${k} | RMSE | MAE | Coverage | Diversity | Cold-start NDCG@${k} |`;
  const sep = "|---|---|---|---|---|---|---|---|---|";
  const rows = results.map(
    (r) =>
      `| ${r.name} | ${f(r.precision)} | ${f(r.recall)} | ${f(r.ndcg)} | ${f(r.rmse)} | ${f(r.mae)} | ${f(r.coverage)} | ${f(r.diversity)} | ${f(r.coldStartNdcg)} |`,
  );
  return [head, sep, ...rows].join("\n");
}
