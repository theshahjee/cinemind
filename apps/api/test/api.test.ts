import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { ruleBasedConstraints } from "../src/ask.js";
import type { LlmProvider } from "../src/llm/provider.js";
import { MemoryRepository } from "../src/repo/memory.js";

const TOKEN = "test-token";
const auth = { authorization: `Bearer ${TOKEN}` };
const HEADER = "Const,Your Rating,Date Rated,Title,Original Title,URL,Title Type,IMDb Rating,Runtime (mins),Year,Genres,Num Votes,Release Date,Directors";

// Fictional titles with placeholder ids.
const CSV = [
  HEADER,
  "tt0000001,9,2024-01-01,Heist One,,,Movie,7.5,110,2015,\"Crime, Thriller\",9000,,Director A",
  "tt0000002,10,2024-02-01,Heist Two,,,Movie,7.9,115,2018,\"Crime, Thriller\",12000,,Director A",
  "tt0000003,2,2024-03-01,Weepy Romance,,,Movie,6.0,130,2012,\"Drama, Romance\",4000,,Director B",
].join("\n");

let app: FastifyInstance;
let repo: MemoryRepository;

beforeEach(async () => {
  repo = new MemoryRepository();
  app = await buildApp({ repo, apiToken: TOKEN });
});
afterEach(() => app.close());

async function seed() {
  await app.inject({ method: "POST", url: "/api/import/imdb", headers: { ...auth, "content-type": "text/csv" }, payload: CSV });
  await repo.upsertTitles([
    { id: "tt0000010", title: "Heist Three", type: "movie", genres: ["Crime", "Thriller"], directors: ["Director A"], runtimeMinutes: 100 },
    { id: "tt0000011", title: "Another Romance", type: "movie", genres: ["Romance"], directors: ["Director B"], runtimeMinutes: 150 },
    { id: "tt0000012", title: "Space Doc", type: "tvSeries", genres: ["Documentary"], directors: [], runtimeMinutes: 50 },
  ]);
}

describe("auth", () => {
  it("allows the health check without a token", async () => {
    expect((await app.inject({ url: "/health" })).statusCode).toBe(200);
  });

  it("rejects missing or wrong tokens", async () => {
    expect((await app.inject({ url: "/api/library" })).statusCode).toBe(401);
    expect((await app.inject({ url: "/api/library", headers: { authorization: "Bearer nope" } })).statusCode).toBe(401);
  });
});

describe("import and library", () => {
  it("imports an IMDb CSV and lists the library", async () => {
    const res = await app.inject({ method: "POST", url: "/api/import/imdb", headers: { ...auth, "content-type": "text/csv" }, payload: CSV });
    expect(res.json()).toEqual({ kind: "ratings", imported: 3, watchlisted: 0, skipped: [] });
    const lib = (await app.inject({ url: "/api/library?minRating=8", headers: auth })).json();
    expect(lib.total).toBe(2);
    expect(lib.items[0].title.title).toBe("Heist Two");
  });

  it("imports an IMDb watchlist export onto the watchlist", async () => {
    const list = [
      "Position,Const,Created,Modified,Description,Title,Original Title,URL,Title Type,IMDb Rating,Runtime (mins),Year,Genres,Num Votes,Release Date,Directors,Your Rating,Date Rated",
      "1,tt0000020,2025-01-01,2025-01-01,,Saved One,,,Movie,7.0,100,2020,Drama,5000,,Someone,,",
      "2,tt0000021,2025-01-02,2025-01-02,,Saved Two,,,TV Series,8.0,45,2021,Comedy,8000,,,,",
    ].join("\n");
    const res = await app.inject({ method: "POST", url: "/api/import/imdb", headers: { ...auth, "content-type": "text/csv" }, payload: list });
    expect(res.json()).toMatchObject({ kind: "list", imported: 0, watchlisted: 2 });
    const wl = (await app.inject({ url: "/api/watchlist", headers: auth })).json();
    expect(wl.map((t: { id: string }) => t.id).sort()).toEqual(["tt0000020", "tt0000021"]);
    const ranked = (await app.inject({ url: "/api/watchlist?ranked=true", headers: auth })).json();
    expect(ranked).toHaveLength(2);
    expect(ranked[0]).toHaveProperty("explanation");
    // Watchlisted titles are excluded from recommendations, since you've already picked them.
    const recs = (await app.inject({ url: "/api/recommendations", headers: auth })).json();
    expect(recs).toEqual([]);
  });

  it("returns 400 for a file that isn't an IMDb export", async () => {
    const res = await app.inject({ method: "POST", url: "/api/import/imdb", headers: { ...auth, "content-type": "text/csv" }, payload: "a,b\n1,2" });
    expect(res.statusCode).toBe(400);
  });

  it("validates ratings", async () => {
    await seed();
    const bad = await app.inject({ method: "PUT", url: "/api/ratings/tt0000010", headers: auth, payload: { rating: 11 } });
    expect(bad.statusCode).toBe(400);
    const unknown = await app.inject({ method: "PUT", url: "/api/ratings/tt9999999", headers: auth, payload: { rating: 5 } });
    expect(unknown.statusCode).toBe(404);
    const ok = await app.inject({ method: "PUT", url: "/api/ratings/tt0000010", headers: auth, payload: { rating: 8 } });
    expect(ok.statusCode).toBe(200);
  });
});

