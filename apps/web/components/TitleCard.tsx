import { featureLabel, posterUrl, runtime } from "@/lib/format";
import type { Recommendation, Title } from "@/lib/types";
import { FeedbackButtons } from "./FeedbackButtons";

export function Poster({ title }: { title: Title }) {
  const src = posterUrl(title.posterPath);
  return (
    <div className="relative aspect-[2/3] w-full overflow-hidden rounded-md bg-panel ring-1 ring-line">
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt="" className="h-full w-full object-cover" loading="lazy" />
      ) : (
        <div className="flex h-full items-end bg-gradient-to-b from-panel to-[#221d16] p-3">
          <span className="font-display text-xl leading-tight text-paper/80">{title.title}</span>
        </div>
      )}
    </div>
  );
}

export function TitleMeta({ title }: { title: Title }) {
  const bits = [title.year, runtime(title.runtimeMinutes), title.type === "movie" ? undefined : "Series"].filter(Boolean);
  return <p className="text-xs text-muted">{bits.join(" · ")}</p>;
}

export function RecommendationCard({ rec }: { rec: Recommendation }) {
  const { title, explanation } = rec;
  return (
    <article className="group flex flex-col gap-3">
      <Poster title={title} />
      <div className="space-y-1">
        <h3 className="font-medium leading-snug">{title.title}</h3>
        <TitleMeta title={title} />
      </div>
      {explanation.matches.length > 0 && (
        <p className="text-xs leading-relaxed text-paper/80">
          <span className="text-amber">Because you like </span>
          {explanation.matches.map(featureLabel).join(", ")}
        </p>
      )}
      {explanation.conflicts.length > 0 && (
        <p className="text-xs leading-relaxed text-paper/60">
          <span className="text-rose">Watch out: </span>
          {explanation.conflicts.map(featureLabel).join(", ")}
        </p>
      )}
      <FeedbackButtons titleId={title.id} />
    </article>
  );
}
