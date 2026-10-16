import { randomBytes, timingSafeEqual } from "node:crypto";
import type { OAuthRegisteredClientsStore } from "@modelcontextprotocol/sdk/server/auth/clients.js";
import { InvalidGrantError, InvalidTokenError } from "@modelcontextprotocol/sdk/server/auth/errors.js";
import type { AuthorizationParams, OAuthServerProvider } from "@modelcontextprotocol/sdk/server/auth/provider.js";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import type { OAuthClientInformationFull, OAuthTokenRevocationRequest, OAuthTokens } from "@modelcontextprotocol/sdk/shared/auth.js";
import type { Response } from "express";
import { sha256, type OAuthStore } from "./store.js";

const ACCESS_TTL_S = 3600;
const REFRESH_TTL_S = 30 * 24 * 3600;
const CODE_TTL_S = 300;
export const SCOPES = ["cinemind"];

const newSecret = () => randomBytes(32).toString("base64url");

export function passwordMatches(given: string, expected: string): boolean {
  const a = Buffer.from(sha256(given));
  const b = Buffer.from(sha256(expected));
  return timingSafeEqual(a, b);
}

const escape = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/**
 * OAuth 2.1 authorization server for a single-owner CineMind. "Logging in"
 * means entering CINEMIND_MCP_PASSWORD on a consent page; there are no user
 * accounts. The SDK handles discovery metadata, dynamic client registration,
 * PKCE verification and request validation; this class stores state and
 * issues tokens.
 */
export class CineMindOAuthProvider implements OAuthServerProvider {
  constructor(
    private readonly store: OAuthStore,
    private readonly resourceUrl: URL,
    private readonly issuer: URL,
  ) {}

  get clientsStore(): OAuthRegisteredClientsStore {
    return {
      getClient: (id) => this.store.getClient(id),
      registerClient: async (client) => {
        const full = client as OAuthClientInformationFull;
        await this.store.saveClient(full);
        return full;
      },
    };
  }

  /** Render the consent page. The form posts to /oauth/consent, handled by consentHandler below. */
  async authorize(client: OAuthClientInformationFull, params: AuthorizationParams, res: Response): Promise<void> {
    const hidden = {
      client_id: client.client_id,
      redirect_uri: params.redirectUri,
      code_challenge: params.codeChallenge,
      state: params.state ?? "",
      scope: (params.scopes ?? SCOPES).join(" "),
      resource: params.resource?.href ?? "",
    };
    res.status(200).type("html").set("Cache-Control", "no-store").set("X-Frame-Options", "DENY").send(consentPage(client, hidden));
  }

  /** Called after the password checks out: mint a one-time code and redirect back to the client. */
  async issueCode(client: OAuthClientInformationFull, p: { redirectUri: string; codeChallenge: string; scopes: string[]; resource?: string; state?: string }): Promise<string> {
    const code = newSecret();
    await this.store.saveCode(sha256(code), {
      clientId: client.client_id,
      codeChallenge: p.codeChallenge,
      redirectUri: p.redirectUri,
      scopes: p.scopes,
      resource: p.resource,
      expiresAt: new Date(Date.now() + CODE_TTL_S * 1000),
    });
    const url = new URL(p.redirectUri);
    url.searchParams.set("code", code);
    if (p.state) url.searchParams.set("state", p.state);
    // RFC 9207: lets the client confirm which server issued the code (ChatGPT uses this).
    // Must be byte-identical to the issuer in the authorization server metadata.
    url.searchParams.set("iss", this.issuer.href);
    return url.href;
  }

  async challengeForAuthorizationCode(client: OAuthClientInformationFull, code: string): Promise<string> {
    const c = await this.store.getCode(sha256(code));
    if (!c || c.clientId !== client.client_id || c.expiresAt < new Date()) throw new InvalidGrantError("Invalid or expired authorization code");
    return c.codeChallenge;
  }

  async exchangeAuthorizationCode(client: OAuthClientInformationFull, code: string, _verifier?: string, redirectUri?: string, resource?: URL): Promise<OAuthTokens> {
    const c = await this.store.takeCode(sha256(code));
    if (!c || c.clientId !== client.client_id || c.expiresAt < new Date()) throw new InvalidGrantError("Invalid or expired authorization code");
    if (redirectUri && redirectUri !== c.redirectUri) throw new InvalidGrantError("redirect_uri does not match the authorization request");
    if (resource && c.resource && resource.href !== c.resource) throw new InvalidGrantError("resource does not match the authorization request");
    return this.issueTokens(client.client_id, c.scopes, c.resource ?? resource?.href);
  }

