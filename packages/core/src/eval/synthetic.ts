import type { Rating, Title } from "../types.js";

/** Small seeded PRNG (mulberry32) so synthetic datasets are reproducible. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const GENRES = ["Drama", "Comedy", "Thriller", "Crime", "Sci-Fi", "Romance", "Horror", "Documentary", "Animation", "Mystery", "Action", "Fantasy"];

export interface SyntheticDataset {
  catalogue: Map<string, Title>;
  ratings: Rating[];
}

/**
 * Generate a fictional catalogue and one user whose ratings follow hidden genre
 * and director preferences plus noise. Titles and IDs are synthetic ("syn0001")
 * and do not correspond to real films. This exists so the evaluation pipeline
 * can be run and tested without anyone's personal data.
 */
export function generateSynthetic(opts: { seed?: number; titles?: number; rated?: number; drift?: boolean } = {}): SyntheticDataset {
  const rand = mulberry32(opts.seed ?? 42);
  const nTitles = opts.titles ?? 1500;
  const nRated = Math.min(opts.rated ?? 400, nTitles);
  const directors = Array.from({ length: 400 }, (_, i) => `Director ${i + 1}`);
  const pick = <T>(xs: readonly T[]) => xs[Math.floor(rand() * xs.length)]!;

  const genrePref = new Map(GENRES.map((g) => [g, rand() * 2 - 1]));
  const directorPref = new Map(directors.map((d) => [d, (rand() * 2 - 1) * 1.5]));
  // Taste drift: later in time, one disliked genre becomes liked.
  const driftGenre = [...genrePref.entries()].sort((a, b) => a[1] - b[1])[0]![0];

  const catalogue = new Map<string, Title>();
  const quality = new Map<string, number>();
  for (let i = 0; i < nTitles; i++) {
    const id = `syn${String(i + 1).padStart(4, "0")}`;
    const genres = [...new Set([pick(GENRES), pick(GENRES), ...(rand() < 0.4 ? [pick(GENRES)] : [])])];
    const q = rand() * 2 - 1;
    quality.set(id, q);
    catalogue.set(id, {
      id,
      title: `Synthetic Title ${i + 1}`,
      type: rand() < 0.75 ? "movie" : "tvSeries",
      year: 1970 + Math.floor(rand() * 55),
      runtimeMinutes: 80 + Math.floor(rand() * 90),
      genres,
      directors: [pick(directors)],
      imdbRating: Math.round((6.5 + 1.2 * q + (rand() - 0.5)) * 10) / 10,
      numVotes: Math.floor(10 ** (2 + rand() * 4)),
    });
  }

  const ids = [...catalogue.keys()];
  for (let i = ids.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [ids[i], ids[j]] = [ids[j]!, ids[i]!];
  }
  const start = new Date("2019-01-01").getTime();
  const span = 6 * 365 * 86_400_000;
  const ratings: Rating[] = ids.slice(0, nRated).map((id, i) => {
    const t = catalogue.get(id)!;
    const ratedAt = new Date(start + (span * i) / nRated);
    const late = opts.drift !== false && i > nRated * 0.6;
    const g = t.genres.reduce((s, x) => s + (late && x === driftGenre ? 1 : genrePref.get(x)!), 0) / t.genres.length;
    const latent = 1.6 * g + 0.8 * directorPref.get(t.directors[0]!)! + 0.9 * quality.get(id)! + (rand() - 0.5) * 1.5;
    return { titleId: id, rating: Math.max(1, Math.min(10, Math.round(6.5 + 1.6 * latent))), ratedAt };
  });

  return { catalogue, ratings };
}
