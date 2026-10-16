"use client";

import { useActionState } from "react";
import { importCsv } from "@/app/actions";

export function ImportForm() {
  const [state, action, pending] = useActionState(importCsv, undefined);
  return (
    <form action={action} className="flex flex-col gap-3 rounded-md border border-line bg-panel p-4 sm:flex-row sm:items-center">
      <label className="flex-1 text-sm">
        <span className="mb-1 block text-muted">IMDb export: Your Ratings or your Watchlist (open the page → ⋯ → Export)</span>
        <input
          type="file"
          name="file"
          accept=".csv,text/csv"
          className="block w-full text-sm file:mr-3 file:rounded file:border-0 file:bg-line file:px-3 file:py-1.5 file:text-paper"
        />
      </label>
      <button
        type="submit"
        disabled={pending}
        className="h-9 rounded bg-amber px-4 text-sm font-medium text-ink transition hover:bg-amber/90 disabled:opacity-60"
      >
        {pending ? "Importing…" : "Import"}
      </button>
      {state && (
        <p role="status" className={`text-sm sm:basis-full ${state.ok ? "text-amber" : "text-rose"}`}>
          {state.message}
        </p>
      )}
    </form>
  );
}
