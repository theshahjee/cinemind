import { describe, expect, it } from "vitest";
import {
  chronologicalSplit,
  evaluate,
  generateSynthetic,
  averageResults,
  hybridNoDiversityRecommender,
  ndcgAtK,
  popularityRecommender,
  precisionAtK,
  recallAtK,
  rmse,
} from "../src/index.js";

describe("metrics", () => {
  const rel = new Set(["a", "c"]);
  it("computes precision and recall", () => {
    expect(precisionAtK(["a", "b", "c", "d"], rel, 4)).toBe(0.5);
    expect(recallAtK(["a", "b"], rel, 2)).toBe(0.5);
  });

  it("gives NDCG 1 for an ideal ranking and less otherwise", () => {
    const gains = new Map([
      ["a", 3],
      ["c", 1],
    ]);
    expect(ndcgAtK(["a", "c", "b"], gains, 3)).toBeCloseTo(1);
    expect(ndcgAtK(["b", "c", "a"], gains, 3)).toBeLessThan(1);
  });

  it("computes RMSE", () => {
    expect(rmse([
      [5, 7],
      [7, 7],
    ])).toBeCloseTo(Math.sqrt(2));
  });
});

describe("chronologicalSplit", () => {
  it("keeps the newest ratings for testing", () => {
    const ratings = [3, 1, 2, 4, 5].map((d) => ({ titleId: `t${d}`, rating: 7, ratedAt: new Date(2024, 0, d) }));
    const { train, test } = chronologicalSplit(ratings, 0.6);
    expect(train.map((r) => r.titleId)).toEqual(["t1", "t2", "t3"]);
    expect(test.map((r) => r.titleId)).toEqual(["t4", "t5"]);
  });
});

describe("evaluate on synthetic data", () => {
  const models = [popularityRecommender, hybridNoDiversityRecommender];
  const runSeed = (seed: number) => {
    const { catalogue, ratings } = generateSynthetic({ seed, titles: 600, rated: 300 });
    return evaluate(models, ratings, catalogue, { k: 20 });
  };

  it("is reproducible for a fixed seed", () => {
    expect(runSeed(7)).toEqual(runSeed(7));
  });

  it("hybrid scoring beats the popularity baseline on NDCG, averaged over seeds", () => {
    const [pop, hybrid] = averageResults([1, 2, 3, 4, 5].map(runSeed));
    expect(hybrid!.ndcg).toBeGreaterThan(pop!.ndcg);
    expect(hybrid!.rmse).toBeLessThan(3);
  });
});
