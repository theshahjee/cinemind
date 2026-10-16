import type { Rating, Title } from "@cinemind/core";
import type { Feedback, FeedbackKind, Integration, LibraryEntry, LibraryQuery, Repository } from "./types.js";

export class MemoryRepository implements Repository {
  private titles = new Map<string, Title>();
  private ratings = new Map<string, Map<string, Rating>>();
  private watchlist = new Map<string, Set<string>>();
  private feedback = new Map<string, Feedback[]>();
  private integrations = new Map<string, Integration>();

  async upsertTitles(titles: readonly Title[]) {
    for (const t of titles) this.titles.set(t.id, { ...this.titles.get(t.id), ...t });
  }

  async upsertRatings(userId: string, ratings: readonly Rating[]) {
    const m = this.ratings.get(userId) ?? new Map();
    for (const r of ratings) {
      const existing = m.get(r.titleId);
      if (!existing || existing.ratedAt.getTime() <= r.ratedAt.getTime()) m.set(r.titleId, r);
    }
    this.ratings.set(userId, m);
  }

  async deleteRating(userId: string, titleId: string) {
    return this.ratings.get(userId)?.delete(titleId) ?? false;
  }

  async getRatings(userId: string) {
    return [...(this.ratings.get(userId)?.values() ?? [])];
  }

  async getTitle(id: string) {
    return this.titles.get(id);
  }

  async getCatalogue() {
    return new Map(this.titles);
  }

  async searchTitles(query: string, limit: number) {
    const q = query.toLowerCase();
    return [...this.titles.values()]
      .filter((t) => t.title.toLowerCase().includes(q))
      .sort((a, b) => (b.numVotes ?? 0) - (a.numVotes ?? 0))
      .slice(0, limit);
  }

  async getIntegration(provider: string) {
    return this.integrations.get(provider);
  }

  async saveIntegration(_userId: string, provider: string, data: Record<string, unknown>) {
    this.integrations.set(provider, { ...this.integrations.get(provider), provider, data });
  }

  async recordSync(provider: string, result: Record<string, unknown>) {
    const i = this.integrations.get(provider);
    if (i) this.integrations.set(provider, { ...i, lastSyncAt: new Date(), lastSyncResult: result });
  }

  async deleteIntegration(provider: string) {
    this.integrations.delete(provider);
  }

  async getLibrary(userId: string, q: LibraryQuery) {
    const rated = this.ratings.get(userId) ?? new Map<string, Rating>();
    const wl = this.watchlist.get(userId) ?? new Set<string>();
    const search = q.search?.toLowerCase();
    let items: LibraryEntry[] = [...this.titles.values()]
      .filter((t) => rated.has(t.id) || wl.has(t.id))
      .map((t) => {
        const r = rated.get(t.id);
        return { title: t, rating: r?.rating, ratedAt: r?.ratedAt, onWatchlist: wl.has(t.id) };
      })
      .filter((e) => !search || e.title.title.toLowerCase().includes(search))
      .filter((e) => !q.genre || e.title.genres.includes(q.genre))
      .filter((e) => !q.type || e.title.type === q.type)
      .filter((e) => q.minRating === undefined || (e.rating ?? 0) >= q.minRating);
    items = items.sort((a, b) => (b.ratedAt?.getTime() ?? 0) - (a.ratedAt?.getTime() ?? 0));
    const offset = q.offset ?? 0;
    return { total: items.length, items: items.slice(offset, offset + (q.limit ?? 50)) };
  }

  async setWatchlist(userId: string, titleId: string, on: boolean) {
    const s = this.watchlist.get(userId) ?? new Set();
    if (on) s.add(titleId);
    else s.delete(titleId);
    this.watchlist.set(userId, s);
  }

  async getWatchlist(userId: string) {
    return [...(this.watchlist.get(userId) ?? [])].flatMap((id) => this.titles.get(id) ?? []);
  }

  async addFeedback(userId: string, titleId: string, kind: FeedbackKind) {
    const list = this.feedback.get(userId) ?? [];
    list.push({ titleId, kind, createdAt: new Date() });
    this.feedback.set(userId, list);
  }

  async getFeedback(userId: string) {
    return [...(this.feedback.get(userId) ?? [])];
  }

  async getOwnerId() {
    return "00000000-0000-0000-0000-000000000001";
  }
}
