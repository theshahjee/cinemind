/** Thin client for the CineMind HTTP API. The MCP server never touches the database for movie data. */
export class CineMindClient {
  constructor(
    private readonly baseUrl: string,
    private readonly token: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async call<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
    const res = await this.fetchImpl(`${this.baseUrl.replace(/\/$/, "")}${path}`, {
      method: init.method ?? "GET",
      headers: {
        authorization: `Bearer ${this.token}`,
        ...(init.body !== undefined ? { "content-type": "application/json" } : {}),
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: AbortSignal.timeout(30_000),
    });
    const body = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
    if (!res.ok) throw new Error(body.error ?? body.message ?? `CineMind API returned ${res.status}`);
    return body as T;
  }
}

export interface ApiTitle {
  id: string;
  title: string;
  type: string;
  year?: number;
  runtimeMinutes?: number;
  genres: string[];
  directors: string[];
  cast?: string[];
  keywords?: string[];
  language?: string;
  imdbRating?: number;
  numVotes?: number;
  overview?: string;
  posterPath?: string;
}

export interface ApiRecommendation {
  title: ApiTitle;
  score: number;
  explanation: { matches: string[]; conflicts: string[] };
}
