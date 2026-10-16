import { mcpAuthRouter, getOAuthProtectedResourceMetadataUrl } from "@modelcontextprotocol/sdk/server/auth/router.js";
import { redirectUriMatches } from "@modelcontextprotocol/sdk/server/auth/handlers/authorize.js";
import { requireBearerAuth } from "@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import express from "express";
import type { CineMindClient } from "./client.js";
import { CineMindOAuthProvider, consentPage, passwordMatches, SCOPES } from "./oauth/provider.js";
import type { OAuthStore } from "./oauth/store.js";
import { createMcpServer } from "./server.js";

export interface HttpAppOptions {
  /** Public HTTPS origin the connector is reached at, e.g. https://cinemind.example.com */
  publicUrl: URL;
  password: string;
  store: OAuthStore;
  client: CineMindClient;
  allowWrites: boolean;
}

const MAX_FAILURES = 10;
const FAILURE_WINDOW_MS = 15 * 60_000;

/**
 * Remote MCP server (Streamable HTTP) with its own OAuth 2.1 authorization
 * server, for claude.ai and ChatGPT custom connectors. Stateless: each POST
 * gets a fresh MCP server instance.
 */
export function createHttpApp(opts: HttpAppOptions): express.Express {
  const mcpUrl = new URL("/mcp", opts.publicUrl);
  const issuer = new URL(opts.publicUrl.origin);
  const provider = new CineMindOAuthProvider(opts.store, mcpUrl, issuer);
  const app = express();
  app.set("trust proxy", 1);
  app.disable("x-powered-by");

  app.get("/health", (_req, res) => {
    res.json({ ok: true });
  });

  app.use(
    mcpAuthRouter({
      provider,
      issuerUrl: issuer,
      resourceServerUrl: mcpUrl,
      scopesSupported: SCOPES,
      resourceName: "CineMind",
    }),
  );

  // Brute-force protection for the password form, per client IP.
  const failures = new Map<string, { count: number; since: number }>();
  app.post("/oauth/consent", express.urlencoded({ extended: false, limit: "10kb" }), async (req, res) => {
    const ip = req.ip ?? "unknown";
    const f = failures.get(ip);
    if (f && Date.now() - f.since < FAILURE_WINDOW_MS && f.count >= MAX_FAILURES) {
      res.status(429).type("text").send("Too many attempts. Try again in 15 minutes.");
      return;
    }

    const b = req.body as Record<string, string | undefined>;
    const client = b.client_id ? await opts.store.getClient(b.client_id) : undefined;
    // Hidden fields can be tampered with, so re-check the redirect target against the registration.
    // Loopback redirects (Claude Code) match on any port, as in the SDK's own authorize handler.
    if (!client || !b.redirect_uri || !client.redirect_uris.some((r) => redirectUriMatches(b.redirect_uri!, r)) || !b.code_challenge) {
      res.status(400).type("text").send("Invalid authorization request. Start the connection again from your app.");
      return;
    }
    if (!passwordMatches(b.password ?? "", opts.password)) {
      const prev = f && Date.now() - f.since < FAILURE_WINDOW_MS ? f : { count: 0, since: Date.now() };
      failures.set(ip, { count: prev.count + 1, since: prev.since });
      const hidden = {
        client_id: client.client_id,
        redirect_uri: b.redirect_uri,
        code_challenge: b.code_challenge,
        state: b.state ?? "",
        scope: b.scope ?? SCOPES.join(" "),
        resource: b.resource ?? "",
      };
      res.status(401).type("html").set("Cache-Control", "no-store").send(consentPage(client, hidden, "Wrong password. Try again."));
      return;
    }
    failures.delete(ip);
    const scopes = (b.scope || SCOPES.join(" ")).split(" ").filter((s) => SCOPES.includes(s));
    const location = await provider.issueCode(client, {
      redirectUri: b.redirect_uri,
      codeChallenge: b.code_challenge,
      scopes: scopes.length ? scopes : SCOPES,
      resource: b.resource || undefined,
      state: b.state || undefined,
    });
    res.redirect(302, location);
  });

  const auth = requireBearerAuth({
    verifier: provider,
    requiredScopes: SCOPES,
    resourceMetadataUrl: getOAuthProtectedResourceMetadataUrl(mcpUrl),
  });

  app.post("/mcp", auth, express.json({ limit: "1mb" }), async (req, res) => {
    const server = createMcpServer(opts.client, { allowWrites: opts.allowWrites });
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on("close", () => {
      void transport.close();
      void server.close();
    });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (err) {
      if (!res.headersSent) res.status(500).json({ jsonrpc: "2.0", error: { code: -32603, message: (err as Error).message }, id: null });
    }
  });

  // Stateless server: no server-initiated streams or sessions to close.
  app.all("/mcp", auth, (_req, res) => {
    res.status(405).set("Allow", "POST").json({ jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed" }, id: null });
  });

  return app;
}
