import { createHash } from "node:crypto";
import type { OAuthClientInformationFull } from "@modelcontextprotocol/sdk/shared/auth.js";
import type pg from "pg";

export const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

export interface StoredCode {
  clientId: string;
  codeChallenge: string;
  redirectUri: string;
  scopes: string[];
  resource?: string;
  expiresAt: Date;
}

export interface StoredToken {
  kind: "access" | "refresh";
  clientId: string;
  scopes: string[];
  resource?: string;
  expiresAt: Date;
  revoked: boolean;
}

/** Persistence for the authorization server. Secrets (codes, tokens) are passed in already hashed. */
export interface OAuthStore {
  getClient(id: string): Promise<OAuthClientInformationFull | undefined>;
  saveClient(client: OAuthClientInformationFull): Promise<void>;
  saveCode(hash: string, code: StoredCode): Promise<void>;
  getCode(hash: string): Promise<StoredCode | undefined>;
  /** Delete and return the code, so it can be used once only. */
  takeCode(hash: string): Promise<StoredCode | undefined>;
  saveToken(hash: string, token: StoredToken): Promise<void>;
  getToken(hash: string): Promise<StoredToken | undefined>;
  revokeToken(hash: string): Promise<void>;
}

export class MemoryOAuthStore implements OAuthStore {
  clients = new Map<string, OAuthClientInformationFull>();
  codes = new Map<string, StoredCode>();
  tokens = new Map<string, StoredToken>();
  async getClient(id: string) {
    return this.clients.get(id);
  }
  async saveClient(c: OAuthClientInformationFull) {
    this.clients.set(c.client_id, c);
  }
  async saveCode(h: string, c: StoredCode) {
    this.codes.set(h, c);
  }
  async getCode(h: string) {
    return this.codes.get(h);
  }
  async takeCode(h: string) {
    const c = this.codes.get(h);
    this.codes.delete(h);
    return c;
  }
  async saveToken(h: string, t: StoredToken) {
    this.tokens.set(h, t);
  }
  async getToken(h: string) {
    return this.tokens.get(h);
  }
  async revokeToken(h: string) {
    const t = this.tokens.get(h);
    if (t) t.revoked = true;
  }
}

export class PostgresOAuthStore implements OAuthStore {
  constructor(private readonly pool: pg.Pool) {}

  async getClient(id: string) {
    const { rows } = await this.pool.query<{ info: OAuthClientInformationFull }>("SELECT info FROM oauth_clients WHERE client_id = $1", [id]);
    return rows[0]?.info;
  }
  async saveClient(c: OAuthClientInformationFull) {
    await this.pool.query("INSERT INTO oauth_clients (client_id, info) VALUES ($1, $2) ON CONFLICT (client_id) DO UPDATE SET info = EXCLUDED.info", [c.client_id, c]);
  }
  async saveCode(h: string, c: StoredCode) {
    await this.pool.query(
      "INSERT INTO oauth_codes (code_hash, client_id, code_challenge, redirect_uri, scopes, resource, expires_at) VALUES ($1,$2,$3,$4,$5,$6,$7)",
      [h, c.clientId, c.codeChallenge, c.redirectUri, c.scopes, c.resource ?? null, c.expiresAt],
    );
  }
  private toCode(r: { client_id: string; code_challenge: string; redirect_uri: string; scopes: string[]; resource: string | null; expires_at: Date }): StoredCode {
    return { clientId: r.client_id, codeChallenge: r.code_challenge, redirectUri: r.redirect_uri, scopes: r.scopes, resource: r.resource ?? undefined, expiresAt: r.expires_at };
  }
  async getCode(h: string) {
    const { rows } = await this.pool.query("SELECT * FROM oauth_codes WHERE code_hash = $1", [h]);
    return rows[0] ? this.toCode(rows[0]) : undefined;
  }
  async takeCode(h: string) {
    const { rows } = await this.pool.query("DELETE FROM oauth_codes WHERE code_hash = $1 RETURNING *", [h]);
    return rows[0] ? this.toCode(rows[0]) : undefined;
  }
  async saveToken(h: string, t: StoredToken) {
    await this.pool.query(
      "INSERT INTO oauth_tokens (token_hash, kind, client_id, scopes, resource, expires_at, revoked) VALUES ($1,$2,$3,$4,$5,$6,$7)",
      [h, t.kind, t.clientId, t.scopes, t.resource ?? null, t.expiresAt, t.revoked],
    );
    // Opportunistic cleanup keeps the table small without a separate job.
    await this.pool.query("DELETE FROM oauth_tokens WHERE expires_at < now() - interval '1 day'");
  }
  async getToken(h: string) {
    const { rows } = await this.pool.query<{ kind: "access" | "refresh"; client_id: string; scopes: string[]; resource: string | null; expires_at: Date; revoked: boolean }>(
      "SELECT kind, client_id, scopes, resource, expires_at, revoked FROM oauth_tokens WHERE token_hash = $1",
      [h],
    );
    const r = rows[0];
    return r && { kind: r.kind, clientId: r.client_id, scopes: r.scopes, resource: r.resource ?? undefined, expiresAt: r.expires_at, revoked: r.revoked };
  }
  async revokeToken(h: string) {
    await this.pool.query("UPDATE oauth_tokens SET revoked = true WHERE token_hash = $1", [h]);
  }
}
