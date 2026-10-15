"use client";

import { useTransition } from "react";
import { rateTitle } from "@/app/actions";

export function RatingSelect({ titleId, rating }: { titleId: string; rating?: number }) {
  const [pending, start] = useTransition();
  return (
    <select
      aria-label="Your rating"
      defaultValue={rating ?? ""}
      disabled={pending}
      onChange={(e) => start(() => rateTitle(titleId, Number(e.target.value)))}
      className="h-8 rounded border border-line bg-ink px-2 text-sm tabular-nums"
    >
      {!rating && <option value="">—</option>}
      {Array.from({ length: 10 }, (_, i) => 10 - i).map((n) => (
        <option key={n} value={n}>
          {n}
        </option>
      ))}
    </select>
  );
}
