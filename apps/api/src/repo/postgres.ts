import type { Rating, Title, TitleType } from "@cinemind/core";
import pg from "pg";
import type { Feedback, FeedbackKind, LibraryQuery, Repository } from "./types.js";

interface TitleRow {
  id: string;
  title: string;
  type: string;
  year: number | null;
  runtime_minutes: number | null;
  genres: string[];
  directors: string[];
  cast_members: string[];
  keywords: string[];
  language: string | null;
  imdb_rating: number | null;
  num_votes: number | null;
  overview: string | null;
  poster_path: string | null;
  embedding?: string | null;
}

const TITLE_COLUMNS = `t.id, t.title, t.type, t.year, t.runtime_minutes, t.genres, t.directors, t.cast_members,
  t.keywords, t.language, t.imdb_rating, t.num_votes, t.overview, t.poster_path`;

function toTitle(r: TitleRow): Title {
  return {
    id: r.id,
    title: r.title,
    type: r.type as TitleType,
    year: r.year ?? undefined,
    runtimeMinutes: r.runtime_minutes ?? undefined,
    genres: r.genres,
    directors: r.directors,
    cast: r.cast_members,
    keywords: r.keywords,
    language: r.language ?? undefined,
    imdbRating: r.imdb_rating ?? undefined,
    numVotes: r.num_votes ?? undefined,
    overview: r.overview ?? undefined,
    posterPath: r.poster_path ?? undefined,
    // pgvector returns "[0.1,0.2,...]", which is valid JSON.
    embedding: r.embedding ? (JSON.parse(r.embedding) as number[]) : undefined,
  };
}

export class PostgresRepository implements Repository {
  private ownerId?: string;

  constructor(
    private readonly pool: pg.Pool,
    private readonly embeddingModel: string,
  ) {}

  async upsertTitles(titles: readonly Title[]) {
    if (titles.length === 0) return;
    // COALESCE keeps richer metadata (from TMDB) when a CSV re-import has blanks.
    await this.pool.query(
      `INSERT INTO titles (id, title, type, year, runtime_minutes, genres, directors, imdb_rating, num_votes)
       SELECT * FROM jsonb_to_recordset($1::jsonb) AS x(
         id text, title text, type text, year int, "runtimeMinutes" int,
         genres text[], directors text[], "imdbRating" real, "numVotes" int)
       ON CONFLICT (id) DO UPDATE SET
         title = EXCLUDED.title,
         type = EXCLUDED.type,
         year = COALESCE(EXCLUDED.year, titles.year),
         runtime_minutes = COALESCE(EXCLUDED.runtime_minutes, titles.runtime_minutes),
         genres = CASE WHEN cardinality(EXCLUDED.genres) > 0 THEN EXCLUDED.genres ELSE titles.genres END,
         directors = CASE WHEN cardinality(EXCLUDED.directors) > 0 THEN EXCLUDED.directors ELSE titles.directors END,
         imdb_rating = COALESCE(EXCLUDED.imdb_rating, titles.imdb_rating),
         num_votes = COALESCE(EXCLUDED.num_votes, titles.num_votes),
         updated_at = now()`,
      [JSON.stringify(titles)],
    );
  }

  async upsertRatings(userId: string, ratings: readonly Rating[], source: "imdb_csv" | "manual") {
    if (ratings.length === 0) return;
    await this.pool.query(
      `INSERT INTO ratings (user_id, title_id, rating, rated_at, source)
       SELECT $1, x."titleId", x.rating, x."ratedAt", $3
       FROM jsonb_to_recordset($2::jsonb) AS x("titleId" text, rating smallint, "ratedAt" timestamptz)
       ON CONFLICT (user_id, title_id) DO UPDATE SET rating = EXCLUDED.rating, rated_at = EXCLUDED.rated_at, source = EXCLUDED.source`,
      [userId, JSON.stringify(ratings), source],
    );
  }

  async deleteRating(userId: string, titleId: string) {
    const res = await this.pool.query("DELETE FROM ratings WHERE user_id = $1 AND title_id = $2", [userId, titleId]);
    return (res.rowCount ?? 0) > 0;
  }

  async getRatings(userId: string) {
    const { rows } = await this.pool.query<{ title_id: string; rating: number; rated_at: Date }>(
      "SELECT title_id, rating, rated_at FROM ratings WHERE user_id = $1",
      [userId],
    );
    return rows.map((r) => ({ titleId: r.title_id, rating: r.rating, ratedAt: r.rated_at }));
  }

