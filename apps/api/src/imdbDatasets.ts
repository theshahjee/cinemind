import { createInterface } from "node:readline";
import { Readable } from "node:stream";
import { createGunzip } from "node:zlib";
import type { Title, TitleType } from "@cinemind/core";

/**
 * Builds a candidate catalogue from IMDb's non-commercial datasets
 * (https://developer.imdb.com/non-commercial-datasets/). Without this, the
 * catalogue only holds titles the user already rated, so there is nothing new
 * to recommend. Personal, non-commercial use only, per IMDb's terms.
 */
export const DATASET_BASE = "https://datasets.imdbws.com";

const TYPES: Record<string, TitleType> = { movie: "movie", tvSeries: "tvSeries", tvMiniSeries: "tvMiniSeries", tvMovie: "tvMovie" };

export interface SeedOptions {
  minVotes: number;
  types: TitleType[];
}

const nul = (v: string | undefined) => (v === undefined || v === "\\N" ? undefined : v);

/** title.ratings.tsv: tconst, averageRating, numVotes. Keeps titles with enough votes. */
export async function readRatings(lines: AsyncIterable<string>, minVotes: number): Promise<Map<string, { rating: number; votes: number }>> {
  const out = new Map<string, { rating: number; votes: number }>();
  let header = true;
  for await (const line of lines) {
    if (header) {
      header = false;
      continue;
    }
    const [id, rating, votes] = line.split("\t");
    const v = Number(votes);
    if (id && v >= minVotes) out.set(id, { rating: Number(rating), votes: v });
  }
  return out;
}

/** title.basics.tsv: tconst, titleType, primaryTitle, originalTitle, isAdult, startYear, endYear, runtimeMinutes, genres. */
export async function readBasics(
  lines: AsyncIterable<string>,
  ratings: ReadonlyMap<string, { rating: number; votes: number }>,
  types: readonly TitleType[],
): Promise<Map<string, Title>> {
  const out = new Map<string, Title>();
  let header = true;
  for await (const line of lines) {
    if (header) {
      header = false;
      continue;
    }
    const [id, rawType, title, , isAdult, year, , runtime, genres] = line.split("\t");
    const type = TYPES[rawType ?? ""];
    const r = ratings.get(id ?? "");
    if (!id || !type || !r || !title || isAdult === "1" || !types.includes(type)) continue;
    out.set(id, {
      id,
      title,
      type,
      year: nul(year) ? Number(year) : undefined,
      runtimeMinutes: nul(runtime) ? Number(runtime) : undefined,
      genres: nul(genres)?.split(",") ?? [],
      directors: [],
      imdbRating: r.rating,
      numVotes: r.votes,
    });
  }
  return out;
}

/** title.crew.tsv: tconst, directors (nm ids), writers. Returns director ids per kept title. */
export async function readCrew(lines: AsyncIterable<string>, keep: ReadonlySet<string>): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  let header = true;
  for await (const line of lines) {
    if (header) {
      header = false;
      continue;
    }
    const [id, directors] = line.split("\t");
    if (id && keep.has(id) && nul(directors)) out.set(id, directors!.split(",").slice(0, 3));
  }
  return out;
}

/** name.basics.tsv: nconst, primaryName, ... Resolves only the ids we need. */
export async function readNames(lines: AsyncIterable<string>, wanted: ReadonlySet<string>): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  let header = true;
  for await (const line of lines) {
    if (header) {
      header = false;
      continue;
    }
    const tab = line.indexOf("\t");
    const id = line.slice(0, tab);
    if (!wanted.has(id)) continue;
    const end = line.indexOf("\t", tab + 1);
    out.set(id, line.slice(tab + 1, end < 0 ? undefined : end));
  }
  return out;
}

/** Stream a gzipped TSV from the dataset server line by line, without holding it in memory. */
export async function* fetchLines(file: string, fetchImpl: typeof fetch = fetch): AsyncGenerator<string> {
  const res = await fetchImpl(`${DATASET_BASE}/${file}`);
  if (!res.ok || !res.body) throw new Error(`Download of ${file} failed with ${res.status}`);
  const stream = Readable.fromWeb(res.body as import("node:stream/web").ReadableStream).pipe(createGunzip());
  yield* createInterface({ input: stream, crlfDelay: Infinity });
}

export async function buildCatalogue(
  opts: SeedOptions,
  open: (file: string) => AsyncIterable<string> = (f) => fetchLines(f),
  log: (msg: string) => void = () => {},
): Promise<Title[]> {
  const ratings = await readRatings(open("title.ratings.tsv.gz"), opts.minVotes);
  log(`${ratings.size} titles with at least ${opts.minVotes} votes`);
  const titles = await readBasics(open("title.basics.tsv.gz"), ratings, opts.types);
  log(`${titles.size} of them are ${opts.types.join(", ")}`);
  const crew = await readCrew(open("title.crew.tsv.gz"), new Set(titles.keys()));
  const names = await readNames(open("name.basics.tsv.gz"), new Set([...crew.values()].flat()));
  for (const [id, ids] of crew) {
    titles.get(id)!.directors = ids.flatMap((n) => names.get(n) ?? []);
  }
  log(`resolved directors for ${crew.size} titles`);
  return [...titles.values()];
}