describe("recommendations", () => {
  it("recommends unrated titles that match the user's taste, with explanations", async () => {
    await seed();
    const recs = (await app.inject({ url: "/api/recommendations?k=3", headers: auth })).json();
    expect(recs[0].title.id).toBe("tt0000010");
    expect(recs[0].explanation.matches).toContain("genre:Thriller");
    expect(recs.map((r: { title: { id: string } }) => r.title.id)).not.toContain("tt0000001");
  });

  it("hides titles marked not interested", async () => {
    await seed();
    await app.inject({ method: "POST", url: "/api/feedback/tt0000010", headers: auth, payload: { kind: "not_interested" } });
    const recs = (await app.inject({ url: "/api/recommendations", headers: auth })).json();
    expect(recs.map((r: { title: { id: string } }) => r.title.id)).not.toContain("tt0000010");
  });

  it("separates explicit ratings from inferred feedback in taste analytics", async () => {
    await seed();
    await app.inject({ method: "POST", url: "/api/feedback/tt0000012", headers: auth, payload: { kind: "like" } });
    const taste = (await app.inject({ url: "/api/taste", headers: auth })).json();
    expect(taste.ratedCount).toBe(3);
    expect(taste.inferredCount).toBe(1);
    expect(taste.top.map((t: { feature: string }) => t.feature)).toContain("genre:Thriller");
  });
});

describe("ask", () => {
  it("parses constraints without an LLM", () => {
    const c = ruleBasedConstraints("a tense thriller under two hours, no romance");
    expect(c.includeGenres).toContain("Thriller");
    expect(c.excludeGenres).toContain("Romance");
    expect(c.maxRuntimeMinutes).toBe(120);
  });

  it("filters results by the extracted constraints", async () => {
    await seed();
    const res = (await app.inject({ method: "POST", url: "/api/ask", headers: auth, payload: { query: "a documentary series" } })).json();
    expect(res.parsedBy).toBe("rules");
    expect(res.results.map((r: { title: { id: string } }) => r.title.id)).toEqual(["tt0000012"]);
  });

  it("falls back to rules when the LLM fails", async () => {
    const failing: LlmProvider = {
      name: "broken",
      generateJson: async () => {
        throw new Error("quota");
      },
      embed: async () => [],
    };
    await app.close();
    app = await buildApp({ repo, apiToken: TOKEN, llm: failing });
    await seed();
    const res = (await app.inject({ method: "POST", url: "/api/ask", headers: auth, payload: { query: "crime movie" } })).json();
    expect(res.parsedBy).toBe("rules");
    expect(res.results[0].title.id).toBe("tt0000010");
  });
});
