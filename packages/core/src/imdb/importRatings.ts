import type { Rating, Title, TitleType } from "../types.js";
import { parseCsv } from "./csv.js";

export type ImdbExportKind = "ratings" | "list";

export interface ImdbImportResult {
  kind: ImdbExportKind;
  titles: Title[];
  /** Ratings found in the file. For a list export, only rows the user had also rated. */
  ratings: Rating[];
  /** For a list or watchlist export: the titles on the list, in list order. */
  listIds: string[];
  /** Rows that could not be parsed, with the reason. */
  skipped: { line: number; reason: string }[];
}

/** The file isn't a usable IMDb ratings export (as opposed to an unexpected failure). */
export class ImportFormatError extends Error {}

const REQUIRED_RATINGS = ["Const", "Your Rating", "Date Rated", "Title"] as const;
const REQUIRED_LIST = ["Const", "Title"] as const;

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
 * Parse a CSV exported from IMDb: either "Your Ratings" or a list such as the
 * Watchlist. List exports carry a "Position" column; ratings exports don't.
 * Column order has changed over the years, so columns are looked up by header name.
 */
export function importImdbRatings(csv: string): ImdbImportResult {
  const rows = parseCsv(csv);
  const header = rows[0];
  if (!header) throw new ImportFormatError("CSV is empty");

  const col = new Map(header.map((h, i) => [h.trim(), i]));
  const kind: ImdbExportKind = col.has("Position") ? "list" : "ratings";
  for (const name of kind === "list" ? REQUIRED_LIST : REQUIRED_RATINGS) {
    if (!col.has(name)) throw new ImportFormatError(`Missing required column "${name}". Is this an IMDb ratings or watchlist export?`);
  }
  const get = (r: string[], name: string) => {
    const i = col.get(name);
    return i === undefined ? "" : (r[i] ?? "").trim();
  };

  const titles: Title[] = [];
  const ratings: Rating[] = [];
  const listIds: string[] = [];
  const skipped: ImdbImportResult["skipped"] = [];

  rows.slice(1).forEach((r, idx) => {
    const line = idx + 2;
    const id = get(r, "Const");
    const rawRating = get(r, "Your Rating");
    const rating = Number(rawRating);
    const ratedAt = new Date(get(r, "Date Rated"));

    if (!/^tt\d+$/.test(id)) return skipped.push({ line, reason: `invalid id "${id}"` });
    if (kind === "ratings") {
      if (!Number.isInteger(rating) || rating < 1 || rating > 10) return skipped.push({ line, reason: `invalid rating "${rawRating}"` });
      if (Number.isNaN(ratedAt.getTime())) return skipped.push({ line, reason: "invalid date" });
    }

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
    if (kind === "list") {
      listIds.push(id);
      // A list row may also carry the user's rating; keep it only if it's complete.
      if (rawRating && Number.isInteger(rating) && rating >= 1 && rating <= 10 && !Number.isNaN(ratedAt.getTime())) {
        ratings.push({ titleId: id, rating, ratedAt });
      }
    } else {
      ratings.push({ titleId: id, rating, ratedAt });
    }
  });

  return { kind, titles, ratings, listIds, skipped };
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
