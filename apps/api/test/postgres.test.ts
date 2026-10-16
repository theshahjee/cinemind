import { migrate, testDatabaseUrl } from "@cinemind/db";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PostgresRepository } from "../src/repo/postgres.js";

// Runs only with TEST_DATABASE_URL set, and never against a non-test database.
const url = testDatabaseUrl();

describe.skipIf(!url)("PostgresRepository", () => {
  let pool: pg.Pool;
  let repo: PostgresRepository;

  beforeAll(async () => {
    await migrate(url!, () => {});
    pool = new pg.Pool({ connectionString: url });
    await pool.query("TRUNCATE titles, users, jobs CASCADE");
    repo = new PostgresRepository(pool, "test-model");
  });
  afterAll(() => pool?.end());

  it("round-trips titles, ratings, watchlist, feedback and embeddings", async () => {
    const userId = await repo.getOwnerId();
    expect(await repo.getOwnerId()).toBe(userId);

    await repo.upsertTitles([
      { id: "tt0000101", title: "A", type: "movie", genres: ["Drama"], directors: ["X"], year: 2001, imdbRating: 7.1 },
      { id: "tt0000102", title: "B", type: "tvSeries", genres: ["Comedy"], directors: [] },
    ]);
    // A re-import with blank fields must not wipe existing metadata.
    await repo.upsertTitles([{ id: "tt0000101", title: "A", type: "movie", genres: [], directors: [] }]);
    const a = await repo.getTitle("tt0000101");
    expect(a).toMatchObject({ genres: ["Drama"], directors: ["X"], year: 2001 });

    await repo.upsertRatings(userId, [{ titleId: "tt0000101", rating: 9, ratedAt: new Date("2024-01-01") }], "imdb_csv");
    await repo.upsertRatings(userId, [{ titleId: "tt0000101", rating: 8, ratedAt: new Date("2024-02-01") }], "manual");
    expect(await repo.getRatings(userId)).toEqual([{ titleId: "tt0000101", rating: 8, ratedAt: new Date("2024-02-01") }]);

    await repo.setWatchlist(userId, "tt0000102", true);
    await repo.setWatchlist(userId, "tt0000102", true);
    expect((await repo.getWatchlist(userId)).map((t) => t.id)).toEqual(["tt0000102"]);

    const lib = await repo.getLibrary(userId, { search: "a" });
    expect(lib.total).toBe(1);
    expect(lib.items[0]).toMatchObject({ rating: 8, onWatchlist: false });
    expect((await repo.getLibrary(userId, {})).total).toBe(2);

    await repo.addFeedback(userId, "tt0000102", "like");
    expect((await repo.getFeedback(userId)).map((f) => f.kind)).toEqual(["like"]);

    const vec = Array.from({ length: 768 }, (_, i) => (i === 0 ? 1 : 0));
    await pool.query("INSERT INTO title_embeddings (title_id, model, embedding) VALUES ($1, 'test-model', $2::vector)", [
      "tt0000101",
      JSON.stringify(vec),
    ]);
    const cat = await repo.getCatalogue();
    expect(cat.get("tt0000101")?.embedding?.[0]).toBe(1);
    expect(cat.get("tt0000102")?.embedding).toBeUndefined();

    // An older rating (e.g. a stale CSV re-import) must not replace a newer one.
    await repo.upsertRatings(userId, [{ titleId: "tt0000101", rating: 3, ratedAt: new Date("2023-01-01") }], "imdb_csv");
    expect((await repo.getRatings(userId))[0]!.rating).toBe(8);

    expect((await repo.searchTitles("b", 5)).map((t) => t.id)).toEqual(["tt0000102"]);
    expect(await repo.searchTitles("100%", 5)).toEqual([]);

    await repo.saveIntegration(userId, "trakt", { access_token: "x" });
    await repo.recordSync("trakt", { ratings: 1 });
    expect(await repo.getIntegration("trakt")).toMatchObject({ data: { access_token: "x" }, lastSyncResult: { ratings: 1 } });
    await repo.deleteIntegration("trakt");
    expect(await repo.getIntegration("trakt")).toBeUndefined();

    expect(await repo.deleteRating(userId, "tt0000101")).toBe(true);
    expect(await repo.deleteRating(userId, "tt0000101")).toBe(false);
  });
});