  async exchangeRefreshToken(client: OAuthClientInformationFull, refreshToken: string, scopes?: string[], resource?: URL): Promise<OAuthTokens> {
    const hash = sha256(refreshToken);
    const t = await this.store.getToken(hash);
    if (!t || t.kind !== "refresh" || t.revoked || t.clientId !== client.client_id || t.expiresAt < new Date()) {
      throw new InvalidGrantError("Invalid refresh token");
    }
    if (scopes?.some((s) => !t.scopes.includes(s))) throw new InvalidGrantError("Cannot widen scopes on refresh");
    // Rotate: the old refresh token stops working once a new one is issued.
    await this.store.revokeToken(hash);
    return this.issueTokens(client.client_id, scopes ?? t.scopes, t.resource ?? resource?.href);
  }

  private async issueTokens(clientId: string, scopes: string[], resource?: string): Promise<OAuthTokens> {
    const access = newSecret();
    const refresh = newSecret();
    const now = Date.now();
    await this.store.saveToken(sha256(access), { kind: "access", clientId, scopes, resource, expiresAt: new Date(now + ACCESS_TTL_S * 1000), revoked: false });
    await this.store.saveToken(sha256(refresh), { kind: "refresh", clientId, scopes, resource, expiresAt: new Date(now + REFRESH_TTL_S * 1000), revoked: false });
    return { access_token: access, token_type: "Bearer", expires_in: ACCESS_TTL_S, refresh_token: refresh, scope: scopes.join(" ") };
  }

  async verifyAccessToken(token: string): Promise<AuthInfo> {
    const t = await this.store.getToken(sha256(token));
    if (!t || t.kind !== "access" || t.revoked || t.expiresAt < new Date()) throw new InvalidTokenError("Invalid or expired access token");
    // Tokens are bound to this server (RFC 8707), so one minted for another resource is refused.
    if (t.resource && t.resource !== this.resourceUrl.href) throw new InvalidTokenError("Token was issued for a different resource");
    return { token, clientId: t.clientId, scopes: t.scopes, expiresAt: Math.floor(t.expiresAt.getTime() / 1000), resource: t.resource ? new URL(t.resource) : undefined };
  }

  async revokeToken(_client: OAuthClientInformationFull, request: OAuthTokenRevocationRequest): Promise<void> {
    await this.store.revokeToken(sha256(request.token));
  }
}

function consentPage(client: OAuthClientInformationFull, hidden: Record<string, string>, error?: string): string {
  const name = escape(client.client_name ?? "An MCP client");
  const host = escape(new URL(hidden.redirect_uri!).host);
  const fields = Object.entries(hidden)
    .map(([k, v]) => `<input type="hidden" name="${escape(k)}" value="${escape(v)}">`)
    .join("");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Connect to CineMind</title>
<style>
body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0b0a09;color:#f1ebe1;font:16px/1.5 system-ui,sans-serif}
main{width:min(380px,calc(100% - 32px));background:#15130f;border:1px solid #2a2620;border-radius:10px;padding:28px}
h1{font:400 30px Georgia,serif;margin:0 0 8px}h1 span{color:#e8a33d}p{color:#9a9184;margin:0 0 18px;font-size:14px}
strong{color:#f1ebe1}label{display:block;font-size:13px;color:#9a9184;margin-bottom:6px}
input[type=password]{width:100%;box-sizing:border-box;height:40px;border-radius:6px;border:1px solid #2a2620;background:#0b0a09;color:#f1ebe1;padding:0 12px;font-size:15px}
button{margin-top:14px;width:100%;height:40px;border:0;border-radius:6px;background:#e8a33d;color:#0b0a09;font-weight:600;font-size:15px;cursor:pointer}
.err{color:#d9645a;font-size:14px;margin:12px 0 0}
</style></head><body><main>
<h1>Cine<span>Mind</span></h1>
<p><strong>${name}</strong> wants access to your CineMind library and recommendations. It will return to <strong>${host}</strong>.</p>
<form method="post" action="/oauth/consent">${fields}
<label for="pw">CineMind password</label>
<input id="pw" name="password" type="password" autocomplete="current-password" required autofocus>
<button type="submit">Allow access</button>
${error ? `<p class="err" role="alert">${escape(error)}</p>` : ""}
</form></main></body></html>`;
}

export { consentPage };
