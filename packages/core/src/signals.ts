/**
 * How a 1-10 rating translates into a preference signal in [-1, 1].
 *
 * "centered" (default) measures each rating against the user's own mean, so a
 * habitual 7-giver's 7 is neutral and a 9 counts for more than an 8.
 * "thresholds" uses fixed cut-offs, for people who want to say exactly what a
 * 6 means to them. On the synthetic benchmark centred signals rank noticeably
 * better; see docs/EVALUATION.md.
 */
export interface SignalConfig {
  mode: "centered" | "thresholds";
  /** Centred mode: rating points from the mean that map to a full +1 or -1. */
  scale: number;
  // Threshold mode:
  strongPositive: number; // rating >= this -> +1
  positive: number; // rating >= this -> +0.5
  neutral: number; // rating >= this -> weakSignal
  /** Signal for ratings in [neutral, positive). Slightly negative by default. */
  weakSignal: number;
  // anything below `neutral` -> -1
}

export const DEFAULT_SIGNALS: SignalConfig = {
  mode: "centered",
  scale: 3,
  strongPositive: 8,
  positive: 6,
  neutral: 4,
  weakSignal: -0.25,
};

export function ratingToSignal(rating: number, cfg: SignalConfig = DEFAULT_SIGNALS, userMean = 6.5): number {
  if (cfg.mode === "centered") return Math.max(-1, Math.min(1, (rating - userMean) / cfg.scale));
  if (rating >= cfg.strongPositive) return 1;
  if (rating >= cfg.positive) return 0.5;
  if (rating >= cfg.neutral) return cfg.weakSignal;
  return -1;
}

/**
 * Exponential recency weight. A rating `halfLifeDays` old counts half as much
 * as one made today, so the profile follows taste as it changes.
 */
export function recencyWeight(ratedAt: Date, now: Date, halfLifeDays: number): number {
  if (!Number.isFinite(halfLifeDays) || halfLifeDays <= 0) return 1;
  const ageDays = Math.max(0, (now.getTime() - ratedAt.getTime()) / 86_400_000);
  return Math.pow(0.5, ageDays / halfLifeDays);
}
