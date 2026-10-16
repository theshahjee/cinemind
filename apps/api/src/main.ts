import { migrate } from "@cinemind/db";
import pg from "pg";
import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";
import { enqueueMetadataSync } from "./jobs.js";
import { createLlm } from "./llm/index.js";
import { MemoryRepository } from "./repo/memory.js";
import { PostgresRepository } from "./repo/postgres.js";
import type { Repository } from "./repo/types.js";
import { TraktClient } from "./trakt.js";

const config = loadConfig();

let repo: Repository;
let pool: pg.Pool | undefined;
if (config.databaseUrl) {
  await migrate(config.databaseUrl);
  pool = new pg.Pool({ connectionString: config.databaseUrl });
  repo = new PostgresRepository(pool, config.embeddingModel);
} else {
  console.warn("DATABASE_URL not set: using in-memory storage. Data is lost on restart.");
  repo = new MemoryRepository();
}

const llm = createLlm(config);

const trakt =
  config.traktClientId ? new TraktClient(config.traktClientId, config.traktClientSecret) : undefined;

const app = await buildApp({
  repo,
  llm,
  trakt,
  apiToken: config.apiToken,
  corsOrigin: config.corsOrigin,
  logger: true,
  onTitlesImported: pool ? (ids) => enqueueMetadataSync(pool!, ids) : undefined,
});

await app.listen({ port: config.port, host: config.host });

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, async () => {
    await app.close();
    await pool?.end();
    process.exit(0);
  });
}
