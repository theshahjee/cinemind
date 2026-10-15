import { readFileSync } from "node:fs";
import { importImdbRatings } from "../imdb/importRatings.js";
import {
  contentRecommender,
  hybridNoDiversityRecommender,
  hybridRecommender,
  hybridTunedRecommender,
  popularityRecommender,
} from "../recommenders.js";
import type { Title } from "../types.js";
import { averageResults, evaluate, formatResults, type EvalResult } from "./runner.js";
import { generateSynthetic } from "./synthetic.js";

/**
 * Usage:
 *   pnpm eval                       # synthetic dataset (reproducible, no personal data)
 *   pnpm eval -- path/to/ratings.csv [--k 10]
 */
const args = process.argv.slice(2).filter((a) => a !== "--");
const kIdx = args.indexOf("--k");
const k = kIdx >= 0 ? Number(args[kIdx + 1]) : 10;
const file = args.find((a, i) => !a.startsWith("--") && args[i - 1] !== "--k");

const models = [
  popularityRecommender,
  contentRecommender,
  hybridTunedRecommender,
  hybridNoDiversityRecommender,
  hybridRecommender,
];
let results: EvalResult[];
let source: string;

if (file) {
  const res = importImdbRatings(readFileSync(file, "utf8"));
  const catalogue = new Map<string, Title>(res.titles.map((t) => [t.id, t]));
  results = evaluate(models, res.ratings, catalogue, { k });
  source = `${file} (${res.ratings.length} ratings, catalogue limited to rated titles)`;
} else {
  const seeds = [1, 2, 3, 4, 5];
  results = averageResults(
    seeds.map((seed) => {
      const syn = generateSynthetic({ seed });
      return evaluate(models, syn.ratings, syn.catalogue, { k });
    }),
  );
  source = `synthetic data, mean of seeds ${seeds.join(", ")} (400 ratings and 1500 titles each)`;
}

console.log(`Source: ${source}\nSplit: chronological 80/20, ranking the held-out titles\n`);
console.log(formatResults(results));
