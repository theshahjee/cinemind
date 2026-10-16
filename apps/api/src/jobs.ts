import type pg from "pg";

/** Queue a TMDB metadata sync for each title. The worker picks these up. */
export async function enqueueMetadataSync(pool: pg.Pool, ids: readonly string[]): Promise<void> {
  if (ids.length === 0) return;
  await pool.query(
    `INSERT INTO jobs (kind, payload) SELECT 'sync_metadata', jsonb_build_object('titleId', id) FROM unnest($1::text[]) AS id`,
    [ids],
  );
}
