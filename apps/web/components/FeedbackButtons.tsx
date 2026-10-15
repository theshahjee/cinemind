"use client";

import { useState, useTransition } from "react";
import { sendFeedback } from "@/app/actions";

const ACTIONS = [
  { kind: "like", label: "More like this", icon: "▲" },
  { kind: "dislike", label: "Less like this", icon: "▼" },
  { kind: "save", label: "Save to watchlist", icon: "＋" },
  { kind: "not_interested", label: "Not interested", icon: "✕" },
] as const;

export function FeedbackButtons({ titleId }: { titleId: string }) {
  const [pending, start] = useTransition();
  const [done, setDone] = useState<string>();
  return (
    <div className="mt-auto flex gap-1" aria-busy={pending}>
      {ACTIONS.map((a) => (
        <button
          key={a.kind}
          type="button"
          title={a.label}
          aria-label={a.label}
          disabled={pending}
          onClick={() =>
            start(async () => {
              await sendFeedback(titleId, a.kind);
              setDone(a.kind);
            })
          }
          className={`h-8 flex-1 rounded border text-xs transition disabled:opacity-50 ${
            done === a.kind ? "border-amber bg-amber/15 text-amber" : "border-line text-muted hover:border-amber-dim hover:text-paper"
          }`}
        >
          {a.icon}
        </button>
      ))}
    </div>
  );
}
