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

export interface TraktDevice {
  device_code: string;
  user_code: string;
  verification_url: string;
  expires_in: number;
  interval: number;
}

export async function startTrakt(): Promise<{ ok: true; device: TraktDevice } | { ok: false; error: string }> {
  try {
    return { ok: true, device: await api<TraktDevice>("/api/integrations/trakt/device", { method: "POST" }) };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

export async function pollTrakt(deviceCode: string): Promise<{ status: string; error?: string }> {
  try {
    const res = await api<{ status: string }>("/api/integrations/trakt/poll", { method: "POST", body: JSON.stringify({ deviceCode }) });
    if (res.status === "connected") revalidatePath("/", "layout");
    return res;
  } catch (err) {
    return { status: "error", error: (err as Error).message };
  }
}

export async function syncTraktNow(): Promise<string> {
  try {
    const r = await api<{ ratings: number; watchlist: number; newTitles: number; skippedNoImdbId: number }>("/api/integrations/trakt/sync", { method: "POST" });
    revalidatePath("/", "layout");
    return `Synced ${r.ratings} ratings and ${r.watchlist} watchlist titles (${r.newTitles} new to the catalogue, ${r.skippedNoImdbId} skipped without an IMDb id).`;
  } catch (err) {
    return (err as Error).message;
  }
}

export async function disconnectTrakt() {
  await api("/api/integrations/trakt", { method: "DELETE" });
  revalidatePath("/connections");
}
