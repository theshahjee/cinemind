import Link from "next/link";
import { ErrorNote } from "@/components/ErrorNote";
import { RecommendationCard } from "@/components/TitleCard";
import { api } from "@/lib/api";
import type { Recommendation } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function ForYou() {
  let recs: Recommendation[] = [];
  let error: string | undefined;
  try {
    recs = await api<Recommendation[]>("/api/recommendations?k=24");
  } catch (e) {
    error = (e as Error).message;
  }

  return (
    <section className="space-y-8">
      <div className="max-w-2xl space-y-2">
        <h1 className="font-display text-5xl tracking-tight">For you</h1>
        <p className="text-muted">
          Ranked from your ratings and feedback. Each pick says which parts of your taste it matches and what it carries that you
          tend to dislike.
        </p>
      </div>
      {error && <ErrorNote message={error} />}
      {!error && recs.length === 0 && (
        <div className="rounded-md border border-line bg-panel p-6 text-sm text-muted">
          Nothing to recommend yet. <Link href="/library" className="text-amber underline">Import your IMDb ratings</Link> to get
          started. Recommendations come from titles in your catalogue, so they get better as metadata syncs.
        </div>
      )}
      <div className="grid grid-cols-2 gap-x-5 gap-y-10 sm:grid-cols-3 lg:grid-cols-4">
        {recs.map((r) => (
          <RecommendationCard key={r.title.id} rec={r} />
        ))}
      </div>
    </section>
  );
}
