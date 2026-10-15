import { ErrorNote } from "@/components/ErrorNote";
import { RecommendationCard } from "@/components/TitleCard";
import { api } from "@/lib/api";
import type { AskResult } from "@/lib/types";

export const dynamic = "force-dynamic";

const EXAMPLES = ["A tense thriller under two hours with a satisfying ending", "A lighthearted comedy series, no romance", "1990s crime films"];

export default async function Ask({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q } = await searchParams;
  let result: AskResult | undefined;
  let error: string | undefined;
  if (q && q.trim().length >= 3) {
    try {
      result = await api<AskResult>("/api/ask", { method: "POST", body: JSON.stringify({ query: q, k: 12 }) });
    } catch (e) {
      error = (e as Error).message;
    }
  }
  const c = result?.constraints;
  const chips = c
    ? [
        ...c.includeGenres.map((g) => `+ ${g}`),
        ...c.excludeGenres.map((g) => `− ${g}`),
        ...c.types.map((t) => (t === "movie" ? "Movies" : "Series")),
        c.maxRuntimeMinutes && `≤ ${c.maxRuntimeMinutes} min`,
        c.minYear && `${c.minYear}–${c.maxYear ?? ""}`,
      ].filter(Boolean)
    : [];

  return (
    <section className="space-y-8">
      <div className="max-w-2xl space-y-4">
        <h1 className="font-display text-5xl tracking-tight">Ask CineMind</h1>
        <form className="flex gap-2">
          <input
            name="q"
            defaultValue={q}
            minLength={3}
            maxLength={500}
            placeholder="Something like Panchayat, but less bleak"
            className="h-11 flex-1 rounded border border-line bg-panel px-4 placeholder:text-muted"
          />
          <button className="h-11 rounded bg-amber px-5 font-medium text-ink hover:bg-amber/90">Ask</button>
        </form>
        {!q && (
          <ul className="flex flex-wrap gap-2 text-sm">
            {EXAMPLES.map((e) => (
              <li key={e}>
                <a href={`?q=${encodeURIComponent(e)}`} className="inline-block rounded-full border border-line px-3 py-1 text-muted hover:text-paper">
                  {e}
                </a>
              </li>
            ))}
          </ul>
        )}
      </div>
      {error && <ErrorNote message={error} />}
      {result && (
        <div className="space-y-2 text-sm">
          <p className="text-muted">
            Understood as{" "}
            {chips.length ? chips.map((x) => <span key={String(x)} className="mr-1 rounded bg-panel px-2 py-0.5 text-paper ring-1 ring-line">{x}</span>) : "no hard filters"}
            <span className="ml-2 text-xs">(parsed by {result.parsedBy})</span>
          </p>
          {c && c.softPreferences.length > 0 && (
            <p className="text-muted">
              Mood wishes: {c.softPreferences.join(", ")}. {result.note}
            </p>
          )}
        </div>
      )}
      {result && result.results.length === 0 && <p className="text-muted">Nothing in your catalogue matches those filters.</p>}
      <div className="grid grid-cols-2 gap-x-5 gap-y-10 sm:grid-cols-3 lg:grid-cols-4">
        {result?.results.map((r) => <RecommendationCard key={r.title.id} rec={r} />)}
      </div>
    </section>
  );
}
