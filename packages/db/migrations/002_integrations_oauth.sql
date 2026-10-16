-- Ratings can now arrive from Trakt as well.
ALTER TABLE ratings DROP CONSTRAINT ratings_source_check;
ALTER TABLE ratings ADD CONSTRAINT ratings_source_check CHECK (source IN ('imdb_csv', 'manual', 'trakt'));

-- Substring title search (ILIKE '%...%') for the catalogue search used by the MCP connector.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX titles_title_trgm_idx ON titles USING gin (title gin_trgm_ops);

-- Third-party connections (Trakt). `data` holds tokens; keep database access private.
CREATE TABLE integrations (
  provider    text PRIMARY KEY,
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  data        jsonb NOT NULL,
  last_sync_at timestamptz,
  last_sync_result jsonb,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- OAuth 2.1 authorization server state for the remote MCP connector.
-- Codes and tokens are stored as SHA-256 hashes, never in plain text.
CREATE TABLE oauth_clients (
  client_id   text PRIMARY KEY,
  info        jsonb NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE oauth_codes (
  code_hash      text PRIMARY KEY,
  client_id      text NOT NULL REFERENCES oauth_clients(client_id) ON DELETE CASCADE,
  code_challenge text NOT NULL,
  redirect_uri   text NOT NULL,
  scopes         text[] NOT NULL DEFAULT '{}',
  resource       text,
  expires_at     timestamptz NOT NULL
);

CREATE TABLE oauth_tokens (
  token_hash  text PRIMARY KEY,
  kind        text NOT NULL CHECK (kind IN ('access', 'refresh')),
  client_id   text NOT NULL REFERENCES oauth_clients(client_id) ON DELETE CASCADE,
  scopes      text[] NOT NULL DEFAULT '{}',
  resource    text,
  expires_at  timestamptz NOT NULL,
  revoked     boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX oauth_tokens_expiry_idx ON oauth_tokens (expires_at);
