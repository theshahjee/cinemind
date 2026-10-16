import { importImdbRatings } from "@cinemind/core";
import type { Repository } from "./repo/types.js";
import { traktToRating, traktToTitle, tokensExpired, type TraktClient, type TraktTokens } from "./trakt.js";

export type TitlesImportedHook = (ids: string[]) => Promise<void>;

/**
 * Import an IMDb export: "Your Ratings", or a list such as the Watchlist.
 * Shared by the upload endpoint and the watched import folder.
 */
export async function importImdbCsv(repo: Repository, csv: string, onTitlesImported?: TitlesImportedHook) {
  const parsed = importImdbRatings(csv);
  const userId = await repo.getOwnerId();
  // Blank CSV fields never overwrite richer metadata already stored (see upsertTitles).
  await repo.upsertTitles(parsed.titles);
  await repo.upsertRatings(userId, parsed.ratings, "imdb_csv");
  for (const id of parsed.listIds) await repo.setWatchlist(userId, id, true);
  await onTitlesImported?.(parsed.titles.map((t) => t.id));
  return { kind: parsed.kind, imported: parsed.ratings.length, watchlisted: parsed.listIds.length, skipped: parsed.skipped };
}

export interface TraktSyncResult {
  ratings: number;
  watchlist: number;
  skippedNoImdbId: number;
  newTitles: number;
}

/**
 * Pull ratings and watchlist from Trakt. One-way: Trakt -> CineMind. A rating
 * only replaces an existing one if it is at least as recent (see upsertRatings).
 */
export async function syncTrakt(repo: Repository, trakt: TraktClient, onTitlesImported?: TitlesImportedHook): Promise<TraktSyncResult> {
  const integration = await repo.getIntegration("trakt");
  if (!integration) throw new Error("Trakt is not connected");
  const userId = await repo.getOwnerId();

  let tokens = integration.data as unknown as TraktTokens;
  if (tokensExpired(tokens)) {
    tokens = await trakt.refresh(tokens.refresh_token);
    await repo.saveIntegration(userId, "trakt", tokens as unknown as Record<string, unknown>);
  }

  const [ratingItems, listItems] = await Promise.all([trakt.ratings(tokens.access_token), trakt.watchlist(tokens.access_token)]);
  const titles = [...ratingItems, ...listItems].flatMap((i) => traktToTitle(i) ?? []);
  const ratings = ratingItems.flatMap((i) => traktToRating(i) ?? []);
  const watchIds = listItems.flatMap((i) => traktToTitle(i)?.id ?? []);

  const catalogue = await repo.getCatalogue();
  const fresh = [...new Map(titles.filter((t) => !catalogue.has(t.id)).map((t) => [t.id, t])).values()];
  await repo.upsertTitles(fresh);
  await repo.upsertRatings(userId, ratings, "trakt");
  for (const id of watchIds) await repo.setWatchlist(userId, id, true);
  if (fresh.length) await onTitlesImported?.(fresh.map((t) => t.id));

  const result: TraktSyncResult = {
    ratings: ratings.length,
    watchlist: watchIds.length,
    skippedNoImdbId: ratingItems.length + listItems.length - ratings.length - watchIds.length,
    newTitles: fresh.length,
  };
  await repo.recordSync("trakt", result as unknown as Record<string, unknown>);
  return result;
}
