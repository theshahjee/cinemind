import { ErrorNote } from "@/components/ErrorNote";
import { api } from "@/lib/api";
import { featureLabel } from "@/lib/format";
import type { Taste } from "@/lib/types";

export const dynamic = "force-dynamic";

function AffinityList({ rows, tone }: { rows: Taste["top"]; tone: "pos" | "neg" }) {
  const max = Math.max(...rows.map((r) => Math.abs(r.affinity)), 0.01);
  return (
    <ul className="space-y-2">
      {rows.map((r) => (
        <li key={r.feature} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)_3rem] items-center gap-3 text-sm">
          <span className="truncate">{featureLabel(r.feature)}</span>
          <span className="h-2 rounded-full bg-line">
            <span
              className={`block h-2 rounded-full ${tone === "pos" ? "bg-amber" : "bg-rose"}`}
              style={{ width: `${(Math.abs(r.affinity) / max) * 100}%` }}
            />
          </span>
          <span className="text-right text-xs tabular-nums text-muted" title="Weighted number of ratings behind this">
            {r.support.toFixed(1)}
          </span>
        </li>
      ))}
    </ul>
  );
}

export default async function TastePage() {
  let t: Taste | undefined;
  let error: string | undefined;
  try {
    t = await api<Taste>("/api/taste");
  } catch (e) {
    error = (e as Error).message;
  }
  if (error || !t) return <ErrorNote message={error ?? "No data"} />;
  const maxBin = Math.max(...t.histogram, 1);

  return (
    <section className="space-y-10">
      <div className="space-y-2">
        <h1 className="font-display text-5xl tracking-tight">Your taste</h1>
        <p className="max-w-2xl text-muted">
          Built from {t.ratedCount} ratings you gave and {t.inferredCount} likes or dislikes the model treats as inferred
          ratings. The number beside each bar is how much rating evidence backs it; small numbers are guesses.
        </p>
      </div>

      <div>
        <h2 className="mb-3 text-sm uppercase tracking-widest text-muted">How you rate · mean {t.meanRating.toFixed(1)}</h2>
        <div className="flex h-32 items-end gap-2" role="img" aria-label="Histogram of your ratings from 1 to 10">
          {t.histogram.map((n, i) => (
            <div key={i} className="flex h-full flex-1 flex-col items-center gap-1">
              <div className="flex w-full flex-1 items-end">
                <div className="w-full rounded-t bg-amber/80" style={{ height: `${(n / maxBin) * 100}%` }} title={`${n} titles rated ${i + 1}`} />
              </div>
              <span className="text-xs text-muted">{i + 1}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="grid gap-10 md:grid-cols-2">
        <div>
          <h2 className="mb-3 text-sm uppercase tracking-widest text-muted">Draws you in</h2>
          <AffinityList rows={t.top} tone="pos" />
        </div>
        <div>
          <h2 className="mb-3 text-sm uppercase tracking-widest text-muted">Tends to lose you</h2>
          <AffinityList rows={t.bottom} tone="neg" />
        </div>
      </div>
    </section>
  );
}
