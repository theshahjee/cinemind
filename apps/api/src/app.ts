import { timingSafeEqual } from "node:crypto";
import cors from "@fastify/cors";
import { ImportFormatError, type ScoredTitle, type Title } from "@cinemind/core";
import Fastify, { type FastifyInstance } from "fastify";
import { extractConstraints, matchesConstraints } from "./ask.js";
import { importImdbCsv, syncTrakt } from "./imports.js";
import type { LlmProvider } from "./llm/provider.js";
import type { FeedbackKind, Repository } from "./repo/types.js";
import { rankedWatchlist, recommend, tasteSummary } from "./service.js";
import type { TraktClient } from "./trakt.js";

export interface AppDeps {
  repo: Repository;
  apiToken: string;
  llm?: LlmProvider;
  corsOrigin?: string;
  trakt?: TraktClient;
  /** Called after an import so a worker can fetch metadata. */
  onTitlesImported?: (ids: string[]) => Promise<void>;
  logger?: boolean;
}

const TITLE_ID = { type: "string", pattern: "^tt[0-9]+$" } as const;

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

function stripEmbedding(t: Title) {
  return { ...t, embedding: undefined };
}

function present(s: ScoredTitle) {
  return { title: { ...s.title, embedding: undefined }, score: Number(s.score.toFixed(4)), explanation: s.explanation };
}

