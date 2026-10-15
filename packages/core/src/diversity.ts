import { featuresOf } from "./profile.js";
import type { ScoredTitle } from "./scoring.js";
import type { Title } from "./types.js";
import { cosine } from "./vector.js";

/** Similarity between two titles: embedding cosine when both have one, else Jaccard over features. */
export function titleSimilarity(a: Title, b: Title): number {
  if (a.embedding && b.embedding) return Math.max(0, cosine(a.embedding, b.embedding));
  const fa = new Set(featuresOf(a));
  const fb = new Set(featuresOf(b));
  if (fa.size === 0 && fb.size === 0) return 0;
  let inter = 0;
  for (const f of fa) if (fb.has(f)) inter++;
  return inter / (fa.size + fb.size - inter);
}

/**
 * Maximal Marginal Relevance re-ranking. `lambda` = 1 keeps the original order;
 * lower values trade relevance for variety so the list isn't twenty near-identical films.
 */
export function mmrRerank(items: readonly ScoredTitle[], k: number, lambda = 0.75): ScoredTitle[] {
  const pool = [...items];
  const picked: ScoredTitle[] = [];
  // Scale relevance to [0, 1] so it is comparable with similarity, whatever the scorer's range.
  const lo = Math.min(...pool.map((p) => p.score));
  const span = Math.max(...pool.map((p) => p.score)) - lo || 1;
  const rel = (s: ScoredTitle) => (s.score - lo) / span;
  while (picked.length < k && pool.length > 0) {
    let bestIdx = 0;
    let bestVal = -Infinity;
    for (let i = 0; i < pool.length; i++) {
      const cand = pool[i]!;
      const maxSim = picked.reduce((m, p) => Math.max(m, titleSimilarity(cand.title, p.title)), 0);
      const val = lambda * rel(cand) - (1 - lambda) * maxSim;
      if (val > bestVal) {
        bestVal = val;
        bestIdx = i;
      }
    }
    picked.push(pool.splice(bestIdx, 1)[0]!);
  }
  return picked;
}

/** 1 - mean pairwise similarity. Higher means a more varied list. */
export function intraListDiversity(titles: readonly Title[]): number {
  if (titles.length < 2) return 0;
  let s = 0;
  let n = 0;
  for (let i = 0; i < titles.length; i++) {
    for (let j = i + 1; j < titles.length; j++) {
      s += titleSimilarity(titles[i]!, titles[j]!);
      n++;
    }
  }
  return 1 - s / n;
}
