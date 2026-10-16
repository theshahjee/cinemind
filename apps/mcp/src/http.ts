import { migrate } from "@cinemind/db";
import pg from "pg";
import { createHttpApp } from "./app.js";
import { CineMindClient } from "./client.js";
import { PostgresOAuthStore } from "./oauth/store.js";

const env = process.env;
const required = (name: string) => {
  const v = env[name];
  if (!v) throw new Error(`${name} is required for the remote MCP server`);
  return v;
};

const publicUrl = new URL(required("CINEMIND_MCP_PUBLIC_URL"));
const password = required("CINEMIND_MCP_PASSWORD");
if (password.length < 12) throw new Error("CINEMIND_MCP_PASSWORD must be at least 12 characters: this server is reachable from the internet");
const databaseUrl = required("DATABASE_URL");

await migrate(databaseUrl, () => {});
const pool = new pg.Pool({ connectionString: databaseUrl });

const app = createHttpApp({
  publicUrl,
  password,
  store: new PostgresOAuthStore(pool),
  client: new CineMindClient(env.CINEMIND_API_URL ?? "http://localhost:4000", required("CINEMIND_API_TOKEN")),
  allowWrites: env.CINEMIND_MCP_ALLOW_WRITES === "true",
});

const port = Number(env.PORT ?? 4200);
const server = app.listen(port, "0.0.0.0", () => console.log(`CineMind MCP listening on :${port}, public URL ${new URL("/mcp", publicUrl).href}`));
for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => server.close(() => void pool.end().then(() => process.exit(0))));
}
