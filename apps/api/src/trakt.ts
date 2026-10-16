import type { Rating, Title, TitleType } from "@cinemind/core";

const BASE = "https://api.trakt.tv";
/** Trakt serves OAuth (device codes, tokens) from a separate host. */
const AUTH_BASE = "https://auth.trakt.tv";

export interface TraktTokens {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  created_at: number;
  scope?: string;
  token_type?: string;
}

export interface DeviceCode {
  device_code: string;
  user_code: string;
  verification_url: string;
  expires_in: number;
  interval: number;
}

export type PollResult =
  | { status: "connected"; tokens: TraktTokens }
  | { status: "pending" | "slow_down" | "expired" | "denied" | "invalid" | "used" };

interface TraktIds {
  imdb?: string | null;
  tmdb?: number | null;
}
interface TraktMedia {
  title: string;
  year?: number | null;
  ids: TraktIds;
}
export interface TraktRatingItem {
  rated_at: string;
  rating: number;
  type: "movie" | "show";
  movie?: TraktMedia;
  show?: TraktMedia;
}
export interface TraktListItem {
  listed_at: string;
  type: "movie" | "show";
  movie?: TraktMedia;
  show?: TraktMedia;
}

/**
 * Trakt API client. Uses the OAuth device flow, which suits a self-hosted app:
 * the user types a short code on trakt.tv, so no public redirect URL is needed.
 */
export class TraktClient {
  constructor(
    private readonly clientId: string,
    /** Optional: Trakt has deprecated the client secret for device and refresh flows. */
    private readonly clientSecret?: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private headers(token?: string): Record<string, string> {
    const h: Record<string, string> = {
      "content-type": "application/json",
      "trakt-api-version": "2",
      "trakt-api-key": this.clientId,
      "user-agent": "CineMind/0.1 (+https://github.com/theshahjee/cinemind)",
    };
    if (token) h.authorization = `Bearer ${token}`;
    return h;
  }

  private async post(path: string, body: Record<string, unknown>): Promise<Response> {
    if (this.clientSecret) body = { ...body, client_secret: this.clientSecret };
    return this.fetchImpl(`${AUTH_BASE}${path}`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
  }

  async startDeviceAuth(): Promise<DeviceCode> {
    const res = await this.post("/oauth/device/code", { client_id: this.clientId });
    if (!res.ok) throw new Error(`Trakt device code request failed with ${res.status}`);
    return (await res.json()) as DeviceCode;
  }

  async pollDeviceAuth(deviceCode: string): Promise<PollResult> {
    const res = await this.post("/oauth/device/token", { code: deviceCode, client_id: this.clientId });
    if (res.status === 200) return { status: "connected", tokens: (await res.json()) as TraktTokens };
    const map: Record<number, PollResult["status"]> = { 400: "pending", 404: "invalid", 409: "used", 410: "expired", 418: "denied", 429: "slow_down" };
    const status = map[res.status];
    if (!status) throw new Error(`Trakt device token poll failed with ${res.status}`);
    return { status } as PollResult;
  }

  async refresh(refreshToken: string): Promise<TraktTokens> {
    const res = await this.post("/oauth/token", {
      refresh_token: refreshToken,
      client_id: this.clientId,
      grant_type: "refresh_token",
    });
    // Refresh tokens are single-use. A failure here usually means the user has to connect again.
    if (!res.ok) throw new Error(`Trakt token refresh failed with ${res.status}. Reconnect Trakt.`);
    return (await res.json()) as TraktTokens;
  }

  private async get<T>(path: string, token: string): Promise<T> {
    const res = await this.fetchImpl(`${BASE}${path}`, { headers: this.headers(token), signal: AbortSignal.timeout(30_000) });
    if (res.status === 401) throw new Error("Trakt rejected the access token. Reconnect Trakt.");
    if (!res.ok) throw new Error(`Trakt ${path} failed with ${res.status}`);
    return (await res.json()) as T;
  }

  async ratings(token: string): Promise<TraktRatingItem[]> {
    const [movies, shows] = await Promise.all([
      this.get<TraktRatingItem[]>("/sync/ratings/movies", token),
      this.get<TraktRatingItem[]>("/sync/ratings/shows", token),
    ]);
    return [...movies, ...shows];
  }

  async watchlist(token: string): Promise<TraktListItem[]> {
    const [movies, shows] = await Promise.all([
      this.get<TraktListItem[]>("/sync/watchlist/movies", token),
      this.get<TraktListItem[]>("/sync/watchlist/shows", token),
    ]);
    return [...movies, ...shows];
  }
}

/** Trakt only links back to IMDb for most titles; entries without an IMDb id are skipped. */
export function traktToTitle(item: { type: "movie" | "show"; movie?: TraktMedia; show?: TraktMedia }): Title | undefined {
  const media = item.movie ?? item.show;
  const imdb = media?.ids.imdb;
  if (!media || !imdb || !/^tt\d+$/.test(imdb)) return undefined;
  const type: TitleType = item.type === "movie" ? "movie" : "tvSeries";
  return { id: imdb, title: media.title, type, year: media.year ?? undefined, genres: [], directors: [] };
}

export function traktToRating(item: TraktRatingItem): Rating | undefined {
  const t = traktToTitle(item);
  if (!t || !Number.isInteger(item.rating) || item.rating < 1 || item.rating > 10) return undefined;
  return { titleId: t.id, rating: item.rating, ratedAt: new Date(item.rated_at) };
}

export function tokensExpired(t: TraktTokens, now = Date.now()): boolean {
  // Refresh a little early so a sync never starts with a token about to lapse.
  return (t.created_at + t.expires_in) * 1000 - 5 * 60_000 < now;
}
