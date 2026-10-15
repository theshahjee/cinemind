import pg from "pg";
import { loadConfig } from "./config.js";
import { createLlm } from "./llm/index.js";
import { TmdbClient } from "./tmdb.js";

/**
 * Background worker for the PostgreSQL job queue. Claims jobs with
 * FOR UPDATE SKIP LOCKED so several workers can run safely.
 *
 *   sync_metadata  -> fetch TMDB details for a title, then queue an embedding
 *   embed_title    -> embed overview + genres + keywords with the configured model
 */
const config = loadConfig();
if (!config.databaseUrl) throw new Error("The worker needs DATABASE_URL");
const pool = new pg.Pool({ connectionString: config.databaseUrl });
const tmdb = config.tmdbToken ? new TmdbClient(config.tmdbToken) : undefined;
const llm = createLlm(config);
const MAX_ATTEMPTS = 5;

interface Job {
  id: number;
  kind: string;
  payload: { titleId: string };
  attempts: number;
}

async function claim(): Promise<Job | undefined> {
  const { rows } = await pool.query<Job>(
    `UPDATE jobs SET status = 'running', attempts = attempts + 1, updated_at = now()
     WHERE id = (SELECT id FROM jobs WHERE status = 'pending' AND run_after <= now()
                 ORDER BY run_after FOR UPDATE SKIP LOCKED LIMIT 1)
     RETURNING id, kind, payload, attempts`,
  );
  return rows[0];
}

async function syncMetadata(titleId: string) {
  if (!tmdb) return;
  const e = await tmdb.enrich(titleId);
  if (!e) return;
  await pool.query(
    `UPDATE titles SET tmdb_id = $2, overview = COALESCE($3, overview), poster_path = COALESCE($4, poster_path),
       genres = CASE WHEN cardinality($5::text[]) > 0 THEN $5 ELSE genres END,
       cast_members = $6, keywords = $7, language = COALESCE($8, language),
       directors = CASE WHEN cardinality($9::text[]) > 0 THEN $9 ELSE directors END,
       runtime_minutes = COALESCE(runtime_minutes, $10),
       metadata_source = 'tmdb', metadata_synced_at = now(), updated_at = now()
     WHERE id = $1`,
    [titleId, e.tmdbId, e.overview, e.posterPath, e.patch.genres ?? [], e.patch.cast ?? [], e.patch.keywords ?? [],
      e.patch.language, e.patch.directors ?? [], e.patch.runtimeMinutes],
  );
  if (llm) await pool.query("INSERT INTO jobs (kind, payload) VALUES ('embed_title', $1)", [{ titleId }]);
}

async function embedTitle(titleId: string) {
  if (!llm) return;
  const { rows } = await pool.query<{ title: string; overview: string | null; genres: string[]; keywords: string[] }>(
    "SELECT title, overview, genres, keywords FROM titles WHERE id = $1",
    [titleId],
  );
  const t = rows[0];
  if (!t?.overview) return;
  const text = `${t.title}\nGenres: ${t.genres.join(", ")}\nThemes: ${t.keywords.join(", ")}\n${t.overview}`;
  const [vec] = await llm.embed([text]);
  await pool.query(
    `INSERT INTO title_embeddings (title_id, model, embedding) VALUES ($1, $2, $3::vector)
     ON CONFLICT (title_id, model) DO UPDATE SET embedding = EXCLUDED.embedding, created_at = now()`,
    [titleId, config.embeddingModel, JSON.stringify(vec)],
  );
}

let running = true;
process.on("SIGTERM", () => (running = false));
process.on("SIGINT", () => (running = false));

while (running) {
  const job = await claim();
  if (!job) {
    await new Promise((r) => setTimeout(r, 2000));
    continue;
  }
  try {
    if (job.kind === "sync_metadata") await syncMetadata(job.payload.titleId);
    else if (job.kind === "embed_title") await embedTitle(job.payload.titleId);
    await pool.query("UPDATE jobs SET status = 'done', updated_at = now() WHERE id = $1", [job.id]);
  } catch (err) {
    const failed = job.attempts >= MAX_ATTEMPTS;
    // Exponential backoff keeps the worker inside free-tier rate limits.
    await pool.query(
      `UPDATE jobs SET status = $2, last_error = $3, run_after = now() + ($4 || ' seconds')::interval, updated_at = now() WHERE id = $1`,
      [job.id, failed ? "failed" : "pending", (err as Error).message.slice(0, 500), String(2 ** job.attempts * 10)],
    );
  }
}
await pool.end();
