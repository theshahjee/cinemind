-- CineMind initial schema. PostgreSQL is the source of truth; pgvector stores embeddings.
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE users (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  -- Per-user signal settings: mode, scale, thresholds, recency half-life.
  settings    jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Catalogue of movies and series. `id` is the IMDb tt identifier.
CREATE TABLE titles (
  id               text PRIMARY KEY CHECK (id ~ '^tt[0-9]+$'),
  tmdb_id          integer,
  title            text NOT NULL,
  type             text NOT NULL,
  year             integer,
  runtime_minutes  integer,
  genres           text[] NOT NULL DEFAULT '{}',
  directors        text[] NOT NULL DEFAULT '{}',
  cast_members     text[] NOT NULL DEFAULT '{}',
  keywords         text[] NOT NULL DEFAULT '{}',
  language         text,
  overview         text,
  poster_path      text,
  imdb_rating      real,
  num_votes        integer,
  metadata_source  text NOT NULL DEFAULT 'imdb_csv',
  metadata_synced_at timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX titles_genres_idx ON titles USING gin (genres);
CREATE INDEX titles_tmdb_idx ON titles (tmdb_id);

-- One embedding per title per model, so the embedding model can change without data loss.
CREATE TABLE title_embeddings (
  title_id    text NOT NULL REFERENCES titles(id) ON DELETE CASCADE,
  model       text NOT NULL,
  embedding   vector(768) NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (title_id, model)
);
CREATE INDEX title_embeddings_hnsw ON title_embeddings USING hnsw (embedding vector_cosine_ops);

CREATE TABLE ratings (
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title_id    text NOT NULL REFERENCES titles(id) ON DELETE CASCADE,
  rating      smallint NOT NULL CHECK (rating BETWEEN 1 AND 10),
  rated_at    timestamptz NOT NULL,
  source      text NOT NULL DEFAULT 'manual' CHECK (source IN ('imdb_csv', 'manual')),
  PRIMARY KEY (user_id, title_id)
);
CREATE INDEX ratings_user_time_idx ON ratings (user_id, rated_at);

CREATE TABLE watch_events (
  id          bigserial PRIMARY KEY,
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title_id    text NOT NULL REFERENCES titles(id) ON DELETE CASCADE,
  season      integer,
  episode     integer,
  watched_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE watchlist (
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title_id    text NOT NULL REFERENCES titles(id) ON DELETE CASCADE,
  added_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, title_id)
);

-- Lightweight feedback on recommendations (like, dislike, not interested, saved).
CREATE TABLE feedback (
  id          bigserial PRIMARY KEY,
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title_id    text NOT NULL REFERENCES titles(id) ON DELETE CASCADE,
  kind        text NOT NULL CHECK (kind IN ('like', 'dislike', 'not_interested', 'save')),
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX feedback_user_idx ON feedback (user_id, created_at);

-- PostgreSQL-backed job queue (metadata sync, embeddings). Workers claim with SKIP LOCKED.
CREATE TABLE jobs (
  id          bigserial PRIMARY KEY,
  kind        text NOT NULL,
  payload     jsonb NOT NULL DEFAULT '{}'::jsonb,
  status      text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'done', 'failed')),
  attempts    integer NOT NULL DEFAULT 0,
  last_error  text,
  run_after   timestamptz NOT NULL DEFAULT now(),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX jobs_pending_idx ON jobs (run_after) WHERE status = 'pending';
