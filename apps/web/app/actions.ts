"use server";

import { revalidatePath } from "next/cache";
import { api } from "@/lib/api";

export async function sendFeedback(titleId: string, kind: "like" | "dislike" | "not_interested" | "save") {
  await api(`/api/feedback/${titleId}`, { method: "POST", body: JSON.stringify({ kind }) });
  revalidatePath("/");
}

export async function rateTitle(titleId: string, rating: number) {
  await api(`/api/ratings/${titleId}`, { method: "PUT", body: JSON.stringify({ rating }) });
  revalidatePath("/library");
  revalidatePath("/");
}

export async function importCsv(_prev: unknown, form: FormData): Promise<{ message: string; ok: boolean }> {
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) return { ok: false, message: "Choose your IMDb ratings CSV first." };
  try {
    const res = await api<{ imported: number; skipped: { line: number; reason: string }[] }>("/api/import/imdb", {
      method: "POST",
      headers: { "content-type": "text/csv" },
      body: await file.text(),
    });
    revalidatePath("/", "layout");
    const skipped = res.skipped.length ? ` Skipped ${res.skipped.length} rows that couldn't be read.` : "";
    return { ok: true, message: `Imported ${res.imported} ratings.${skipped}` };
  } catch (err) {
    return { ok: false, message: (err as Error).message };
  }
}
