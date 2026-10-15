# Evaluation

The point of this file is to answer one question honestly: does CineMind rank titles better than a simple baseline? Every number here can be reproduced with `pnpm eval`, and CI prints the same table on every push.

## Protocol

1. Sort the ratings by date. The oldest 80% train the model and the newest 20% are held out. A random split would let future taste leak into training.
2. Each model ranks the held-out titles. Titles rated 8 or higher count as relevant, and NDCG uses graded gain (`rating - 7`).
3. Each model also builds a top-10 list from every title not rated in training. Coverage and diversity are measured on that list, because it's the list a person would actually see.
4. Cold-start NDCG repeats step 2 on held-out titles whose director never appears in the training ratings.

Why rank only the held-out titles? Against the full catalogue, "relevant" would mostly mean "happened to watch it", which tells you about viewing habits rather than taste.

## Models

| Name | What it does |
|---|---|
| popularity | Bayesian-averaged IMDb rating. Ignores the user. |
| content | Feature affinities (genre, director, cast, keywords, decade) and embedding similarity. No rating-pattern model, no diversity. |
| hybrid (tuned weights) | Hybrid with weights grid-searched on a validation slice of the user's older ratings. |
| hybrid (no MMR) | Hybrid with fixed weights, no diversity re-ranking. |
| hybrid | The default: fixed weights and MMR diversity re-ranking. |

The hybrid score is `S = wc·C + wg·G + wp·P`, where C is embedding similarity to the taste centroid, G is aggregated feature affinity and P is a per-user linear model of "my rating vs. the IMDb rating". The defaults are 0.4, 0.4 and 0.2. When a title has no embedding, its content weight is redistributed rather than scored as zero.

## Current results (synthetic data)

These numbers come from synthetic users, not real people. The generator (`packages/core/src/eval/synthetic.ts`) builds a fictional catalogue of 1,500 titles and a user whose ratings follow hidden genre and director preferences, a quality term, noise, and a mid-history taste shift where their least favourite genre becomes a favourite. The table averages five seeds.

| Model | P@10 | R@10 | NDCG@10 | RMSE | MAE | Coverage | Diversity | Cold-start NDCG@10 |
|---|---|---|---|---|---|---|---|---|
| popularity | 0.720 | 0.242 | 0.412 | n/a | n/a | 0.008 | 0.915 | 0.470 |
| content | 0.660 | 0.209 | 0.373 | 1.645 | 1.348 | 0.008 | 0.734 | 0.339 |
| hybrid (tuned weights) | 0.660 | 0.212 | 0.394 | 1.578 | 1.316 | 0.008 | 0.866 | 0.454 |
| hybrid (no MMR) | 0.720 | 0.231 | 0.479 | 1.576 | 1.291 | 0.008 | 0.844 | 0.517 |
| hybrid | 0.700 | 0.227 | 0.476 | 1.576 | 1.291 | 0.008 | 0.844 | 0.500 |

What I take from this:

- The hybrid beats popularity on NDCG (0.48 against 0.41) and on cold start. Precision@10 is a tie, so the gain comes from putting the best titles at the top, not from finding more good ones.
- Content-only loses to popularity. On its own, taste matching can't tell a good thriller from a bad one, so it needs the rating-pattern term.
- Tuning the weights per user made things worse. With about 60 validation titles, the grid search fits noise. It stays in the report as a reminder and isn't the default.
- MMR costs almost nothing in accuracy here. Its effect on variety shows up more on real catalogues, where many candidates are near-duplicates.
- Coverage is 10 out of roughly 1,200 candidates for a single user, so it means little until there are several profiles to compare.

## Decisions the benchmark changed

- **Mean-centred rating signals.** The first version mapped ratings to signals through fixed thresholds (8 to 10 gave +1, 6 to 7 gave +0.5, and so on). That flattened a 10 and an 8 into the same signal and ignored the user's own baseline, and the hybrid lost to popularity on NDCG (0.379 against 0.412). Measuring each rating against the user's mean raised it to 0.494. The threshold mode is still available in `SignalConfig`.
- **Feature-kind weights.** Decade and language now count for less than genre and director. On a three-rating smoke test, decade alone was overriding a same-director match. The synthetic NDCG moved by -0.018, which is inside seed-to-seed variation.
- **Recency measured from the newest rating.** Measuring from the wall clock made a profile fade whenever someone stopped rating for a while.

## Running it on your own ratings

```bash
pnpm eval -- path/to/your/imdb-ratings.csv
```

With only an IMDb export, the catalogue holds just your rated titles, and metadata is limited to what the CSV carries (genres, directors, year, runtime, IMDb rating). Results get more meaningful once TMDB metadata and embeddings are synced. Keep personal exports in `data/`, which is git-ignored.