  async getTitle(id: string) {
    const { rows } = await this.pool.query<TitleRow>(
      `SELECT ${TITLE_COLUMNS}, e.embedding::text AS embedding
       FROM titles t LEFT JOIN title_embeddings e ON e.title_id = t.id AND e.model = $2
       WHERE t.id = $1`,
      [id, this.embeddingModel],
    );
    return rows[0] ? toTitle(rows[0]) : undefined;
  }

  async getCatalogue() {
    const { rows } = await this.pool.query<TitleRow>(
      `SELECT ${TITLE_COLUMNS}, e.embedding::text AS embedding
       FROM titles t LEFT JOIN title_embeddings e ON e.title_id = t.id AND e.model = $1`,
      [this.embeddingModel],
    );
    return new Map(rows.map((r) => [r.id, toTitle(r)]));
  }

  async getLibrary(userId: string, q: LibraryQuery) {
    const params: unknown[] = [userId];
    const where: string[] = ["(r.title_id IS NOT NULL OR w.title_id IS NOT NULL)"];
    if (q.search) {
      params.push(`%${q.search}%`);
      where.push(`t.title ILIKE $${params.length}`);
    }
    if (q.genre) {
      params.push(q.genre);
      where.push(`$${params.length} = ANY(t.genres)`);
    }
    if (q.type) {
      params.push(q.type);
      where.push(`t.type = $${params.length}`);
    }
    if (q.minRating !== undefined) {
      params.push(q.minRating);
      where.push(`r.rating >= $${params.length}`);
    }
    params.push(q.limit ?? 50, q.offset ?? 0);
    const { rows } = await this.pool.query<TitleRow & { rating: number | null; rated_at: Date | null; on_watchlist: boolean; total: string }>(
      `SELECT ${TITLE_COLUMNS}, r.rating, r.rated_at, (w.title_id IS NOT NULL) AS on_watchlist, count(*) OVER () AS total
       FROM titles t
       LEFT JOIN ratings r ON r.title_id = t.id AND r.user_id = $1
       LEFT JOIN watchlist w ON w.title_id = t.id AND w.user_id = $1
       WHERE ${where.join(" AND ")}
       ORDER BY r.rated_at DESC NULLS LAST, t.title
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );
    return {
      total: Number(rows[0]?.total ?? 0),
      items: rows.map((r) => ({
        title: toTitle(r),
        rating: r.rating ?? undefined,
        ratedAt: r.rated_at ?? undefined,
        onWatchlist: r.on_watchlist,
      })),
    };
  }

  async setWatchlist(userId: string, titleId: string, on: boolean) {
    if (on) {
      await this.pool.query("INSERT INTO watchlist (user_id, title_id) VALUES ($1, $2) ON CONFLICT DO NOTHING", [userId, titleId]);
    } else {
      await this.pool.query("DELETE FROM watchlist WHERE user_id = $1 AND title_id = $2", [userId, titleId]);
    }
  }

  async getWatchlist(userId: string) {
    const { rows } = await this.pool.query<TitleRow>(
      `SELECT ${TITLE_COLUMNS} FROM watchlist w JOIN titles t ON t.id = w.title_id WHERE w.user_id = $1 ORDER BY w.added_at DESC`,
      [userId],
    );
    return rows.map(toTitle);
  }

  async addFeedback(userId: string, titleId: string, kind: FeedbackKind) {
    await this.pool.query("INSERT INTO feedback (user_id, title_id, kind) VALUES ($1, $2, $3)", [userId, titleId, kind]);
  }

  async getFeedback(userId: string): Promise<Feedback[]> {
    const { rows } = await this.pool.query<{ title_id: string; kind: FeedbackKind; created_at: Date }>(
      "SELECT title_id, kind, created_at FROM feedback WHERE user_id = $1 ORDER BY created_at",
      [userId],
    );
    return rows.map((r) => ({ titleId: r.title_id, kind: r.kind, createdAt: r.created_at }));
  }

  async getOwnerId() {
    if (this.ownerId) return this.ownerId;
    const { rows } = await this.pool.query<{ id: string }>(
      `WITH existing AS (SELECT id FROM users ORDER BY created_at LIMIT 1),
            inserted AS (INSERT INTO users (name) SELECT 'owner' WHERE NOT EXISTS (SELECT 1 FROM existing) RETURNING id)
       SELECT id FROM existing UNION ALL SELECT id FROM inserted`,
    );
    this.ownerId = rows[0]!.id;
    return this.ownerId;
  }
}
