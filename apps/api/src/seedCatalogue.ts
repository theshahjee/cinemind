import type { TitleType } from "@cinemind/core";
import pg from "pg";
import { buildCatalogue } from "./imdbDatasets.js";
import { PostgresRepository } from "./repo/postgres.js";

/**
 * Usage: node dist/seedCatalogue.js [--min-votes 20000] [--sync]
 * Downloads roughly 1 GB of compressed IMDb datasets and streams through them.
 * --sync also queues TMDB metadata (posters, cast, plot) for every seeded title.
 */
const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const minVotes = Number(flag("--min-votes") ?? 20000);
const types: TitleType[] = ["movie", "tvSeries", "tvMiniSeries"];

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set");

const titles = await buildCatalogue({ minVotes, types }, undefined, console.log);
const pool = new pg.Pool({ connectionString: url });
const repo = new PostgresRepository(pool, "");
for (let i = 0; i < titles.length; i += 1000) await repo.upsertTitles(titles.slice(i, i + 1000));
console.log(`upserted ${titles.length} titles`);

if (args.includes("--sync")) {
  await pool.query(
    `INSERT INTO jobs (kind, payload)
     SELECT 'sync_metadata', jsonb_build_object('titleId', id) FROM titles WHERE metadata_synced_at IS NULL`,
  );
  console.log("queued TMDB metadata sync; run the worker to process it");
}
await pool.end();
