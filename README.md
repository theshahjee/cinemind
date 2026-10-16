# CineMind

A self-hosted movie and TV recommender that learns from your own ratings, explains every pick, and publishes how well it actually works.

Import your IMDb ratings, and CineMind builds a taste profile from them: the genres, directors, cast and themes you rate above your own average, and the ones you rate below it. It ranks titles you haven't seen against that profile. Each recommendation lists the parts of your taste it matches and anything it carries that you tend to dislike. Thumbs up, thumbs down and "not interested" feed back into the next ranking.

Ratings come in through your IMDb export, a watched import folder, or a Trakt account that keeps syncing. You can also use CineMind from Claude or ChatGPT: it includes an MCP server, so you can ask "what should I watch tonight?" and get an answer built from your own ratings. See [docs/CONNECTORS.md](docs/CONNECTORS.md).

An LLM is optional. The ranking engine runs without one. If you configure one, it powers the "Ask" page, which turns requests like "a tense thriller under two hours, no romance" into filters. Ask is read-only and never touches your ratings or watchlist.

## Does it work?

On a synthetic benchmark the hybrid model ranks held-out favourites better than a popularity baseline: NDCG@10 of 0.48 against 0.41, averaged over five seeds. Precision@10 is a tie. Content matching on its own loses to popularity, and per-user weight tuning overfit, so neither is the default. [docs/EVALUATION.md](docs/EVALUATION.md) has the protocol, the full table and the changes the benchmark forced. The numbers come from synthetic users rather than real people, and `pnpm eval -- your-ratings.csv` runs the same harness on your own export.

## How it fits together

```
apps/web       Next.js UI. Calls the API server-side, so the API token never reaches the browser.
apps/api       Fastify API, metadata worker, catalogue seeder, Trakt sync.
apps/mcp       MCP server for Claude and ChatGPT: local (stdio) or remote (HTTP with OAuth 2.1).
plugins/       Claude Code plugin (the repo root is also its marketplace).
packages/core  Recommender, IMDb CSV parser, evaluation metrics. Pure TypeScript, no I/O.
packages/db    PostgreSQL migrations (pgvector, job queue).
```

The score for a user u and title m is `S = wc·C + wg·G + wp·P`:

- **C** is the cosine similarity between the title's plot embedding and your taste centroid. Liked titles pull the centroid toward them and disliked ones push it away.
- **G** is your affinity for the title's genres, directors, cast, keywords, language and decade. Ratings are measured against your own mean, weighted by recency and shrunk toward zero when there's little evidence.
- **P** comes from a small linear model of how your ratings relate to IMDb's. It picks up habits like "I rate everything a point below consensus".

Maximal Marginal Relevance then re-ranks the head of the list so it isn't twenty versions of the same film.

## Running it

You need Docker, or Node 22 with pnpm 10.

```bash
cp .env.example .env
```

Set `CINEMIND_API_TOKEN` to a random string (`openssl rand -hex 32`), and set `CINEMIND_WEB_PASSWORD` if the app will be reachable from anything other than your own machine. Then:

```bash
docker compose up --build
```

Open http://localhost:3000, go to Library, and upload your IMDb export. To get it, open Your Ratings on IMDb, click the ⋯ menu and choose Export.

Your ratings alone leave nothing new to recommend, so seed a catalogue of candidates from IMDb's free datasets. This streams about 1 GB of compressed files and keeps movies and series with at least 20,000 votes:

```bash
docker compose run --rm api node dist/seedCatalogue.js --min-votes 20000
```

Add `--sync` to queue TMDB metadata for every seeded title. The worker container processes the queue.

After that, there are three ways to keep ratings coming in:

- Upload a fresh IMDb export on the Library page.
- Drop it into `data/import/`. The worker imports it within a minute and moves it to `data/import/imported/`.
- Connect Trakt on the Connections page. It pulls your ratings and watchlist every six hours, and Trakt can import your IMDb history itself.

Re-importing is safe either way, because a rating is only replaced by a newer one.

### Without Docker

```bash
pnpm install
```

```bash
docker compose up -d db
```

```bash
pnpm build && pnpm db:migrate
```

Then run `pnpm dev:api` and `pnpm dev:web` in two terminals. If `DATABASE_URL` is unset, the API falls back to in-memory storage, which is handy for poking around but loses everything on restart.

## Keys and services

