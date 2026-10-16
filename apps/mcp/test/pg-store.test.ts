import { migrate, testDatabaseUrl } from "@cinemind/db";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PostgresOAuthStore, sha256 } from "../src/oauth/store.js";

// Runs only with TEST_DATABASE_URL set, and never against a non-test database.
const url = testDatabaseUrl();

describe.skipIf(!url)("PostgresOAuthStore", () => {
  let pool: pg.Pool;
  let store: PostgresOAuthStore;

  beforeAll(async () => {
    await migrate(url!, () => {});
    pool = new pg.Pool({ connectionString: url });
    await pool.query("TRUNCATE oauth_clients CASCADE");
    store = new PostgresOAuthStore(pool);
  });
  afterAll(() => pool?.end());

  it("round-trips clients, single-use codes and tokens", async () => {
    const client = { client_id: "c1", redirect_uris: ["https://claude.ai/api/mcp/auth_callback"], client_name: "Claude" };
    await store.saveClient(client);
    expect(await store.getClient("c1")).toEqual(client);

    const code = { clientId: "c1", codeChallenge: "ch", redirectUri: client.redirect_uris[0]!, scopes: ["cinemind"], resource: "https://x/mcp", expiresAt: new Date(Date.now() + 60_000) };
    await store.saveCode(sha256("code"), code);
    expect(await store.getCode(sha256("code"))).toEqual(code);
    expect(await store.takeCode(sha256("code"))).toEqual(code);
    expect(await store.takeCode(sha256("code"))).toBeUndefined();

    const token = { kind: "access" as const, clientId: "c1", scopes: ["cinemind"], resource: undefined, expiresAt: new Date(Date.now() + 60_000), revoked: false };
    await store.saveToken(sha256("tok"), token);
    expect(await store.getToken(sha256("tok"))).toEqual(token);
    await store.revokeToken(sha256("tok"));
    expect((await store.getToken(sha256("tok")))?.revoked).toBe(true);
  });
});