export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  const app = Fastify({ logger: deps.logger ?? false, bodyLimit: 10 * 1024 * 1024 });
  const { repo } = deps;

  await app.register(cors, { origin: deps.corsOrigin ?? false });
  app.addContentTypeParser(["text/csv", "text/plain"], { parseAs: "string" }, (_req, body, done) => done(null, body));

  // Single-user, self-hosted: one bearer token guards everything except the health check.
  app.addHook("onRequest", async (req, reply) => {
    if (req.url === "/health") return;
    const header = req.headers.authorization ?? "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : "";
    if (!token || !safeEqual(token, deps.apiToken)) return reply.code(401).send({ error: "unauthorized" });
  });

  app.get("/health", async () => ({ ok: true, llm: deps.llm?.name ?? null }));

  app.post("/api/import/imdb", async (req, reply) => {
    if (typeof req.body !== "string") return reply.code(415).send({ error: "Send the IMDb CSV with content-type text/csv" });
    try {
      return await importImdbCsv(repo, req.body, deps.onTitlesImported);
    } catch (err) {
      if (err instanceof ImportFormatError) return reply.code(400).send({ error: err.message });
      throw err;
    }
  });

  // Catalogue search, used by the MCP connector to turn a name into an id.
  app.get<{ Querystring: { q: string; limit?: number } }>(
    "/api/titles/search",
    {
      schema: {
        querystring: {
          type: "object",
          properties: { q: { type: "string", minLength: 1, maxLength: 200 }, limit: { type: "integer", minimum: 1, maximum: 50, default: 10 } },
          required: ["q"],
        },
      },
    },
    async (req) => {
      const userId = await repo.getOwnerId();
      const [titles, ratings, watchlist] = await Promise.all([
        repo.searchTitles(req.query.q, req.query.limit ?? 10),
        repo.getRatings(userId),
        repo.getWatchlist(userId),
      ]);
      const rated = new Map(ratings.map((r) => [r.titleId, r.rating]));
      const saved = new Set(watchlist.map((t) => t.id));
      return titles.map((t) => ({ title: stripEmbedding(t), rating: rated.get(t.id), onWatchlist: saved.has(t.id) }));
    },
  );

  app.get<{ Params: { id: string } }>(
    "/api/titles/:id",
    { schema: { params: { type: "object", properties: { id: TITLE_ID }, required: ["id"] } } },
    async (req, reply) => {
      const t = await repo.getTitle(req.params.id);
      if (!t) return reply.code(404).send({ error: "unknown title" });
      const userId = await repo.getOwnerId();
      const rating = (await repo.getRatings(userId)).find((r) => r.titleId === t.id);
      const onWatchlist = (await repo.getWatchlist(userId)).some((w) => w.id === t.id);
      return { title: stripEmbedding(t), rating: rating?.rating, ratedAt: rating?.ratedAt, onWatchlist };
    },
  );

  app.get<{ Querystring: { search?: string; genre?: string; type?: string; minRating?: number; limit?: number; offset?: number } }>(
    "/api/library",
    {
      schema: {
        querystring: {
          type: "object",
          properties: {
            search: { type: "string", maxLength: 200 },
            genre: { type: "string" },
            type: { type: "string" },
            minRating: { type: "integer", minimum: 1, maximum: 10 },
            limit: { type: "integer", minimum: 1, maximum: 200, default: 50 },
            offset: { type: "integer", minimum: 0, default: 0 },
          },
        },
      },
    },
    async (req) => {
      const lib = await repo.getLibrary(await repo.getOwnerId(), req.query);
      return { total: lib.total, items: lib.items.map((e) => ({ ...e, title: { ...e.title, embedding: undefined } })) };
    },
  );

  app.put<{ Params: { id: string }; Body: { rating: number; ratedAt?: string } }>(
    "/api/ratings/:id",
    {
      schema: {
        params: { type: "object", properties: { id: TITLE_ID }, required: ["id"] },
        body: {
          type: "object",
          properties: { rating: { type: "integer", minimum: 1, maximum: 10 }, ratedAt: { type: "string", format: "date-time" } },
          required: ["rating"],
        },
      },
    },
    async (req, reply) => {
      if (!(await repo.getTitle(req.params.id))) return reply.code(404).send({ error: "unknown title" });
      const ratedAt = req.body.ratedAt ? new Date(req.body.ratedAt) : new Date();
      await repo.upsertRatings(await repo.getOwnerId(), [{ titleId: req.params.id, rating: req.body.rating, ratedAt }], "manual");
      return { ok: true };
    },
  );

  app.delete<{ Params: { id: string } }>(
    "/api/ratings/:id",
    { schema: { params: { type: "object", properties: { id: TITLE_ID }, required: ["id"] } } },
    async (req, reply) => {
      const removed = await repo.deleteRating(await repo.getOwnerId(), req.params.id);
      return removed ? { ok: true } : reply.code(404).send({ error: "not rated" });
    },
  );

  app.get<{ Querystring: { ranked?: boolean } }>(
    "/api/watchlist",
    { schema: { querystring: { type: "object", properties: { ranked: { type: "boolean", default: false } } } } },
    async (req) => {
      const userId = await repo.getOwnerId();
      if (req.query.ranked) return (await rankedWatchlist(repo, userId)).map(present);
      return (await repo.getWatchlist(userId)).map(stripEmbedding);
    },
  );

  app.put<{ Params: { id: string }; Body: { on: boolean } }>(
    "/api/watchlist/:id",
    {
      schema: {
        params: { type: "object", properties: { id: TITLE_ID }, required: ["id"] },
        body: { type: "object", properties: { on: { type: "boolean" } }, required: ["on"] },
      },
    },
    async (req, reply) => {
      if (!(await repo.getTitle(req.params.id))) return reply.code(404).send({ error: "unknown title" });
      await repo.setWatchlist(await repo.getOwnerId(), req.params.id, req.body.on);
      return { ok: true };
    },
  );

  app.post<{ Params: { id: string }; Body: { kind: FeedbackKind } }>(
    "/api/feedback/:id",
    {
      schema: {
        params: { type: "object", properties: { id: TITLE_ID }, required: ["id"] },
        body: {
          type: "object",
          properties: { kind: { type: "string", enum: ["like", "dislike", "not_interested", "save"] } },
          required: ["kind"],
        },
      },
    },
    async (req, reply) => {
      if (!(await repo.getTitle(req.params.id))) return reply.code(404).send({ error: "unknown title" });
      const userId = await repo.getOwnerId();
      await repo.addFeedback(userId, req.params.id, req.body.kind);
      if (req.body.kind === "save") await repo.setWatchlist(userId, req.params.id, true);
      return { ok: true };
    },
  );

  app.get<{ Querystring: { k?: number } }>(
    "/api/recommendations",
    { schema: { querystring: { type: "object", properties: { k: { type: "integer", minimum: 1, maximum: 100, default: 20 } } } } },
    async (req) => {
      const recs = await recommend(repo, await repo.getOwnerId(), { k: req.query.k ?? 20 });
      return recs.map(present);
    },
  );

  app.get("/api/taste", async () => tasteSummary(repo, await repo.getOwnerId()));

  // Read-only natural-language discovery. It filters and ranks; it never changes ratings or the watchlist.
  app.post<{ Body: { query: string; k?: number } }>(
    "/api/ask",
    {
      schema: {
        body: {
          type: "object",
          properties: { query: { type: "string", minLength: 3, maxLength: 500 }, k: { type: "integer", minimum: 1, maximum: 50 } },
          required: ["query"],
        },
      },
    },
    async (req) => {
      const { constraints, via } = await extractConstraints(req.body.query, deps.llm);
      const recs = await recommend(repo, await repo.getOwnerId(), {
        k: req.body.k ?? 10,
        filter: (t) => matchesConstraints(t, constraints),
      });
      return {
        constraints,
        parsedBy: via,
        note: constraints.softPreferences.length
          ? "Mood and tone preferences are shown for reference. Metadata can't verify them yet."
          : undefined,
        results: recs.map(present),
      };
    },
  );

  // Trakt connection. Device flow: start -> user enters code on trakt.tv -> poll until connected.
  app.get("/api/integrations/trakt", async () => {
    const i = await repo.getIntegration("trakt");
    return {
      configured: Boolean(deps.trakt),
      connected: Boolean(i),
      lastSyncAt: i?.lastSyncAt,
      lastSyncResult: i?.lastSyncResult,
    };
  });

  app.post("/api/integrations/trakt/device", async (_req, reply) => {
    if (!deps.trakt) return reply.code(501).send({ error: "Set TRAKT_CLIENT_ID to enable Trakt" });
    return deps.trakt.startDeviceAuth();
  });

  app.post<{ Body: { deviceCode: string } }>(
    "/api/integrations/trakt/poll",
    { schema: { body: { type: "object", properties: { deviceCode: { type: "string", minLength: 1, maxLength: 200 } }, required: ["deviceCode"] } } },
    async (req, reply) => {
      if (!deps.trakt) return reply.code(501).send({ error: "Trakt is not configured" });
      const result = await deps.trakt.pollDeviceAuth(req.body.deviceCode);
      if (result.status !== "connected") return { status: result.status };
      await repo.saveIntegration(await repo.getOwnerId(), "trakt", result.tokens as unknown as Record<string, unknown>);
      const sync = await syncTrakt(repo, deps.trakt, deps.onTitlesImported);
      return { status: "connected", sync };
    },
  );

  app.post("/api/integrations/trakt/sync", async (_req, reply) => {
    if (!deps.trakt) return reply.code(501).send({ error: "Trakt is not configured" });
    if (!(await repo.getIntegration("trakt"))) return reply.code(409).send({ error: "Trakt is not connected" });
    return syncTrakt(repo, deps.trakt, deps.onTitlesImported);
  });

  app.delete("/api/integrations/trakt", async () => {
    await repo.deleteIntegration("trakt");
    return { ok: true };
  });

  return app;
}
