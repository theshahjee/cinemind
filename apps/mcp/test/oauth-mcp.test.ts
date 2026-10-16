import { createHash, randomBytes } from "node:crypto";
import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { createHttpApp } from "../src/app.js";
import { CineMindClient } from "../src/client.js";
import { MemoryOAuthStore } from "../src/oauth/store.js";

const PUBLIC = new URL("http://localhost:4200");
const MCP_URL = "http://localhost:4200/mcp";
const PASSWORD = "correct horse battery";
const CLAUDE_CALLBACK = "https://claude.ai/api/mcp/auth_callback";

/** Fake CineMind API: records calls, returns canned data. */
function fakeApi() {
  const calls: { method: string; path: string; body?: unknown }[] = [];
  const title = { id: "tt0000001", title: "Fictional Film", type: "movie", year: 2020, genres: ["Drama"], directors: ["A. Director"], overview: "A story." };
  const fetchImpl = (async (url: string, init: RequestInit) => {
    const u = new URL(url);
    calls.push({ method: init.method ?? "GET", path: u.pathname + u.search, body: init.body ? JSON.parse(init.body as string) : undefined });
    if (u.pathname === "/api/recommendations") return Response.json([{ title, score: 0.42, explanation: { matches: ["genre:Drama"], conflicts: [] } }]);
    if (u.pathname.startsWith("/api/titles/search")) return Response.json([{ title, rating: 8, onWatchlist: false }]);
    if (u.pathname.startsWith("/api/titles/")) return Response.json({ title, rating: 8, onWatchlist: false });
    return Response.json({ ok: true });
  }) as unknown as typeof fetch;
  return { client: new CineMindClient("http://api.internal", "api-token", fetchImpl), calls };
}

const pkce = () => {
  const verifier = randomBytes(32).toString("base64url");
  return { verifier, challenge: createHash("sha256").update(verifier).digest("base64url") };
};

const MCP_HEADERS = { accept: "application/json, text/event-stream", "content-type": "application/json" };
const rpc = (method: string, params: unknown = {}, id = 1) => ({ jsonrpc: "2.0", id, method, params });
const INIT = rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1" } });

let store: MemoryOAuthStore;
let api: ReturnType<typeof fakeApi>;
let app: ReturnType<typeof createHttpApp>;

function build(allowWrites = false) {
  store = new MemoryOAuthStore();
  api = fakeApi();
  app = createHttpApp({ publicUrl: PUBLIC, password: PASSWORD, store, client: api.client, allowWrites });
}

async function register(redirect = CLAUDE_CALLBACK) {
  const res = await request(app)
    .post("/register")
    .send({ client_name: "Claude", redirect_uris: [redirect], token_endpoint_auth_method: "none", grant_types: ["authorization_code", "refresh_token"], response_types: ["code"] });
  expect(res.status).toBe(201);
  return res.body.client_id as string;
}

async function authorize(clientId: string, opts: { redirect?: string; password?: string } = {}) {
  const { verifier, challenge } = pkce();
  const redirect = opts.redirect ?? CLAUDE_CALLBACK;
  const page = await request(app).get("/authorize").query({
    response_type: "code",
    client_id: clientId,
    redirect_uri: redirect,
    code_challenge: challenge,
    code_challenge_method: "S256",
    state: "xyz",
    resource: MCP_URL,
  });
  expect(page.status).toBe(200);
  expect(page.text).toContain("Allow access");
  const consent = await request(app).post("/oauth/consent").type("form").send({
    client_id: clientId,
    redirect_uri: redirect,
    code_challenge: challenge,
    state: "xyz",
    scope: "cinemind",
    resource: MCP_URL,
    password: opts.password ?? PASSWORD,
  });
  return { consent, verifier };
}

async function fullLogin() {
  const clientId = await register();
  const { consent, verifier } = await authorize(clientId);
  const loc = new URL(consent.headers.location!);
  const tokens = await request(app).post("/token").type("form").send({
    grant_type: "authorization_code",
    code: loc.searchParams.get("code"),
    code_verifier: verifier,
    client_id: clientId,
    redirect_uri: CLAUDE_CALLBACK,
    resource: MCP_URL,
  });
  expect(tokens.status).toBe(200);
  return { clientId, tokens: tokens.body as { access_token: string; refresh_token: string }, loc };
}

beforeEach(() => build());

describe("discovery", () => {
  it("advertises protected resource and authorization server metadata", async () => {
    const prm = await request(app).get("/.well-known/oauth-protected-resource/mcp");
    expect(prm.body.resource).toBe(MCP_URL);
    expect(prm.body.authorization_servers[0]).toMatch(/^http:\/\/localhost:4200/);
    const as = await request(app).get("/.well-known/oauth-authorization-server");
    expect(as.body.code_challenge_methods_supported).toContain("S256");
    expect(as.body.registration_endpoint).toBe("http://localhost:4200/register");
  });

  it("challenges unauthenticated MCP requests with a pointer to the metadata", async () => {
    const res = await request(app).post("/mcp").set(MCP_HEADERS).send(INIT);
    expect(res.status).toBe(401);
    expect(res.headers["www-authenticate"]).toContain("resource_metadata=");
  });
});

