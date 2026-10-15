import type { Title } from "@cinemind/core";

const BASE = "https://api.themoviedb.org/3";

interface FindResponse {
  movie_results: { id: number }[];
  tv_results: { id: number }[];
}

interface Details {
  id: number;
  overview?: string;
  poster_path?: string | null;
  original_language?: string;
  runtime?: number;
  episode_run_time?: number[];
  genres?: { name: string }[];
  credits?: { cast?: { name: string }[]; crew?: { job: string; name: string }[] };
  aggregate_credits?: { cast?: { name: string }[] };
  created_by?: { name: string }[];
  keywords?: { keywords?: { name: string }[]; results?: { name: string }[] };
}

export interface TmdbEnrichment {
  tmdbId: number;
  overview?: string;
  posterPath?: string;
  patch: Partial<Title>;
}

/**
 * Minimal TMDB client. TMDB requires attribution wherever its data is shown;
 * the web app's footer carries it.
 */
export class TmdbClient {
  constructor(
    private readonly token: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private async get<T>(path: string): Promise<T> {
    const res = await this.fetchImpl(`${BASE}${path}`, {
      headers: { authorization: `Bearer ${this.token}`, accept: "application/json" },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`TMDB ${path} failed with ${res.status}`);
    return (await res.json()) as T;
  }

  /** Look a title up by IMDb id and return the metadata CineMind uses. */
  async enrich(imdbId: string): Promise<TmdbEnrichment | undefined> {
    const found = await this.get<FindResponse>(`/find/${imdbId}?external_source=imdb_id`);
    const movie = found.movie_results[0];
    const tv = found.tv_results[0];
    if (!movie && !tv) return undefined;

    const kind = movie ? "movie" : "tv";
    const extra = movie ? "credits,keywords" : "aggregate_credits,keywords";
    const d = await this.get<Details>(`/${kind}/${(movie ?? tv)!.id}?append_to_response=${extra}`);

    const cast = (d.credits?.cast ?? d.aggregate_credits?.cast ?? []).slice(0, 10).map((c) => c.name);
    const directors = movie
      ? (d.credits?.crew ?? []).filter((c) => c.job === "Director").map((c) => c.name)
      : (d.created_by ?? []).map((c) => c.name);
    const keywords = (d.keywords?.keywords ?? d.keywords?.results ?? []).slice(0, 20).map((k) => k.name);

    return {
      tmdbId: d.id,
      overview: d.overview || undefined,
      posterPath: d.poster_path ?? undefined,
      patch: {
        genres: (d.genres ?? []).map((g) => g.name),
        cast,
        keywords,
        language: d.original_language,
        runtimeMinutes: d.runtime ?? d.episode_run_time?.[0],
        ...(directors.length ? { directors } : {}),
      },
    };
  }
}
