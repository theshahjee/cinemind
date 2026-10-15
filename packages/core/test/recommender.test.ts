import { describe, expect, it } from "vitest";
import {
  buildProfile,
  DEFAULT_SIGNALS,
  fitRatingModel,
  hybridRecommender,
  mmrRerank,
  ratingToSignal,
  recencyWeight,
  scoreTitle,
  type Rating,
  type Title,
} from "../src/index.js";

const t = (id: string, genres: string[], directors: string[] = [], extra: Partial<Title> = {}): Title => ({
  id,
  title: id,
  type: "movie",
  genres,
  directors,
  ...extra,
});
const r = (titleId: string, rating: number, date = "2025-01-01"): Rating => ({ titleId, rating, ratedAt: new Date(date) });

describe("signals", () => {
  it("centres ratings on the user's own mean by default", () => {
    expect(ratingToSignal(7, DEFAULT_SIGNALS, 7)).toBe(0);
    expect(ratingToSignal(10, DEFAULT_SIGNALS, 7)).toBe(1);
    expect(ratingToSignal(8, DEFAULT_SIGNALS, 5)).toBe(1);
    expect(ratingToSignal(5, DEFAULT_SIGNALS, 7)).toBeCloseTo(-2 / 3);
  });

  it("supports fixed thresholds", () => {
    const cfg = { ...DEFAULT_SIGNALS, mode: "thresholds" as const };
    expect(ratingToSignal(9, cfg)).toBe(1);
    expect(ratingToSignal(7, cfg)).toBe(0.5);
    expect(ratingToSignal(5, cfg)).toBeLessThan(0);
    expect(ratingToSignal(2, cfg)).toBe(-1);
    expect(ratingToSignal(7, { ...cfg, strongPositive: 7 })).toBe(1);
  });

  it("halves weight after one half-life", () => {
    const now = new Date("2025-01-01");
    expect(recencyWeight(new Date("2024-01-02"), now, 365)).toBeCloseTo(0.5, 2);
  });
});

describe("hybrid recommender", () => {
  const catalogue = new Map(
    [
      t("liked1", ["Thriller", "Crime"], ["A"]),
      t("liked2", ["Thriller"], ["A"]),
      t("hated", ["Romance"], ["B"]),
      t("candThriller", ["Thriller", "Crime"], ["A"]),
      t("candRomance", ["Romance"], ["B"]),
      t("candOther", ["Documentary"], ["C"]),
    ].map((x) => [x.id, x]),
  );
  const ratings = [r("liked1", 9), r("liked2", 10), r("hated", 2)];

  it("ranks titles that share liked features above disliked ones", () => {
    const recs = hybridRecommender.recommend({ ratings, catalogue, k: 3 });
    const ids = recs.map((x) => x.title.id);
    expect(ids[0]).toBe("candThriller");
    expect(ids.indexOf("candRomance")).toBeGreaterThan(ids.indexOf("candOther"));
  });

  it("never recommends already-rated titles", () => {
    const ids = hybridRecommender.recommend({ ratings, catalogue, k: 10 }).map((x) => x.title.id);
    expect(ids).not.toContain("liked1");
    expect(ids).not.toContain("hated");
  });

  it("explains matches and conflicts", () => {
    const profile = buildProfile(ratings, catalogue);
    const model = fitRatingModel(ratings, catalogue);
    expect(scoreTitle(profile, model, catalogue.get("candThriller")!).explanation.matches).toContain("genre:Thriller");
    expect(scoreTitle(profile, model, catalogue.get("candRomance")!).explanation.conflicts).toContain("genre:Romance");
  });

  it("uses embeddings when available", () => {
    const cat = new Map(
      [
        t("a", [], [], { embedding: [1, 0] }),
        t("near", [], [], { embedding: [0.9, 0.1] }),
        t("far", [], [], { embedding: [-1, 0] }),
      ].map((x) => [x.id, x]),
    );
    const ids = hybridRecommender.recommend({ ratings: [r("a", 10)], catalogue: cat, k: 2 }).map((x) => x.title.id);
    expect(ids).toEqual(["near", "far"]);
  });
});

describe("mmrRerank", () => {
  it("promotes variety over near-duplicates", () => {
    const items = [
      { title: t("x1", ["Horror"], ["D"]), score: 1 },
      { title: t("x2", ["Horror"], ["D"]), score: 0.99 },
      { title: t("y", ["Comedy"], ["E"]), score: 0.9 },
    ].map((i) => ({ ...i, explanation: { matches: [], conflicts: [], signals: { content: 0, features: 0, personal: 0 } } }));
    expect(mmrRerank(items, 2, 0.5).map((i) => i.title.id)).toEqual(["x1", "y"]);
    expect(mmrRerank(items, 2, 1).map((i) => i.title.id)).toEqual(["x1", "x2"]);
  });
});
