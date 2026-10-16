import { describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { syncTrakt } from "../src/imports.js";
import { MemoryRepository } from "../src/repo/memory.js";
import { TraktClient, tokensExpired, traktToRating } from "../src/trakt.js";

const TOKEN = "t";
const auth = { authorization: `Bearer ${TOKEN}` };

/** Minimal stand-in for api.trakt.tv. `pollStatus` controls the device-token response. */
function fakeTrakt(opts: { pollStatus?: number; expired?: boolean } = {}) {
  const calls: string[] = [];
  const tokens = {
    access_token: "access-1",
    refresh_token: "refresh-1",
    expires_in: 86400,
    created_at: opts.expired ? 1 : Math.floor(Date.now() / 1000),
  };
  const routes: Record<string, () => [number, unknown]> = {
    "/oauth/device/code": () => [200, { device_code: "dev", user_code: "ABCD1234", verification_url: "https://trakt.tv/activate", expires_in: 600, interval: 5 }],
    "/oauth/device/token": () => [opts.pollStatus ?? 200, opts.pollStatus && opts.pollStatus !== 200 ? {} : tokens],
    "/oauth/token": () => [200, { ...tokens, access_token: "access-2", created_at: Math.floor(Date.now() / 1000) }],
    "/sync/ratings/movies": () => [200, [
      { rated_at: "2025-03-01T10:00:00.000Z", rating: 9, type: "movie", movie: { title: "Fictional Heist", year: 2015, ids: { imdb: "tt0000901", tmdb: 1 } } },
      { rated_at: "2025-03-02T10:00:00.000Z", rating: 7, type: "movie", movie: { title: "No Imdb Id", year: 2020, ids: { imdb: null } } },
    ]],
    "/sync/ratings/shows": () => [200, [
      { rated_at: "2025-04-01T10:00:00.000Z", rating: 4, type: "show", show: { title: "Fictional Show", year: 2019, ids: { imdb: "tt0000902" } } },
    ]],
    "/sync/watchlist/movies": () => [200, [{ listed_at: "2025-05-01T00:00:00.000Z", type: "movie", movie: { title: "Saved Film", year: 2022, ids: { imdb: "tt0000903" } } }]],
    "/sync/watchlist/shows": () => [200, []],
  };
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    const path = new URL(url).pathname;
    calls.push(`${init?.method ?? "GET"} ${path} ${(init?.headers as Record<string, string>)?.authorization ?? ""}`.trim());
    const [status, body] = routes[path]!();
    return new Response(JSON.stringify(body), { status });
  }) as unknown as typeof fetch;
  return { client: new TraktClient("client-id", "secret", fetchImpl), calls };
}

describe("Trakt mapping", () => {
  it("maps ratings by IMDb id and skips items without one", () => {
    expect(traktToRating({ rated_at: "2025-01-01T00:00:00Z", rating: 8, type: "show", show: { title: "S", ids: { imdb: "tt1" } } })).toEqual({
      titleId: "tt1",
      rating: 8,
      ratedAt: new Date("2025-01-01T00:00:00Z"),
    });
    expect(traktToRating({ rated_at: "2025-01-01T00:00:00Z", rating: 8, type: "movie", movie: { title: "M", ids: {} } })).toBeUndefined();
  });

  it("treats tokens close to expiry as expired", () => {
    const now = Date.now();
    expect(tokensExpired({ access_token: "", refresh_token: "", expires_in: 86400, created_at: now / 1000 }, now)).toBe(false);
    expect(tokensExpired({ access_token: "", refresh_token: "", expires_in: 60, created_at: now / 1000 }, now)).toBe(true);
  });
});

