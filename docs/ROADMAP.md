# Roadmap

Rough order, following the original six-week plan. Things move when the evaluation says so.

## Done in v0.1

- pnpm monorepo: `packages/core` (recommender and evaluation), `packages/db` (migrations), `apps/api` (Fastify), `apps/web` (Next.js)
- IMDb ratings CSV import, with per-row error reporting
- Candidate catalogue seeded from IMDb's non-commercial datasets
- PostgreSQL schema with pgvector, plus a job queue that claims work with `SKIP LOCKED`
- Worker: TMDB metadata sync (posters, cast, keywords, plot), then embeddings
- Hybrid recommender: mean-centred taste profile, recency weighting, feature affinities, rating-pattern model, embedding centroid, MMR diversity
- Explanations listing the parts of your taste a title matches and the dislikes it carries
- Like, dislike, save and not-interested feedback, used as inferred ratings that never overwrite explicit ones
- Read-only "Ask" search: an LLM extracts structured filters, and a rule-based parser takes over when no LLM is configured or the call fails
- LLM provider abstraction: Gemini, or any OpenAI-compatible server (Ollama, Groq, OpenRouter and others)
- Taste analytics that separate stated ratings from inferred ones
- Offline evaluation harness and synthetic benchmark, run in CI
- Docker Compose for the database, API, worker and web app

## Done in v0.2

- MCP server with 10 tools, run locally over stdio or remotely over Streamable HTTP
- OAuth 2.1 authorization server for the remote connector: discovery metadata, dynamic client registration, PKCE, hashed and rotating tokens, password consent page with lockout
- Claude Code plugin and marketplace, with a `what-to-watch` skill
- Trakt sync over the device flow: ratings and watchlist, automatic refresh, periodic pulls
- Watched import folder for IMDb exports
- Ratings are only replaced by newer ones, whatever the source
- TMDB metadata re-synced before it reaches TMDB's six-month cache limit

## Next

- [ ] TMDB logo in the attribution, as TMDB's terms ask
- [ ] Settings page listing connected MCP clients, with a revoke button
- [ ] Client ID Metadata Document support, which ChatGPT and Claude both prefer over dynamic registration

- [ ] Episode-level tracking and watch dates in the UI (the `watch_events` table already exists)
- [ ] Use pgvector for candidate retrieval (nearest neighbours of the taste centroid) instead of scoring the whole catalogue in memory
- [ ] Measure embeddings properly: evaluate with and without them on real ratings once TMDB sync has run
- [ ] Per-user settings UI for signal mode, thresholds and recency half-life
- [ ] Use the LLM to explain recommendations, kept strictly apart from verified metadata
- [ ] Conversation history for Ask
- [ ] Tone and mood attributes (pacing, intensity, ending) where reliable data exists
- [ ] Better weight learning: regularised regression instead of grid search, cross-validated over time windows
- [ ] Collaborative filtering experiments, only with users who opt in to sharing ratings
- [ ] Demo dataset and a short walkthrough video
