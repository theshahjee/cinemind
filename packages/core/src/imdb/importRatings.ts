import type { Rating, Title, TitleType } from "../types.js";
import { parseCsv } from "./csv.js";

export interface ImdbImportResult {
  titles: Title[];
  ratings: Rating[];
  /** Rows that could not be parsed, with the reason. */
  skipped: { line: number; reason: string }[];
}

const REQUIRED = ["Const", "Your Rating", "Date Rated", "Title"] as const;

const TYPE_MAP: Record<string, TitleType> = {
  movie: "movie",
  "tv series": "tvSeries",
  tvseries: "tvSeries",
  "tv mini series": "tvMiniSeries",
  tvminiseries: "tvMiniSeries",
  "tv movie": "tvMovie",
  tvmovie: "tvMovie",
  "tv episode": "tvEpisode",
  tvepisode: "tvEpisode",
  short: "short",
};

/**
 * Parse the ratings CSV that IMDb produces from "Your Ratings" > Export.
 * Column order has changed over the years, so columns are looked up by header name.
 */
export function importImdbRatings(csv: string): ImdbImportResult {
  const rows = parseCsv(csv);
  const header = rows[0];
  if (!header) throw new Error("CSV is empty");

  const col = new Map(header.map((h, i) => [h.trim(), i]));
  for (const name of REQUIRED) {
    if (!col.has(name)) throw new Error(`Missing required column "${name}". Is this an IMDb ratings export?`);
  }
  const get = (r: string[], name: string) => {
    const i = col.get(name);
    return i === undefined ? "" : (r[i] ?? "").trim();
  };

  const titles: Title[] = [];
  const ratings: Rating[] = [];
  const skipped: ImdbImportResult["skipped"] = [];

  rows.slice(1).forEach((r, idx) => {
    const line = idx + 2;
    const id = get(r, "Const");
    const rating = Number(get(r, "Your Rating"));
    const ratedAt = new Date(get(r, "Date Rated"));

    if (!/^tt\d+$/.test(id)) return skipped.push({ line, reason: `invalid id "${id}"` });
    if (!Number.isInteger(rating) || rating < 1 || rating > 10) {
      return skipped.push({ line, reason: `invalid rating "${get(r, "Your Rating")}"` });
    }
    if (Number.isNaN(ratedAt.getTime())) return skipped.push({ line, reason: "invalid date" });

    titles.push({
      id,
      title: get(r, "Title"),
      type: TYPE_MAP[get(r, "Title Type").toLowerCase()] ?? "other",
      year: optionalNumber(get(r, "Year")),
      runtimeMinutes: optionalNumber(get(r, "Runtime (mins)")),
      genres: splitList(get(r, "Genres")),
      directors: splitList(get(r, "Directors")),
      imdbRating: optionalNumber(get(r, "IMDb Rating")),
      numVotes: optionalNumber(get(r, "Num Votes")),
    });
    ratings.push({ titleId: id, rating, ratedAt });
  });

  return { titles, ratings, skipped };
}

function optionalNumber(v: string): number | undefined {
  if (v === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

function splitList(v: string): string[] {
  return v
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}