describe("syncTrakt", () => {
  it("imports ratings, watchlist and new titles, and reports skipped items", async () => {
    const repo = new MemoryRepository();
    const { client } = fakeTrakt();
    await repo.saveIntegration("u", "trakt", { access_token: "access-1", refresh_token: "r", expires_in: 86400, created_at: Date.now() / 1000 });
    const queued: string[] = [];
    const res = await syncTrakt(repo, client, async (ids) => void queued.push(...ids));
    expect(res).toEqual({ ratings: 2, watchlist: 1, skippedNoImdbId: 1, newTitles: 3 });
    expect(queued.sort()).toEqual(["tt0000901", "tt0000902", "tt0000903"]);
    const ratings = await repo.getRatings(await repo.getOwnerId());
    expect(ratings.find((r) => r.titleId === "tt0000902")?.rating).toBe(4);
    expect((await repo.getIntegration("trakt"))?.lastSyncResult).toEqual(res);
  });

  it("refreshes an expired token before syncing", async () => {
    const repo = new MemoryRepository();
    const { client, calls } = fakeTrakt({ expired: true });
    await repo.saveIntegration("u", "trakt", { access_token: "old", refresh_token: "refresh-1", expires_in: 10, created_at: 1 });
    await syncTrakt(repo, client);
    expect(calls).toContain("POST /oauth/token");
    expect(calls.filter((c) => c.startsWith("GET")).every((c) => c.endsWith("Bearer access-2"))).toBe(true);
  });

  it("does not let an older Trakt rating overwrite a newer manual one", async () => {
    const repo = new MemoryRepository();
    const userId = await repo.getOwnerId();
    await repo.upsertTitles([{ id: "tt0000901", title: "Fictional Heist", type: "movie", genres: ["Crime"], directors: [] }]);
    await repo.upsertRatings(userId, [{ titleId: "tt0000901", rating: 6, ratedAt: new Date("2026-01-01") }], "manual");
    await repo.saveIntegration(userId, "trakt", { access_token: "a", refresh_token: "r", expires_in: 86400, created_at: Date.now() / 1000 });
    await syncTrakt(repo, fakeTrakt().client);
    expect((await repo.getRatings(userId)).find((r) => r.titleId === "tt0000901")?.rating).toBe(6);
    // Existing catalogue metadata is left alone.
    expect((await repo.getTitle("tt0000901"))?.genres).toEqual(["Crime"]);
  });
});

describe("Trakt API routes", () => {
  it("runs the device flow end to end", async () => {
    const repo = new MemoryRepository();
    const app = await buildApp({ repo, apiToken: TOKEN, trakt: fakeTrakt().client });
    const start = (await app.inject({ method: "POST", url: "/api/integrations/trakt/device", headers: auth })).json();
    expect(start.user_code).toBe("ABCD1234");
    const poll = (await app.inject({ method: "POST", url: "/api/integrations/trakt/poll", headers: auth, payload: { deviceCode: start.device_code } })).json();
    expect(poll.status).toBe("connected");
    expect(poll.sync.ratings).toBe(2);
    const status = (await app.inject({ url: "/api/integrations/trakt", headers: auth })).json();
    expect(status).toMatchObject({ configured: true, connected: true });
    await app.inject({ method: "DELETE", url: "/api/integrations/trakt", headers: auth });
    expect((await app.inject({ url: "/api/integrations/trakt", headers: auth })).json().connected).toBe(false);
    await app.close();
  });

  it("reports pending while the user hasn't approved yet", async () => {
    const app = await buildApp({ repo: new MemoryRepository(), apiToken: TOKEN, trakt: fakeTrakt({ pollStatus: 400 }).client });
    const poll = (await app.inject({ method: "POST", url: "/api/integrations/trakt/poll", headers: auth, payload: { deviceCode: "dev" } })).json();
    expect(poll).toEqual({ status: "pending" });
    await app.close();
  });

  it("returns 501 when Trakt isn't configured", async () => {
    const app = await buildApp({ repo: new MemoryRepository(), apiToken: TOKEN });
    expect((await app.inject({ method: "POST", url: "/api/integrations/trakt/device", headers: auth })).statusCode).toBe(501);
    await app.close();
  });
});

describe("title search", () => {
  it("finds titles by substring and includes the user's status", async () => {
    const repo = new MemoryRepository();
    const app = await buildApp({ repo, apiToken: TOKEN });
    await repo.upsertTitles([
      { id: "tt0000001", title: "The Long Night", type: "movie", genres: [], directors: [], numVotes: 10 },
      { id: "tt0000002", title: "Night Shift", type: "movie", genres: [], directors: [], numVotes: 500 },
      { id: "tt0000003", title: "Daybreak", type: "movie", genres: [], directors: [] },
    ]);
    await repo.upsertRatings(await repo.getOwnerId(), [{ titleId: "tt0000001", rating: 8, ratedAt: new Date() }], "manual");
    const res = (await app.inject({ url: "/api/titles/search?q=night", headers: auth })).json();
    expect(res.map((r: { title: { id: string } }) => r.title.id)).toEqual(["tt0000002", "tt0000001"]);
    expect(res[1].rating).toBe(8);
    expect((await app.inject({ url: "/api/titles/tt0000003", headers: auth })).json().title.title).toBe("Daybreak");
    expect((await app.inject({ url: "/api/titles/tt0009999", headers: auth })).statusCode).toBe(404);
    await app.close();
  });
});
