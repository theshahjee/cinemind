# CineMind

A self-hosted movie and TV recommender that learns from your own ratings, explains every pick, and publishes how well it actually works.

Import your IMDb ratings, and CineMind builds a taste profile from them: the genres, directors, cast and themes you rate above your own average, and the ones you rate below it. It ranks titles you haven't seen against that profile. Each recommendation lists the parts of your taste it matches and anything it carries that you tend to dislike. Thumbs up, thumbs down and "not interested" feed back into the next ranking.

An LLM is optional. The ranking engine runs without one. If you configure one, it powers the "Ask" page, which turns requests like "a tense thriller under two hours, no romance" into filters. Ask is read-only and never touches your ratings or watchlist.

## Does it work?

On a synthetic benchmark the hybrid model ranks held-out favourites better than a popularity baseline: NDCG@10 of 0.48 against 0.41, averaged over five seeds. Precision@10 is a tie. Content matching on its own loses to popularity, and per-user weight tuning overfit, so neither is the default. [docs/EVALUATION.md](docs/EVALUATION.md) has the protocol, the full table and the changes the benchmark forced. The numbers come from synthetic users rather than real people, and `pnpm eval -- your-ratings.csv` runs the same harness on your own export.

## How it fits together

```
apps/web       Next.js UI. Calls the API server-side, so the API token never reaches the browser.
apps/api       Fastify API, metadata worker and catalogue seeder.
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
| TMDB read access token | Recommended | [themoviedb.org/settings/api](https://www.themoviedb.org/settings/api). Free for non-commercial use with attribution, which the UI footer provides. Adds posters, cast, keywords and plots, and plots are what embeddings are built from. |
| LLM | Optional | See below |

### Choosing an LLM

Set `LLM_PROVIDER` to `none`, `gemini` or `openai`. The `openai` option works with any server that speaks the OpenAI API:

| Option | Settings | Notes |
|---|---|---|
| Ollama, local | `LLM_BASE_URL=http://localhost:11434/v1`, `LLM_MODEL=llama3.1`, `EMBEDDING_MODEL=nomic-embed-text` | Free, and nothing leaves your machine. `nomic-embed-text` produces the 768-dimensional vectors the database expects. |
| Groq | `LLM_BASE_URL=https://api.groq.com/openai/v1`, `LLM_API_KEY=...` | Fast, with a free tier. Doesn't serve embeddings, so point `EMBEDDING_BASE_URL` at Ollama. |
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

## Development

```bash
pnpm build && pnpm test
```

The Postgres repository tests run when `DATABASE_URL` is set, and are skipped otherwise. CI runs them against pgvector and posts the evaluation table to each run's summary.

## Status

v0.1. It works end to end, but it has only been measured on synthetic data so far. The [roadmap](docs/ROADMAP.md) lists what's next, starting with pgvector retrieval and checking whether embeddings help on real ratings.

## Attribution

This product uses the TMDB API but is not endorsed or certified by TMDB. Information courtesy of IMDb (https://www.imdb.com), used with permission under its non-commercial dataset terms.

MIT licensed. See [LICENSE](LICENSE).
