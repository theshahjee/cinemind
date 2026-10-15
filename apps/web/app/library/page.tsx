import { ErrorNote } from "@/components/ErrorNote";
import { ImportForm } from "@/components/ImportForm";
import { RatingSelect } from "@/components/RatingSelect";
import { TitleMeta } from "@/components/TitleCard";
import { api } from "@/lib/api";
import type { LibraryEntry } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function Library({ searchParams }: { searchParams: Promise<{ q?: string; page?: string }> }) {
  const { q, page } = await searchParams;
  const pageNo = Math.max(1, Number(page) || 1);
  const params = new URLSearchParams({ limit: "50", offset: String((pageNo - 1) * 50) });
  if (q) params.set("search", q);

  let data: { total: number; items: LibraryEntry[] } = { total: 0, items: [] };
  let error: string | undefined;
  try {
    data = await api(`/api/library?${params}`);
  } catch (e) {
    error = (e as Error).message;
  }
  const pages = Math.ceil(data.total / 50);

  return (
    <section className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-5xl tracking-tight">Library</h1>
          <p className="text-muted">{data.total} titles rated or saved</p>
        </div>
        <form className="w-full sm:w-72">
          <input
            name="q"
            defaultValue={q}
            placeholder="Search your library"
            className="h-9 w-full rounded border border-line bg-panel px-3 text-sm placeholder:text-muted"
          />
        </form>
      </div>
      <ImportForm />
      {error && <ErrorNote message={error} />}
      <ul className="divide-y divide-line rounded-md border border-line">
        {data.items.map((e) => (
          <li key={e.title.id} className="flex items-center gap-4 px-4 py-3">
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium">
                {e.title.title}
                {e.onWatchlist && <span className="ml-2 rounded bg-amber/15 px-1.5 py-0.5 text-[10px] uppercase text-amber">Watchlist</span>}
              </p>
              <TitleMeta title={e.title} />
              <p className="truncate text-xs text-muted">{e.title.genres.join(", ")}</p>
            </div>
            {e.ratedAt && <time className="hidden text-xs text-muted sm:block">{new Date(e.ratedAt).toLocaleDateString()}</time>}
            <RatingSelect titleId={e.title.id} rating={e.rating} />
          </li>
        ))}
      </ul>
      {pages > 1 && (
        <nav className="flex justify-center gap-2 text-sm" aria-label="Pagination">
          {pageNo > 1 && <a className="rounded border border-line px-3 py-1" href={`?${new URLSearchParams({ ...(q ? { q } : {}), page: String(pageNo - 1) })}`}>Previous</a>}
          <span className="px-3 py-1 text-muted">Page {pageNo} of {pages}</span>
          {pageNo < pages && <a className="rounded border border-line px-3 py-1" href={`?${new URLSearchParams({ ...(q ? { q } : {}), page: String(pageNo + 1) })}`}>Next</a>}
        </nav>
      )}
    </section>
  );
}