| What | Needed? | Where to get it |
|---|---|---|
| IMDb ratings export | Yes, it's your data | IMDb → Your Ratings → ⋯ → Export |
| IMDb datasets | For the candidate catalogue | Downloaded by the seeder, no key. [Personal, non-commercial use only](https://developer.imdb.com/non-commercial-datasets/). |
| TMDB read access token | Recommended | [themoviedb.org/settings/api](https://www.themoviedb.org/settings/api). Free for non-commercial use with attribution. Adds posters, cast, keywords and plots, and plots are what embeddings are built from. |
| Trakt client ID | Optional | Create an app at [trakt.tv/oauth/applications](https://trakt.tv/oauth/applications). CineMind connects with a device code and never uses the redirect URI, but Trakt requires an `https://` one, so the repo URL works. Trakt's guide says app creation needs a verified GitHub account. |
| LLM | Optional | See below |

### Choosing an LLM

Set `LLM_PROVIDER` to `none`, `gemini` or `openai`. The `openai` option works with any server that speaks the OpenAI API:

| Option | Settings | Notes |
|---|---|---|
| Ollama, local | `LLM_BASE_URL=http://localhost:11434/v1`, `LLM_MODEL=llama3.1`, `EMBEDDING_MODEL=nomic-embed-text` | Free, and nothing leaves your machine. `nomic-embed-text` produces the 768-dimensional vectors the database expects. |
| Groq | `LLM_BASE_URL=https://api.groq.com/openai/v1`, `LLM_API_KEY=...` | Keys at [console.groq.com/keys](https://console.groq.com/keys). Fast, with a free plan. Doesn't serve embeddings, so point `EMBEDDING_BASE_URL` at Ollama. |
| xAI Grok | `LLM_BASE_URL=https://api.x.ai/v1`, `LLM_API_KEY=...` | Keys at [console.x.ai](https://console.x.ai). Paid. No embedding models, so pair it with Ollama for embeddings. |
| OpenRouter | `LLM_BASE_URL=https://openrouter.ai/api/v1`, `LLM_API_KEY=...` | One key for many models. |
| Gemini | `GEMINI_API_KEY=...` | Has a free tier. Google's pricing page says free-tier data may be used to improve its products, so read the terms first. |

Chat and embeddings can come from different providers. Keys stay on the API server.

## API

Every route except `/health` needs `Authorization: Bearer $CINEMIND_API_TOKEN`.

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/import/imdb` | Import an IMDb ratings CSV (`content-type: text/csv`) |
| GET | `/api/library` | Rated and saved titles. Filters: `search`, `genre`, `type`, `minRating` |
| PUT, DELETE | `/api/ratings/:id` | Set or remove a rating |
| GET | `/api/watchlist` | Watchlist |
| PUT | `/api/watchlist/:id` | Add to or remove from the watchlist (`{ "on": true }`) |
| POST | `/api/feedback/:id` | `like`, `dislike`, `not_interested` or `save` |
| GET | `/api/recommendations?k=20` | Ranked recommendations with explanations |
| POST | `/api/ask` | Natural-language search (`{ "query": "..." }`) |
| GET | `/api/taste` | Taste analytics |
| GET | `/api/titles/search?q=` | Search the catalogue by title |
| GET | `/api/titles/:id` | One title with your rating and watchlist status |
| GET, DELETE | `/api/integrations/trakt` | Trakt connection status, or disconnect |
| POST | `/api/integrations/trakt/device`, `/poll`, `/sync` | Connect Trakt with a device code, then sync |

## Development

```bash
pnpm build && pnpm test
```

The Postgres repository tests run when `DATABASE_URL` is set, and are skipped otherwise. CI runs them against pgvector and posts the evaluation table to each run's summary.

## Status

v0.2. It works end to end, including Trakt sync and the Claude and ChatGPT connectors, but recommendations have only been measured on synthetic data so far. The [roadmap](docs/ROADMAP.md) lists what's next, starting with pgvector retrieval and checking whether embeddings help on real ratings.

## Attribution

This product uses TMDB and the TMDB APIs but is not endorsed, certified, or otherwise approved by TMDB. TMDB's terms also ask for its logo on the attribution, which the UI doesn't show yet. Information courtesy of IMDb (https://www.imdb.com), used with permission under its non-commercial dataset terms.

MIT licensed. See [LICENSE](LICENSE).