describe("authorization flow", () => {
  it("rejects a wrong password and accepts the right one", async () => {
    const clientId = await register();
    const bad = await authorize(clientId, { password: "nope" });
    expect(bad.consent.status).toBe(401);
    expect(bad.consent.text).toContain("Wrong password");
    const { loc } = await fullLogin();
    expect(loc.origin + loc.pathname).toBe(CLAUDE_CALLBACK);
    expect(loc.searchParams.get("state")).toBe("xyz");
    const meta = await request(app).get("/.well-known/oauth-authorization-server");
    expect(loc.searchParams.get("iss")).toBe(meta.body.issuer);
  });

  it("refuses a redirect_uri the client didn't register", async () => {
    const clientId = await register();
    const res = await request(app).post("/oauth/consent").type("form").send({
      client_id: clientId,
      redirect_uri: "https://evil.example/callback",
      code_challenge: "x",
      password: PASSWORD,
    });
    expect(res.status).toBe(400);
  });

  it("accepts loopback redirects on any port, as Claude Code uses", async () => {
    const clientId = await register("http://localhost:33418/callback");
    const { consent } = await authorize(clientId, { redirect: "http://localhost:51234/callback" });
    expect(consent.status).toBe(302);
    expect(consent.headers.location).toMatch(/^http:\/\/localhost:51234\/callback\?code=/);
  });

  it("locks out after repeated wrong passwords", async () => {
    const clientId = await register();
    for (let i = 0; i < 10; i++) await authorize(clientId, { password: "wrong" });
    const { consent } = await authorize(clientId);
    expect(consent.status).toBe(429);
  });

  it("makes codes single-use and rotates refresh tokens", async () => {
    const clientId = await register();
    const { consent, verifier } = await authorize(clientId);
    const code = new URL(consent.headers.location!).searchParams.get("code");
    const exchange = () =>
      request(app).post("/token").type("form").send({ grant_type: "authorization_code", code, code_verifier: verifier, client_id: clientId, redirect_uri: CLAUDE_CALLBACK });
    expect((await exchange()).status).toBe(200);
    expect((await exchange()).status).toBe(400);

    const { tokens } = await fullLogin();
    const refresh = (t: string) => request(app).post("/token").type("form").send({ grant_type: "refresh_token", refresh_token: t, client_id: [...store.clients.keys()].at(-1) });
    const first = await refresh(tokens.refresh_token);
    expect(first.status).toBe(200);
    expect(first.body.access_token).not.toBe(tokens.access_token);
    expect((await refresh(tokens.refresh_token)).status).toBe(400);
  });

  it("stores only hashes of codes and tokens", async () => {
    const { tokens } = await fullLogin();
    const stored = JSON.stringify([...store.tokens.keys(), ...store.codes.keys()]);
    expect(stored).not.toContain(tokens.access_token);
    expect(stored).not.toContain(tokens.refresh_token);
  });
});

describe("MCP over HTTP", () => {
  async function call(token: string, body: unknown) {
    const res = await request(app).post("/mcp").set(MCP_HEADERS).set("authorization", `Bearer ${token}`).send(body);
    expect(res.status).toBe(200);
    return res.body;
  }

  it("serves read-only tools with annotations and calls the CineMind API", async () => {
    const { tokens } = await fullLogin();
    const init = await call(tokens.access_token, INIT);
    expect(init.result.serverInfo.name).toBe("cinemind");

    const list = await call(tokens.access_token, rpc("tools/list"));
    const names = list.result.tools.map((t: { name: string }) => t.name).sort();
    expect(names).toEqual(["ask", "fetch", "get_title", "library", "recommend", "search", "search_titles", "taste_profile"]);
    for (const t of list.result.tools) {
      expect(t.title).toBeTruthy();
      expect(t.annotations.readOnlyHint).toBe(true);
    }

    const rec = await call(tokens.access_token, rpc("tools/call", { name: "recommend", arguments: { limit: 5 } }));
    const payload = JSON.parse(rec.result.content[0].text);
    expect(payload[0]).toMatchObject({ id: "tt0000001", score: 0.42, matches: ["genre:Drama"] });
    expect(api.calls[0]!.path).toBe("/api/recommendations?k=5");

    const fetched = await call(tokens.access_token, rpc("tools/call", { name: "fetch", arguments: { id: "tt0000001" } }));
    expect(JSON.parse(fetched.result.content[0].text).text).toContain("The user rated it 8/10.");
  });

  it("exposes write tools only when enabled, marked as not read-only", async () => {
    build(true);
    const { tokens } = await fullLogin();
    const list = await call(tokens.access_token, rpc("tools/list"));
    const rate = list.result.tools.find((t: { name: string }) => t.name === "rate_title");
    expect(rate.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: true });
    await call(tokens.access_token, rpc("tools/call", { name: "rate_title", arguments: { id: "tt0000001", rating: 9 } }));
    expect(api.calls.at(-1)).toEqual({ method: "PUT", path: "/api/ratings/tt0000001", body: { rating: 9 } });
  });

  it("rejects invalid tool input", async () => {
    build(true);
    const { tokens } = await fullLogin();
    const res = await call(tokens.access_token, rpc("tools/call", { name: "rate_title", arguments: { id: "not-an-id", rating: 11 } }));
    expect(res.result?.isError ?? Boolean(res.error)).toBe(true);
    expect(api.calls).toHaveLength(0);
  });

  it("refuses tokens that were revoked", async () => {
    const { tokens } = await fullLogin();
    for (const t of store.tokens.values()) t.revoked = true;
    const res = await request(app).post("/mcp").set(MCP_HEADERS).set("authorization", `Bearer ${tokens.access_token}`).send(INIT);
    expect(res.status).toBe(401);
  });
});
